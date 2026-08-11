import { HOUSEHOLD_ID } from "@shared/schema";

/**
 * Receipt photos in R2.
 *
 * The dangerous part of this feature is not storage, it is that the app would be serving
 * user-uploaded bytes from its own origin. If a caller can choose the content type, they can upload
 * an HTML file and have it executed on the same origin as the ledger — every token and every
 * IndexedDB record in reach. So the type is never taken from the request: it is inferred from the
 * bytes themselves, checked against an allowlist, and served with `nosniff` so a browser cannot
 * decide to disagree.
 *
 * Keys are generated here and namespaced by household. A key supplied by a caller is never used to
 * address the bucket — the backup download endpoint learned that lesson first, and the same rule
 * applies with more force to an endpoint that also writes.
 */

/**
 * The only types that may be stored or served. Four is enough: these cover every phone camera.
 *
 * Keyed by extension because the extension is what the key carries, and the served content type has
 * to be derivable from the key alone — otherwise the bytes in the bucket and the type on the response
 * could disagree, which is the whole thing this file is guarding against.
 */
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/**
 * 4 MB. A downscaled photo is 200–400 kB, so this is loose enough never to reject a real receipt and
 * tight enough that a mistake cannot fill the bucket. The client downscales before sending; this is
 * the backstop for a client that does not.
 */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

export interface DetectedImage {
  type: string;
  extension: string;
}

/**
 * Identifies an image from its leading bytes, or returns null.
 *
 * HEIC is checked by its ftyp brand rather than a fixed prefix: the first four bytes are a length,
 * not a signature, so matching on them alone would accept anything.
 */
export function detectImage(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length < 12) return null;

  const startsWith = (magic: number[]) => magic.every((byte, index) => bytes[index] === byte);
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.slice(from, to)));

  if (startsWith([0xff, 0xd8, 0xff])) return { type: "image/jpeg", extension: "jpg" };
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return { type: "image/png", extension: "png" };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && ascii(8, 12) === "WEBP") {
    return { type: "image/webp", extension: "webp" };
  }
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    // What an iPhone produces, in its several spellings.
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) {
      return { type: "image/heic", extension: "heic" };
    }
  }
  return null;
}

/** Where a receipt lives. Household-scoped, so a key can be checked before it is used. */
export function receiptKey(id: string, extension: string): string {
  return `receipts/${HOUSEHOLD_ID}/${id}.${extension}`;
}

/**
 * Whether a key is one this household may read.
 *
 * The extension is constrained too. Without it a key could name an object that a future feature put
 * under the same prefix with a type this endpoint would then serve as an image.
 */
export function isOwnReceiptKey(key: string): boolean {
  const extensions = Object.keys(TYPES).join("|");
  return new RegExp(`^receipts/${HOUSEHOLD_ID}/[0-9a-f-]{36}\\.(${extensions})$`).test(key);
}

/** Content type from the key's extension, so the stored bytes and the served type cannot diverge. */
export function typeForKey(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1);
  // Anything unrecognised is served as a download rather than rendered, which is the safe default
  // even though isOwnReceiptKey should already have rejected it.
  return TYPES[extension] ?? "application/octet-stream";
}

export interface StoredReceipt {
  key: string;
  bytes: number;
  type: string;
}

export async function storeReceipt(
  bucket: R2Bucket,
  body: ArrayBuffer,
): Promise<StoredReceipt | { error: string; status: 400 | 413 }> {
  if (body.byteLength === 0) return { error: "empty upload", status: 400 };
  if (body.byteLength > MAX_RECEIPT_BYTES) {
    return { error: "receipt is larger than 4 MB", status: 413 };
  }

  const bytes = new Uint8Array(body);
  const detected = detectImage(bytes);
  if (!detected) return { error: "not a JPEG, PNG, WebP or HEIC image", status: 400 };

  const key = receiptKey(crypto.randomUUID(), detected.extension);
  await bucket.put(key, body, {
    httpMetadata: { contentType: detected.type },
  });

  return { key, bytes: body.byteLength, type: detected.type };
}

/** Removes a receipt. Used when one is replaced, so a swap does not leave the old object behind. */
export async function deleteReceipt(bucket: R2Bucket, key: string): Promise<boolean> {
  if (!isOwnReceiptKey(key)) return false;
  await bucket.delete(key);
  return true;
}
