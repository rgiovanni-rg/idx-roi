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
        // Use replace so the login page isn't in the back-button history
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
      className="w-full max-w-sm rounded-lg bg-slate-900 border border-slate-700 p-6 space-y-4"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-violet-500 flex items-center justify-center">
          <span className="text-white font-black text-base leading-none">A</span>
        </div>
        <div className="text-white font-black tracking-[0.2em] text-sm">ANEKO</div>
      </div>

      <div>
        <div className="text-base font-semibold text-white">ROI calculator</div>
        <div className="text-xs text-slate-400 mt-0.5">Restricted access.</div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="text-[10px] uppercase tracking-widest text-violet-400 font-bold block mb-1.5"
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
          className="w-full bg-slate-950 border border-slate-600 rounded-md px-3 py-2 text-sm text-white focus:border-violet-400 focus:outline-none"
        />
      </div>

      {error && (
        <div className="text-xs text-orange-400 font-semibold">{error}</div>
      )}

      <button
        type="submit"
        disabled={loading || !password}
        className="w-full px-3 py-2 rounded-md text-sm font-semibold text-white bg-violet-500 hover:bg-violet-400 disabled:bg-slate-700 disabled:text-slate-400 transition"
      >
        {loading ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-white font-sans px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
