import { describe, it, expect } from "vitest";
import { fetchManufacturerHtml, type FetcherDeps } from "@/server/enrich-fetcher";

// ---------------------------------------------------------------------------------------------------
// Hermetic fakes — NO real network, NO real DNS. Every SSRF decision is driven by these injected deps.
// ---------------------------------------------------------------------------------------------------

/** Build a streaming, web-`Response`-shaped object so the byte-cap streaming path is genuinely exercised. */
function htmlResponse(
  html: string,
  opts: { status?: number; contentType?: string; chunkSize?: number } = {},
): Response {
  const status = opts.status ?? 200;
  const contentType = opts.contentType ?? "text/html; charset=utf-8";
  const bytes = new TextEncoder().encode(html);
  const chunkSize = opts.chunkSize ?? Math.max(1, Math.ceil(bytes.length / 3) || 1);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { "content-type": contentType },
  });
}

/** A 3xx redirect to `location`. */
function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A lookup that always returns the given fixed addresses, regardless of host. */
function fixedLookup(...addrs: string[]): FetcherDeps["lookup"] {
  return async () => addrs;
}

/** A lookup keyed by host so different hosts (incl. redirect targets) resolve differently. */
function lookupByHost(map: Record<string, string[]>): FetcherDeps["lookup"] {
  return async (host: string) => map[host] ?? [];
}

const PUBLIC_V4 = ["104.18.2.3"]; // a public address used for the happy path

// ---------------------------------------------------------------------------------------------------

describe("fetchManufacturerHtml — ACCEPT path", () => {
  it("accepts an allowlisted host resolving to a PUBLIC IP with 200 text/html", async () => {
    const html = "<!doctype html><html><head><title>Nano Puff</title></head><body>ok</body></html>";
    const r = await fetchManufacturerHtml("https://patagonia.com/product/nano-puff", {
      fetchImpl: async () => htmlResponse(html),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toBe(html);
      expect(r.finalUrl).toContain("patagonia.com");
    }
  });

  it("accepts application/xhtml+xml as HTML-ish", async () => {
    const r = await fetchManufacturerHtml("https://rei.com/x", {
      fetchImpl: async () => htmlResponse("<html/>", { contentType: "application/xhtml+xml" }),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a public IPv6-only host", async () => {
    const r = await fetchManufacturerHtml("https://arcteryx.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup("2606:4700:4700::1111"),
    });
    expect(r.ok).toBe(true);
  });
});

describe("fetchManufacturerHtml — REJECT: URL shape gate (delegated to core)", () => {
  it("rejects a non-allowlisted host with a shape reason", async () => {
    const r = await fetchManufacturerHtml("https://evil.example.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/url-shape/);
      expect(r.reason).toMatch(/allowlist/);
    }
  });

  it("rejects http:// (non-https) at the shape gate", async () => {
    const r = await fetchManufacturerHtml("http://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/url-shape/);
  });

  it("never calls fetch when the shape gate fails", async () => {
    let fetchCalls = 0;
    const r = await fetchManufacturerHtml("https://evil.example.com/x", {
      fetchImpl: async () => {
        fetchCalls += 1;
        return htmlResponse("<html/>");
      },
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    expect(fetchCalls).toBe(0);
  });
});

describe("fetchManufacturerHtml — REJECT: DNS resolves to a private/internal IP (rebinding + metadata)", () => {
  const internalCases: Array<[string, string]> = [
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "cloud metadata"],
    ["10.0.0.7", "RFC1918 private"],
    ["::1", "IPv6 loopback"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
  ];

  for (const [addr, label] of internalCases) {
    it(`rejects an allowlisted host resolving to ${addr} (${label})`, async () => {
      let fetchCalls = 0;
      const r = await fetchManufacturerHtml("https://patagonia.com/x", {
        fetchImpl: async () => {
          fetchCalls += 1;
          return htmlResponse("<html/>");
        },
        lookup: fixedLookup(addr),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/private-ip/);
      // The whole point: we never opened a socket to the internal address.
      expect(fetchCalls).toBe(0);
    });
  }

  it("rejects when ANY of several resolved addresses is private (mixed answer)", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup("104.18.2.3", "169.254.169.254"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/private-ip/);
  });

  it("rejects when DNS resolves to NO addresses", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/dns|private-ip/);
  });

  it("rejects when the DNS lookup itself throws", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/dns/);
  });
});

describe("fetchManufacturerHtml — REJECT: redirects re-validated every hop", () => {
  it("rejects a 302 to an internal host (re-validated DNS catches it)", async () => {
    // patagonia.com (public) 302s to rei.com, but rei.com resolves to the metadata IP.
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("patagonia.com")) return redirectResponse("https://rei.com/internal");
      return htmlResponse("<html>SHOULD NOT REACH</html>");
    };
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl,
      lookup: lookupByHost({
        "patagonia.com": ["104.18.2.3"], // public
        "rei.com": ["169.254.169.254"], // metadata — must be blocked on the hop
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/private-ip/);
  });

  it("rejects a 302 to a non-allowlisted host (re-validated shape gate catches it)", async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("patagonia.com")) return redirectResponse("https://evil.example.com/x");
      return htmlResponse("<html>SHOULD NOT REACH</html>");
    };
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl,
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/url-shape/);
  });

  it("rejects a 302 to http:// (downgrade) at the re-validated shape gate", async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://patagonia.com")) {
        return redirectResponse("http://patagonia.com/downgraded");
      }
      return htmlResponse("<html>SHOULD NOT REACH</html>");
    };
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl,
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/url-shape/);
  });

  it("follows a SAFE redirect to another allowlisted+public host and returns its html", async () => {
    const finalHtml = "<html><body>final</body></html>";
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/start")) return redirectResponse("https://www.patagonia.com/final");
      return htmlResponse(finalHtml);
    };
    const r = await fetchManufacturerHtml("https://patagonia.com/start", {
      fetchImpl,
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toBe(finalHtml);
      expect(r.finalUrl).toContain("/final");
    }
  });

  it("rejects after exceeding maxRedirects hops", async () => {
    // Always redirect to a distinct safe allowlisted URL → loops until the cap trips.
    let n = 0;
    const fetchImpl = async (): Promise<Response> => {
      n += 1;
      return redirectResponse(`https://patagonia.com/hop-${n}`);
    };
    const r = await fetchManufacturerHtml("https://patagonia.com/start", {
      fetchImpl,
      lookup: fixedLookup(...PUBLIC_V4),
      maxRedirects: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/redirect/);
  });

  it("rejects a redirect with no Location header", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => new Response(null, { status: 302 }),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/redirect/);
  });
});

