import type { Metadata } from "next";
import { CLUB_NAME, FAVICON_URL, SITE_NAME } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_NAME}${CLUB_NAME ? ` (${CLUB_NAME})` : ""}: kuntorastien tapahtumat, ilmoittautumiset, tulokset ja osallistumiskerrat.`,
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: FAVICON_URL,
    shortcut: FAVICON_URL,
    apple: FAVICON_URL,
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
