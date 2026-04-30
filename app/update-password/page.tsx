"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Toast from "@/components/ui/Toast";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      setHasSession(Boolean(session));
      setCheckingSession(false);

      if (!session) {
        setTone("error");
        setMessage(
          "Your password reset session is missing or has expired. Please request a new reset link."
        );
      }
    }

    checkSession();

    return () => {
      isMounted = false;
    };
  }, [supabase]);

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!hasSession) {
      setTone("error");
      setMessage(
        "Your password reset session is missing or has expired. Please request a new reset link."
      );
      return;
    }

    if (!password.trim()) {
      setTone("error");
      setMessage("Please enter a new password.");
      return;
    }

    if (password.length < 8) {
      setTone("error");
      setMessage("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setTone("error");
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setTone("error");
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setTone("success");
    setMessage("Password updated successfully. Redirecting to login...");

    setPassword("");
    setConfirmPassword("");

    await supabase.auth.signOut();

    setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1000);
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
              Set New Password
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enter your new password below to finish resetting your account.
            </p>
          </div>

          {message && (
            <div className="mt-4">
              <Toast message={message} tone={tone} />
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                New password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                disabled={loading || checkingSession || !hasSession}
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Confirm new password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                disabled={loading || checkingSession || !hasSession}
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
              />
            </div>

            <button
              type="submit"
              disabled={loading || checkingSession || !hasSession}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingSession
                ? "Checking reset link..."
                : loading
                  ? "Saving..."
                  : "Update Password"}
            </button>
          </form>

          {!hasSession && !checkingSession && (
            <div className="mt-4">
              <Link
                href="/reset-password"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
              >
                Request a new reset link
              </Link>
            </div>
          )}

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