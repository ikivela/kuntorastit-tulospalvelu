import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maanantairastien tulospalvelu",
  description: "Kokkolan maanantairastien tapahtumat, ilmoittautumiset, tulokset ja osallistumiskerrat.",
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
