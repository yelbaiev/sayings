import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  MAX_RECEIPT_BYTES,
  deleteReceipt,
  detectImage,
  isOwnReceiptKey,
  storeReceipt,
  typeForKey,
} from "../../worker/receipts";

/**
 * Receipts are the one feature that serves user-supplied bytes from the app's own origin, which makes
 * the content type the security boundary. An HTML file accepted as an image and served with
 * `text/html` would execute beside the ledger, with every token and the whole local mirror in reach.
 *
 * So none of these tests are about storage working. They are about the type never coming from the
 * request, and a key never coming from a caller.
 */

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(12).fill(0)]);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe("detectImage", () => {
  it("recognises the four types a phone camera produces", () => {
    expect(detectImage(bytes(0xff, 0xd8, 0xff))?.type).toBe("image/jpeg");
    expect(detectImage(bytes(0x89, 0x50, 0x4e, 0x47))?.type).toBe("image/png");
    expect(
      detectImage(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]))?.type,
    ).toBe("image/webp");
    expect(
      detectImage(new Uint8Array([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("heic")]))?.type,
    ).toBe("image/heic");
  });

  it("checks HEIC by its brand, not by its first four bytes", () => {
    // Those four bytes are a box length, not a signature. Matching on them would accept anything
    // that happened to start with a small number — which is most files.
    expect(detectImage(new Uint8Array([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("qt  ")]))).toBeNull();
  });

  it("requires the WEBP marker, not just the RIFF container", () => {
    // RIFF is also WAV and AVI. Accepting the container alone would serve audio as an image.
    expect(
      detectImage(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")])),
    ).toBeNull();
  });

  it("rejects HTML, which is the attack this exists to stop", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(detectImage(html)).toBeNull();
  });

  it("rejects an SVG, which is an image and still executes script", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(detectImage(svg)).toBeNull();
  });

  it("rejects anything too short to identify", () => {
    expect(detectImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImage(new Uint8Array())).toBeNull();
  });
});

describe("storeReceipt", () => {
  it("stores a real image and returns a household-scoped key", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, ...new Array(20).fill(1)]);
    const result = await storeReceipt(env.FILES, jpeg.buffer as ArrayBuffer);
    expect("key" in result).toBe(true);
    if (!("key" in result)) return;

    expect(result.key).toMatch(/^receipts\/hh_default\/[0-9a-f-]{36}\.jpg$/);
    expect(result.type).toBe("image/jpeg");

    // And the bytes are really there, with the type derived from them.
    const stored = await env.FILES.get(result.key);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("refuses a disguised file whatever it is called", async () => {
    const html = new TextEncoder().encode("<html><body>not a receipt</body></html>");
    const result = await storeReceipt(env.FILES, html.buffer as ArrayBuffer);
    expect(result).toMatchObject({ status: 400 });
  });

  it("refuses an empty upload rather than storing a zero-byte object", async () => {
    expect(await storeReceipt(env.FILES, new ArrayBuffer(0))).toMatchObject({ status: 400 });
  });

  it("refuses anything over the size limit", async () => {
    const big = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(await storeReceipt(env.FILES, big.buffer as ArrayBuffer)).toMatchObject({ status: 413 });
  });
});

describe("isOwnReceiptKey", () => {
  const uuid = "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b";

  it("accepts a key this household generated", () => {
    expect(isOwnReceiptKey(`receipts/hh_default/${uuid}.jpg`)).toBe(true);
  });

  it("refuses to reach outside the receipts prefix", () => {
    // The endpoint that serves these takes a key from the URL. Without this, a backup — which is the
    // entire household in one file — could be read through it.
    expect(isOwnReceiptKey("backups/daily/2026-08-06.json")).toBe(false);
    expect(isOwnReceiptKey(`receipts/../backups/daily/2026-08-06.json`)).toBe(false);
    expect(isOwnReceiptKey(`receipts/hh_default/../../backups/x.json`)).toBe(false);
  });

  it("refuses another household's prefix", () => {
    expect(isOwnReceiptKey(`receipts/hh_other/${uuid}.jpg`)).toBe(false);
  });

  it("refuses an extension outside the allowlist", () => {
    // Which is what stops a key naming something this endpoint would then serve as an image.
    expect(isOwnReceiptKey(`receipts/hh_default/${uuid}.html`)).toBe(false);
    expect(isOwnReceiptKey(`receipts/hh_default/${uuid}.svg`)).toBe(false);
    expect(isOwnReceiptKey(`receipts/hh_default/${uuid}`)).toBe(false);
  });

  it("refuses a name that is not a uuid", () => {
    expect(isOwnReceiptKey("receipts/hh_default/receipt.jpg")).toBe(false);
  });
});

describe("typeForKey", () => {
  it("derives the type from the key, so the bytes and the header cannot diverge", () => {
    expect(typeForKey("receipts/hh_default/x.jpg")).toBe("image/jpeg");
    expect(typeForKey("receipts/hh_default/x.webp")).toBe("image/webp");
  });

  it("falls back to a type no browser will execute", () => {
    expect(typeForKey("receipts/hh_default/x.weird")).toBe("application/octet-stream");
  });
});

describe("deleteReceipt", () => {
  it("removes a receipt of ours", async () => {
    // At least 12 bytes: detectImage needs to see a header before it will identify anything, and no
    // real photograph is shorter.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, ...new Array(20).fill(7)]);
    const stored = await storeReceipt(env.FILES, jpeg.buffer as ArrayBuffer);
    if (!("key" in stored)) throw new Error(`setup failed: ${JSON.stringify(stored)}`);

    expect(await deleteReceipt(env.FILES, stored.key)).toBe(true);
    expect(await env.FILES.get(stored.key)).toBeNull();
  });

  it("refuses to delete anything that is not a receipt of ours", async () => {
    // The same key check as reading, for the same reason and with more consequence: this one
    // destroys. A backup must not be deletable through the receipts endpoint.
    await env.FILES.put("backups/daily/2026-08-06.json", "{}");
    expect(await deleteReceipt(env.FILES, "backups/daily/2026-08-06.json")).toBe(false);
    expect(await env.FILES.get("backups/daily/2026-08-06.json")).not.toBeNull();
  });
});
