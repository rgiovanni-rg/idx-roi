import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

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
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
