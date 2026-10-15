import "server-only";

import QRCode from "qrcode";

/**
 * A QR code as inline SVG markup, made on the server so no image service
 * sees the link (E13-T10 payment links, E15-T3 room codes). Medium error
 * correction survives a crease or a smudge on a printed code.
 */
export async function qrSvg(text: string, { label }: { label: string }): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  // Name it for screen readers; the markup comes from the library, the
  // label is escaped.
  const escaped = label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return svg.replace("<svg ", `<svg role="img" aria-label="${escaped}" `);
}
