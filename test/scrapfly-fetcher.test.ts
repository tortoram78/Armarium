import { describe, it, expect } from "vitest";
import { fetchViaScrapfly, isScrapflyConfigured } from "@/server/scrapfly-fetcher";

const KEY = "test-key";

/** A fake Scrapfly JSON envelope wrapping page HTML in `result.content`. */
function scrapflyJson(content: string, status = 200): Response {
  return new Response(JSON.stringify({ result: { content, url: "https://www.rei.com/p", status_code: 200 } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchViaScrapfly — residential fallback fetcher", () => {
  it("rejects a non-allowlisted URL via the shape gate and never calls fetch", async () => {
    let called = false;
    const r = await fetchViaScrapfly("https://evil.com/x", {
      apiKey: KEY,
      fetchImpl: async () => {
        called = true;
        return scrapflyJson("<html/>");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^url-shape:/);
    expect(called).toBe(false); // the third party is never handed a non-allowlisted URL
  });

  it("returns { ok:false } when no API key is configured", async () => {
    const r = await fetchViaScrapfly("https://www.rei.com/product/1/x", { apiKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not configured/);
  });

  it("parses result.content into html and sends asp + residential pool + the allowlisted target", async () => {
    let calledUrl = "";
    const html = '<html><script type="application/ld+json">{"@type":"Product","name":"X"}</script></html>';
    const r = await fetchViaScrapfly("https://www.rei.com/product/236427/magma", {
      apiKey: KEY,
      fetchImpl: async (u) => {
        calledUrl = String(u);
        return scrapflyJson(html);
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toContain("Product");
      expect(r.finalUrl).toContain("rei.com");
    }
    expect(calledUrl).toContain("api.scrapfly.io/scrape");
    expect(calledUrl).toContain("asp=true");
    expect(calledUrl).toContain("public_residential_pool");
    expect(calledUrl).toContain("render_js=true");
    expect(calledUrl).toContain("www.rei.com"); // the (encoded) target URL is forwarded
  });

  it("surfaces a Scrapfly HTTP error as a reason", async () => {
    const r = await fetchViaScrapfly("https://www.rei.com/x", {
      apiKey: KEY,
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scrapfly: http 401");
  });

  it("treats a missing/empty content envelope as a failure", async () => {
    const r = await fetchViaScrapfly("https://www.rei.com/x", {
      apiKey: KEY,
      fetchImpl: async () =>
        new Response(JSON.stringify({ result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty content/);
  });

  it("isScrapflyConfigured reflects SCRAPFLY_KEY", () => {
    const saved = process.env.SCRAPFLY_KEY;
    delete process.env.SCRAPFLY_KEY;
    expect(isScrapflyConfigured()).toBe(false);
    process.env.SCRAPFLY_KEY = "x";
    expect(isScrapflyConfigured()).toBe(true);
    if (saved === undefined) delete process.env.SCRAPFLY_KEY;
    else process.env.SCRAPFLY_KEY = saved;
  });
});
