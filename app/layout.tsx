import type { Metadata } from "next";
import { SITE_NAME, withBasePath } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_NAME}: Kokkolan Suunnistajien kuntorastien tapahtumat, ilmoittautumiset, tulokset ja osallistumiskerrat.`,
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [
      { url: withBasePath("/favicon.ico"), sizes: "any" },
      { url: withBasePath("/favicon-32x32.png"), sizes: "32x32", type: "image/png" },
      { url: withBasePath("/favicon-192x192.png"), sizes: "192x192", type: "image/png" },
    ],
    shortcut: withBasePath("/favicon.ico"),
    apple: withBasePath("/apple-touch-icon.png"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
