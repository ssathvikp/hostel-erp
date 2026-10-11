import type { NextConfig } from "next";

/**
 * Sent with every response. None of these restrict scripts or styles, so
 * they cannot break the app; they stop it being framed (clickjacking), stop
 * forms posting elsewhere, keep full URLs (which can hold search text such
 * as names or phone numbers) from leaking to other sites, and switch off
 * browser features the app never uses.
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Browsers ignore this over plain HTTP, so local development is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // ID proof uploads go through a server action (E5-T7). The action
      // itself rejects anything over 5 MB; this leaves room for the form
      // fields and multipart overhead around the file.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
