import { NextRequest, NextResponse } from "next/server";

// Edge middleware: require a signed session cookie for every route except
// /login, /api/login, Next internals, and static assets. HMAC verifies the
// cookie was issued by this server (secret lives in SESSION_SECRET env var).

const SESSION_COOKIE = "idx_session";

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifySession(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !payload.startsWith("v1:")) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sig) as BufferSource,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths — do not gate
  // Next.js metadata routes (no file extension): /icon, /apple-icon, /opengraph-image, etc.
  const isMetadataImageRoute =
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/opengraph-image" ||
    pathname === "/twitter-image";

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    isMetadataImageRoute ||
    /\.(svg|png|jpg|jpeg|ico|webp|woff2?|css|js|map)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const secret = process.env.SESSION_SECRET ?? "";

  if (secret && (await verifySession(token, secret))) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Preserve where the user was headed, minus any URL hash (hash never reaches the server)
  if (pathname !== "/") url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
