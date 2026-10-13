/**
 * Identifies a complaint photo or video from its first bytes (E15-T5). The
 * declared type and name are under the uploader's control, so neither is
 * trusted, as with ID proofs.
 */
export type ComplaintFileType = {
  mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/quicktime";
  ext: string;
  kind: "photo" | "video";
};

export const COMPLAINT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const COMPLAINT_VIDEO_MAX_BYTES = 20 * 1024 * 1024;

const ascii = (head: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...head.subarray(from, to));

export function detectComplaintFileType(head: Uint8Array): ComplaintFileType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", kind: "photo" };
  }
  if (
    head.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => head[i] === byte)
  ) {
    return { mime: "image/png", ext: "png", kind: "photo" };
  }
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", kind: "photo" };
  }
  // ISO media: a box size, then "ftyp", then the brand.
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    return ascii(head, 8, 10) === "qt"
      ? { mime: "video/quicktime", ext: "mov", kind: "video" }
      : { mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  return null;
}

/** Checks a file's real type and size; returns the type or why it was refused. */
export function checkComplaintFile(
  bytes: Uint8Array,
  { photosOnly = false }: { photosOnly?: boolean } = {},
): { ok: true; type: ComplaintFileType } | { ok: false; error: string } {
  const type = detectComplaintFileType(bytes.subarray(0, 12));
  if (!type || (photosOnly && type.kind !== "photo")) {
    return {
      ok: false,
      error: photosOnly
        ? "Upload a JPG, PNG or WebP photo"
        : "Upload a photo (JPG, PNG, WebP) or a video (MP4, MOV)",
    };
  }
  const max = type.kind === "photo" ? COMPLAINT_PHOTO_MAX_BYTES : COMPLAINT_VIDEO_MAX_BYTES;
  if (bytes.length > max) {
    return {
      ok: false,
      error:
        type.kind === "photo"
          ? "A photo must be 5 MB or smaller"
          : "A video must be 20 MB or smaller",
    };
  }
  return { ok: true, type };
}
