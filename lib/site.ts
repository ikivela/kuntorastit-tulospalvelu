// Single source of truth for the site's display name. Override per
// deployment via NEXT_PUBLIC_SITE_NAME in .env (see .env.example).
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Kuntorastit";

// Organising club shown under the site name, in page headings and the footer.
// Empty = not shown. Set via NEXT_PUBLIC_CLUB_NAME in .env.
export const CLUB_NAME = process.env.NEXT_PUBLIC_CLUB_NAME?.trim() ?? "";

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

// Logo and favicon: a path under public/ (e.g. /brand/logo.png, prefixed with
// BASE_PATH automatically) or an absolute https:// URL.
export const LOGO_URL = assetUrl(process.env.NEXT_PUBLIC_LOGO_URL, "/logo.svg");
export const FAVICON_URL = assetUrl(process.env.NEXT_PUBLIC_FAVICON_URL, "/logo.svg");

// Event location defaults: map centre ("lat,lon") when an event has no pin
// yet, and a town appended to address searches (empty = none).
export const MAP_CENTER = parseCenter(process.env.NEXT_PUBLIC_MAP_CENTER);
export const DEFAULT_CITY = process.env.NEXT_PUBLIC_DEFAULT_CITY?.trim() ?? "";

// Payment methods prefilled for a new event (separated by ";") and the help
// text above the payment choice in the registration form.
export const DEFAULT_PAYMENT_METHODS = (process.env.NEXT_PUBLIC_DEFAULT_PAYMENT_METHODS ?? "").split(";").map((value) => value.trim()).filter(Boolean);
export const PAYMENT_HINT = process.env.NEXT_PUBLIC_PAYMENT_HINT?.trim() || "Valitse haluamasi maksutapa.";

function assetUrl(value: string | undefined, fallback: string): string {
  const url = value?.trim() || fallback;
  return /^[a-z]+:\/\//i.test(url) ? url : withBasePath(url.startsWith("/") ? url : `/${url}`);
}

function parseCenter(value: string | undefined): { latitude: number; longitude: number; zoom: number } {
  const [latitude, longitude] = (value ?? "").split(",").map((part) => Number(part.trim()));
  // Without a configured centre, show the whole of Finland.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !value?.includes(",")) return { latitude: 64.5, longitude: 26, zoom: 5 };
  return { latitude, longitude, zoom: 13 };
}

export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}
