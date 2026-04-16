"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchStoredLogoDataUrl } from "@/lib/logo";

export default function LoginClient() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [logo, setLogo] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const next = searchParams.get("next") || "/";

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-2">
        <div className="hidden lg:flex">
          <div className="flex w-full flex-col justify-between bg-slate-900 px-12 py-14 text-white">
            <div>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/15">
                  {logo ? (
                    <img
                      src={logo}
                      alt="Focus logo"
                      className="h-12 w-12 object-contain"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-2xl bg-white/20" />
                  )}
                </div>

                <div>
                  <div className="text-sm font-medium uppercase tracking-[0.2em] text-slate-300">
                    Focus Dental Specialists
                  </div>
                  <div className="text-2xl font-semibold tracking-tight">
                    Service Fee Dashboard
                  </div>
                </div>
              </div>

              <div className="mt-16 max-w-xl">
                <h1 className="text-5xl font-semibold leading-tight">
                  Practice financials,
                  <br />
                  billing, and provider statements
                  <br />
                  in one place.
                </h1>

                <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
                  Securely manage monthly service fee generation, patient costs entries, provider
                  statements, and financial reporting.
                </p>
              </div>
            </div>

            <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-medium text-white">Monthly billing</div>
                <div className="mt-1">Service fee calculation and locking</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-medium text-white">Provider statements</div>
                <div className="mt-1">Export and email draft statements</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-medium text-white">Admin controls</div>
                <div className="mt-1">Roles, materials, and financial insights</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-4 lg:hidden">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                {logo ? (
                  <img
                    src={logo}
                    alt="Focus logo"
                    className="h-10 w-10 object-contain"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-xl bg-slate-100" />
                )}
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Focus Dental Specialists
                </div>
                <div className="text-xl font-semibold tracking-tight text-slate-900">
                  Service Fee Dashboard
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
              <div>
                <div className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
                  Welcome back
                </div>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                  Sign in to continue
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Access your billing dashboard, statements, provider records,
                  and admin tools securely.
                </p>
              </div>

              <form onSubmit={handleLogin} className="mt-8 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Email address
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                    placeholder="you@focusoms.com.au"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Password
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                    placeholder="Enter your password"
                    required
                  />
                </div>

                {message && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>

              <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                For access changes or account support, contact{" "}
                <a
                  href="mailto:accounts@focusoms.com.au"
                  className="font-medium text-sky-700 underline"
                >
                  accounts@focusoms.com.au
                </a>
                .
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}