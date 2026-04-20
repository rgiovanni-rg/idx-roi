import { NextRequest, NextResponse } from "next/server";

// POST /api/login — validate password, set signed session cookie.
// Uses HMAC-SHA256 over a timestamped payload so the middleware can verify
// authenticity without any server-side session store.

export const runtime = "edge";

const SESSION_COOKIE = "idx_session";
const SESSION_TTL_DAYS = 7;

function bytesToB64url(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signSession(secret: string): Promise<string> {
  const payload = `v1:${Date.now()}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${bytesToB64url(sig)}`;
}

/** IP-derived location from Vercel edge (only on deployed Vercel; empty locally). */
function clientGeo(req: NextRequest): {
  country?: string;
  region?: string;
  city?: string;
} {
  const country = req.headers.get("x-vercel-ip-country")?.trim() || undefined;
  const region = req.headers.get("x-vercel-ip-country-region")?.trim() || undefined;
  const city = req.headers.get("x-vercel-ip-city")?.trim() || undefined;
  return { country, region, city };
}

// Constant-time-ish string compare
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as { password?: string });
  const password = (body as { password?: string }).password ?? "";

  const expected = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!expected || !secret) {
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 },
    );
  }
  if (!password || !safeEqual(password, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Searchable in hosting logs (e.g. Vercel → Logs) — confirms password was correct.
  // `country` / `region` / `city` come from Vercel geo headers (IP-based, not exact GPS).
  const { country, region, city } = clientGeo(req);
  const logPayload: Record<string, string> = {
    at: new Date().toISOString(),
  };
  if (country) logPayload.country = country;
  if (region) logPayload.region = region;
  if (city) logPayload.city = city;
  console.info("[roi-calc-auth-success]", JSON.stringify(logPayload));

  const token = await signSession(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
  return res;
}
