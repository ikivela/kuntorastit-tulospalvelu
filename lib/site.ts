// Single source of truth for the site's display name. Override per
// deployment via NEXT_PUBLIC_SITE_NAME in .env (see .env.example).
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "KoS-Kuntorastit";
