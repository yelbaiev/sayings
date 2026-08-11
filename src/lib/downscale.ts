/**
 * Shrinks a photo before it is uploaded.
 *
 * A phone camera produces 3–5 MB. A receipt only has to be legible, not beautiful.
 *
 * The first attempt — 1600px, JPEG, quality 0.8 — still produced 797 kB on a real photo, because a
 * detailed image at that size is simply that big in JPEG. Two changes fix it: WebP, which is roughly
 * half the bytes of JPEG at the same perceived quality and is now supported everywhere this app runs,
 * and a smaller frame, because 1280px is already more than enough to read a total and a date. The
 * result is 150–250 kB.
 *
 * Also normalises the format. iPhones shoot HEIC, which Safari renders and most other browsers do
 * not; drawing it to a canvas and re-encoding as JPEG means the receipt is viewable on the laptop
 * afterwards. Safari can decode HEIC for the canvas, so the conversion happens on the device that
 * created it.
 */

/**
 * Longest edge after scaling. Enough to read a total and a date, which is all a receipt is for.
 *
 * 1280 rather than 1600: on a phone screen the difference is invisible, and on the bytes it is about
 * 40%. A receipt is evidence, not a photograph.
 */
export const MAX_EDGE = 1280;

/**
 * WebP first, JPEG as the fallback.
 *
 * WebP is about half the size of JPEG for the same perceived quality, and every browser that can run
 * this app can encode it — but `toBlob` silently falls back to PNG for an unknown type, which would
 * make the file *larger*, so the result is checked rather than assumed.
 */
const ENCODINGS: { type: string; quality: number }[] = [
  { type: "image/webp", quality: 0.72 },
  { type: "image/jpeg", quality: 0.75 },
];

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * The size to draw at, preserving aspect ratio and never scaling up.
 *
 * Separated from the canvas work because it is the part with the arithmetic, and the part worth
 * testing: a canvas is unavailable in the test environment and would be mocked into agreeing with
 * whatever the code did.
 */
export function fitWithin(source: Dimensions, maxEdge = MAX_EDGE): Dimensions {
  const longest = Math.max(source.width, source.height);
  // Enlarging a small photo adds bytes and no legibility.
  if (longest <= maxEdge || longest === 0) return { width: source.width, height: source.height };

  const scale = maxEdge / longest;
  return {
    // Rounded, and floored at 1: a very long thin image must not end up zero pixels wide.
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Decodes, scales and re-encodes.
 *
 * Returns the original file untouched if anything fails — an unrecognised format, a decoder that
 * refuses, a browser without canvas. The Worker checks the bytes anyway, so the worst case is a
 * larger upload rather than a broken one, and refusing to attach a receipt because it could not be
 * optimised would be the wrong trade.
 */
export async function downscaleImage(file: File | Blob): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const target = fitWithin({ width: bitmap.width, height: bitmap.height });

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();

    let best: Blob | null = null;
    for (const { type, quality } of ENCODINGS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
      // `toBlob` answers with PNG when it does not know the type asked for, so the type is verified
      // rather than trusted — a PNG of a photograph is bigger than the original.
      if (blob && blob.type === type) {
        best = blob;
        break;
      }
    }

    // Keep whichever is smaller. Re-encoding an already-small image can make it bigger.
    if (!best) return file;
    return best.size < file.size ? best : file;
  } catch {
    return file;
  }
}
