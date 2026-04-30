"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Toast from "@/components/ui/Toast";

export default function ResetPasswordPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      setTone("error");
      setMessage("Please enter your email address.");
      return;
    }

    setLoading(true);

    const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      setTone("error");
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setTone("success");
    setMessage("Password reset email sent. Please check your inbox.");
    setLoading(false);
    setEmail("");
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-6 py-10 lg:px-8">
        <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm backdrop-blur">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
              Account Access
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              Reset Password
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enter your email address and we’ll send you a secure password reset
              link.
            </p>
          </div>

          {message && (
            <div className="mt-4">
              <Toast message={message} tone={tone} />
            </div>
          )}

          <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email address
              </label>
              <input
                type="email"
                autoComplete="email"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <Link
              href="/login"
              className="text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Back to login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}