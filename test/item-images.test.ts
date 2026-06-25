// Item-photo storage helpers (display-only — ADR-0018). These tests run with NO Supabase env (the
// hermetic gate): the storage client must stay lazy so importing the module reads no env and never
// throws, every sign degrades to null when unconfigured, and the canonical object-path builder is pure.
//
// We deliberately do NOT exercise a live/configured signing round-trip here — that needs a real bucket
// and is verified out-of-band on Supabase (the cloud sandbox cannot reach it). The contract that MATTERS
// for the gate + dev-mode degrade is "no env → null, never throw", which is what we pin.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSignedItemImageUrl,
  getSignedItemImageUrls,
  buildItemImageObjectPath,
  isItemImageObjectPath,
  ITEM_IMAGES_BUCKET,
} from "@/server/item-images";

// Ensure the storage env is ABSENT for these tests regardless of the ambient shell (the lazy client
// reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on first call). Strip + restore.
const SAVED = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => {
  if (SAVED.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = SAVED.url;
  if (SAVED.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = SAVED.key;
});

describe("getSignedItemImageUrl", () => {
  it("returns null for a null path (no photo)", async () => {
    expect(await getSignedItemImageUrl(null)).toBeNull();
  });

  it("returns null for a real path when Supabase storage is not configured (no env)", async () => {
    // Must NOT throw and must degrade to null so the hermetic gate + dev mode render the placeholder.
    expect(await getSignedItemImageUrl("user-1/item-1/abc.jpg")).toBeNull();
  });
});

describe("getSignedItemImageUrls (batch)", () => {
  it("returns an empty map when given no real paths", async () => {
    expect((await getSignedItemImageUrls([])).size).toBe(0);
    expect((await getSignedItemImageUrls([null, null])).size).toBe(0);
  });

  it("maps every real path to null when unconfigured (deduped), preserving the input path as the key", async () => {
    const urls = await getSignedItemImageUrls([
      "u/i/a.jpg",
      "u/i/b.png",
      "u/i/a.jpg", // duplicate collapses
      null,
    ]);
    expect(urls.get("u/i/a.jpg")).toBeNull();
    expect(urls.get("u/i/b.png")).toBeNull();
    // null inputs are not keys; only the two distinct real paths are present.
    expect(urls.size).toBe(2);
  });
});

describe("buildItemImageObjectPath", () => {
  it("builds the canonical <user_id>/<item_id>/<uuid>.<ext> scheme (RLS keys segment 1 to the owner)", () => {
    const user = "00000000-0000-0000-0000-000000000001";
    const item = "11111111-1111-1111-1111-111111111111";
    const path = buildItemImageObjectPath(user, item, "jpg");

    const segs = path.split("/");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toBe(user); // segment 1 is the owner uid — what storage RLS matches on
    expect(segs[1]).toBe(item);
    // segment 3 is <uuid>.jpg
    expect(segs[2]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
    );
  });

  it("defaults the extension to jpg and normalizes a dirty extension", () => {
    const p1 = buildItemImageObjectPath("u", "i");
    expect(p1.endsWith(".jpg")).toBe(true);

    // Leading dot + uppercase + junk are stripped/normalized.
    expect(buildItemImageObjectPath("u", "i", ".PNG").endsWith(".png")).toBe(true);
    expect(buildItemImageObjectPath("u", "i", "jpeg").endsWith(".jpeg")).toBe(true);
    // A fully non-alphanumeric ext falls back to jpg rather than producing a dotfile.
    expect(buildItemImageObjectPath("u", "i", "...").endsWith(".jpg")).toBe(true);
  });

  it("generates a unique filename each call (uuid) so re-uploads never collide", () => {
    const a = buildItemImageObjectPath("u", "i", "jpg");
    const b = buildItemImageObjectPath("u", "i", "jpg");
    expect(a).not.toBe(b);
  });
});

describe("isItemImageObjectPath — defence-in-depth shape gate for client-supplied keys", () => {
  const user = "00000000-0000-0000-0000-000000000001";
  const item = "11111111-1111-1111-1111-111111111111";

  it("accepts a key the canonical constructor produces (the two scheme owners agree)", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const path = buildItemImageObjectPath(user, item, ext);
      expect(isItemImageObjectPath(path, user, item)).toBe(true);
    }
  });

  it("rejects another user's or another item's folder (prefix must match)", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const path = buildItemImageObjectPath(user, item, "jpg");
    expect(isItemImageObjectPath(path, other, item)).toBe(false); // different user
    expect(isItemImageObjectPath(path, user, other)).toBe(false); // different item
  });

  it("rejects path traversal, extra separators, and null bytes in the filename segment", () => {
    expect(isItemImageObjectPath(`${user}/${item}/../../../etc/passwd`, user, item)).toBe(false);
    expect(isItemImageObjectPath(`${user}/${item}/..`, user, item)).toBe(false);
    expect(isItemImageObjectPath(`${user}/${item}/sub/nested.jpg`, user, item)).toBe(false); // extra '/'
    expect(isItemImageObjectPath(`${user}/${item}/a\0.jpg`, user, item)).toBe(false); // null byte in stem
    expect(isItemImageObjectPath(`${user}/${item}/a.jpg.png`, user, item)).toBe(false); // double extension
  });

  it("rejects a non-image extension or a missing extension", () => {
    expect(isItemImageObjectPath(`${user}/${item}/evil.svg`, user, item)).toBe(false);
    expect(isItemImageObjectPath(`${user}/${item}/evil.exe`, user, item)).toBe(false);
    expect(isItemImageObjectPath(`${user}/${item}/noext`, user, item)).toBe(false);
    expect(isItemImageObjectPath(`${user}/${item}/`, user, item)).toBe(false); // empty filename
  });
});

describe("bucket id", () => {
  it("is the private 'item-images' bucket (must match the out-of-band storage SQL)", () => {
    expect(ITEM_IMAGES_BUCKET).toBe("item-images");
  });
});
