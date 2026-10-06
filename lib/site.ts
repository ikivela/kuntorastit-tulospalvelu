// Single source of truth for the site's display name. Override per
// deployment via NEXT_PUBLIC_SITE_NAME in .env (see .env.example).
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "KoS-Kuntorastit";

// URL path prefix the web UI is served under, e.g. "/kuntorastit" (empty =
// domain root). Same value as next.config.ts's basePath; set via
// NEXT_PUBLIC_BASE_PATH at build time.
export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

// Prefixes an absolute app path ("/kalenteri") with BASE_PATH. Needed for
// plain <a href>, <img src>, metadata and window.location — next/link and
// next/navigation's router already apply basePath themselves.
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}

// REST API base URL. Defaults to /api/v1 under the same base path as the UI
// (e.g. /kuntorastit/api/v1); override with NEXT_PUBLIC_API_BASE_URL to point
// elsewhere (another path or a full https://… URL).
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || withBasePath("/api/v1")).replace(/\/+$/, "");

export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}
