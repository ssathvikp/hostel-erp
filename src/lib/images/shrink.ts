/**
 * Shrinks a photo in the browser before it is uploaded (E15-T5): phone
 * photos are often 4-8 MB, which wastes storage and a resident's or
 * worker's mobile data. Anything that is not a large image is returned as
 * it is; the server still checks the real type and size.
 */

export const MAX_DIMENSION = 1600;
const QUALITY = 0.82;
const SMALL_ENOUGH = 600 * 1024;

/** The longest side scaled to `max`, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max = MAX_DIMENSION) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SMALL_ENOUGH) return file;
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/**
 * For a file input's change event: replaces its photos with shrunken
 * copies, so the form submits the small versions.
 */
export async function shrinkInputFiles(input: HTMLInputElement): Promise<void> {
  const files = Array.from(input.files ?? []);
  if (files.length === 0 || typeof DataTransfer === "undefined") return;
  const shrunk = await Promise.all(files.map(shrinkImage));
  if (shrunk.every((file, i) => file === files[i])) return;
  const transfer = new DataTransfer();
  for (const file of shrunk) transfer.items.add(file);
  input.files = transfer.files;
}
