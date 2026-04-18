import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Required for absolute OG / Twitter image URLs; set NEXT_PUBLIC_SITE_URL in production. */
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) {
    try {
      return new URL(explicit);
    } catch {
      /* fall through */
    }
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  return new URL("http://localhost:3000");
}

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "ROI Calculator · Aneko AI",
    template: "%s · Aneko AI",
  },
  description: "ROI Calculator — internal use.",
  // app/icon.tsx + app/apple-icon.tsx supply PNG; keep SVG as alternate for supporting browsers
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
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
    title: "ROI Calculator · Aneko AI",
    description: "ROI Calculator — internal use.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ROI Calculator · Aneko AI",
    description: "ROI Calculator — internal use.",
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
