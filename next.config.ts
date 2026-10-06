import type { NextConfig } from "next";
import { normalizeBasePath } from "./lib/site";

const nextConfig: NextConfig = {
  // Serve the UI under a URL prefix (e.g. "/kuntorastit"); empty = root.
  basePath: normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH),
};

export default nextConfig;
