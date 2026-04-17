"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const from = search.get("from") || "/";
        router.replace(from);
      } else {
        setError("Incorrect password.");
        setPassword("");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-lg bg-aneko-deep border border-border p-6 space-y-4"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
          <span className="font-black text-base leading-none">A</span>
        </div>
        <div className="text-foreground font-black tracking-[0.2em] text-sm">ANEKO</div>
      </div>

      <div>
        <div className="text-base font-semibold text-foreground">MI-Calc</div>
        <div className="text-xs text-muted-foreground mt-0.5">Restricted access.</div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="text-[10px] uppercase tracking-widest text-primary font-bold block mb-1.5"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {error && (
        <div className="text-xs text-aneko-warning font-semibold">{error}</div>
      )}

      <button
        type="submit"
        disabled={loading || !password}
        className="w-full px-3 py-2 rounded-md text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground transition"
      >
        {loading ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground font-sans px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