describe("fetchManufacturerHtml — REJECT: transport limits", () => {
  it("rejects an oversized body (streamed, aborts past maxBytes)", async () => {
    const big = "x".repeat(50_000);
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse(`<html>${big}</html>`, { chunkSize: 1024 }),
      lookup: fixedLookup(...PUBLIC_V4),
      maxBytes: 1024, // 1 KB cap — the body blows past it
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/size/);
  });

  it("rejects a non-HTML content-type (application/json)", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () =>
        htmlResponse('{"not":"html"}', { contentType: "application/json" }),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/content-type/);
  });

  it("rejects a missing content-type", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () =>
        new Response(new TextEncoder().encode("<html/>"), { status: 200, headers: {} }),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/content-type/);
  });

  it("rejects a non-2xx final status", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("not found", { status: 404 }),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/http/);
  });

  it("maps a timeout/abort to { ok:false } (never throws)", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async (_input, init) => {
        // Simulate an aborted fetch: reject with an AbortError when the signal fires (or immediately).
        const signal = (init as RequestInit | undefined)?.signal;
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        if (signal?.aborted) throw err;
        throw err;
      },
      lookup: fixedLookup(...PUBLIC_V4),
      timeoutMs: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/timeout/);
  });

  it("maps a generic network error to { ok:false, reason: network }", async () => {
    const r = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      lookup: fixedLookup(...PUBLIC_V4),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/network/);
  });
});

describe("fetchManufacturerHtml — distinct reasons per failure class", () => {
  it("each failure mode carries a distinguishable reason prefix", async () => {
    const shape = await fetchManufacturerHtml("https://evil.example.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    const priv = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("<html/>"),
      lookup: fixedLookup("127.0.0.1"),
    });
    const ctype = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("x", { contentType: "application/json" }),
      lookup: fixedLookup(...PUBLIC_V4),
    });
    const size = await fetchManufacturerHtml("https://patagonia.com/x", {
      fetchImpl: async () => htmlResponse("x".repeat(5000)),
      lookup: fixedLookup(...PUBLIC_V4),
      maxBytes: 100,
    });

    const reasons = [shape, priv, ctype, size].map((r) => (r.ok ? "OK" : r.reason));
    // All four are failures, and the leading classifier differs across them.
    expect(reasons.every((x) => x !== "OK")).toBe(true);
    const prefixes = reasons.map((r) => r.split(":")[0]);
    expect(new Set(prefixes).size).toBe(4);
  });
});
