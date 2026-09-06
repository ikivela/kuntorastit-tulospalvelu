import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_NAME}: Kokkolan Suunnistajien kuntorastien tapahtumat, ilmoittautumiset, tulokset ja osallistumiskerrat.`,
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
