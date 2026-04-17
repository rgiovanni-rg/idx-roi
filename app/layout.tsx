import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ROI calculator · Aneko AI",
    template: "%s · Aneko AI",
  },
  description: "ROI calculator — internal use.",
  icons: { icon: "/favicon.svg" },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      nosnippet: true,
      noarchive: true,
    },
  },
  openGraph: {
    title: "ROI calculator · Aneko AI",
    description: "ROI calculator — internal use.",
  },
  twitter: {
    card: "summary",
    title: "ROI calculator · Aneko AI",
    description: "ROI calculator — internal use.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white antialiased">{children}</body>
    </html>
  );
}
