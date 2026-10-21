/**
 * Identifies a complaint photo or video from its first bytes (ClickUp EP-15
 * T5). The browser's declared type and the file name are both under the
 * user's control, so neither is trusted.
 */
export type ComplaintMediaType = {
  mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm" | "video/quicktime";
  ext: string;
  video: boolean;
};

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;

const starts = (head: Uint8Array, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length &&
  bytes.every((byte, index) => head[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

export function detectComplaintMedia(head: Uint8Array): ComplaintMediaType | null {
  if (starts(head, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", video: false };
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: "png", video: false };
  }
  if (starts(head, ascii("RIFF")) && starts(head, ascii("WEBP"), 8)) {
    return { mime: "image/webp", ext: "webp", video: false };
  }
  if (starts(head, [0x1a, 0x45, 0xdf, 0xa3]))
    return { mime: "video/webm", ext: "webm", video: true };
  if (starts(head, ascii("ftyp"), 4)) {
    return starts(head, ascii("qt  "), 8)
      ? { mime: "video/quicktime", ext: "mov", video: true }
      : { mime: "video/mp4", ext: "mp4", video: true };
  }
  return null;
}
