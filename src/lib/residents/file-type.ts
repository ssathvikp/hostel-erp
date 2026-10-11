/**
 * Identifies an uploaded ID proof from its first bytes. The browser's
 * declared type and the file name are both under the user's control, so
 * neither is trusted (E5-T7).
 */
export type IdProofFileType = { mime: "application/pdf" | "image/jpeg" | "image/png"; ext: string };

const SIGNATURES: { bytes: number[]; type: IdProofFileType }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], type: { mime: "application/pdf", ext: "pdf" } }, // %PDF-
  { bytes: [0xff, 0xd8, 0xff], type: { mime: "image/jpeg", ext: "jpg" } },
  {
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    type: { mime: "image/png", ext: "png" },
  },
];

export function detectIdProofType(head: Uint8Array): IdProofFileType | null {
  for (const { bytes, type } of SIGNATURES) {
    if (head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte)) {
      return type;
    }
  }
  return null;
}
