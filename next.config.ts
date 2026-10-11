import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // ID proof uploads go through a server action (E5-T7). The action
      // itself rejects anything over 5 MB; this leaves room for the form
      // fields and multipart overhead around the file.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
