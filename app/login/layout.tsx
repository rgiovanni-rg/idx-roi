import type { Metadata } from "next";

// Login route: no client/org-specific labels in metadata; crawler directives are defense-in-depth
// alongside root layout + X-Robots-Tag + robots.txt.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Restricted access.",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
