"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchStoredLogoDataUrl } from "@/lib/logo";

type LoginMode = "email" | "sms";

export default function LoginClient() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [logo, setLogo] = useState<string | null>(null);
  const [mode, setMode] = useState<LoginMode>("email");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"default" | "error">(
    "default"
  );
  const [loading, setLoading] = useState(false);

  const next = searchParams.get("next") || "/";

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  function normaliseAustralianPhone(input: string) {
    const raw = String(input || "").trim();

    if (!raw) return "";

    const cleaned = raw.replace(/[^\d+]/g, "");

    if (cleaned.startsWith("+61")) return cleaned;
    if (cleaned.startsWith("61")) return `+${cleaned}`;
    if (cleaned.startsWith("04")) return `+61${cleaned.slice(1)}`;
    if (cleaned.startsWith("4") && cleaned.length === 9) {
      return `+61${cleaned}`;
    }

    return cleaned;
  }

  async function finishLogin() {
    const response = await fetch("/api/auth/check-active", {
      method: "GET",
      cache: "no-store",
    });

    const rawText = await response.text();

    let result: { is_active?: boolean; error?: string } = {};

    try {
      result = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error("Server returned non-JSON response.");
    }

    if (!response.ok) {
      throw new Error(result.error || "Failed to check account status.");
    }

    if (!result.is_active) {
      await supabase.auth.signOut();

      setMessageTone("error");
      setMessage(
        "Your account has been deactivated. Please contact accounts@focusoms.com.au."
      );
      setLoading(false);

      router.replace("/account-inactive");
      router.refresh();
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setMessageTone("default");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      setMessageTone("error");
      setMessage(error.message);
      setLoading(false);
      return;
    }

    try {
      await finishLogin();
    } catch (err) {
      await supabase.auth.signOut();

      setMessageTone("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to complete sign in."
      );
      setLoading(false);
    }
  }

  async function sendSmsCode(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setMessageTone("default");
    setLoading(true);

    try {
      const cleanPhone = normaliseAustralianPhone(phone);

      if (!cleanPhone) {
        setMessageTone("error");
        setMessage("Please enter your mobile number.");
        setLoading(false);
        return;
      }

      const lookupResponse = await fetch("/api/auth/check-phone-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: cleanPhone,
        }),
      });

      const lookupText = await lookupResponse.text();

      let lookupResult: {
        exists?: boolean;
        error?: string;
      } = {};

      try {
        lookupResult = lookupText ? JSON.parse(lookupText) : {};
      } catch {
        throw new Error("Invalid server response.");
      }

      if (!lookupResponse.ok) {
        throw new Error(lookupResult.error || "Failed to verify user.");
      }

      if (!lookupResult.exists) {
        setMessageTone("error");
        setMessage(
          "No account exists for this mobile number. Please contact your administrator."
        );
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({
        phone: cleanPhone,
        options: {
          shouldCreateUser: true,
        },
      });

      if (error) {
        setMessageTone("error");
        setMessage(error.message);
        setLoading(false);
        return;
      }

      setPhone(cleanPhone);
      setOtpSent(true);
      setMessageTone("default");
      setMessage("SMS code sent. Enter the code to continue.");
      setLoading(false);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to send SMS code.");
      setLoading(false);
    }
  }

  async function verifySmsCode(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setMessageTone("default");
    setLoading(true);

    const cleanPhone = normaliseAustralianPhone(phone);

    const { error } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: otpCode.trim(),
      type: "sms",
    });

    if (error) {
      setMessageTone("error");
      setMessage(error.message);
      setLoading(false);
      return;
    }

    try {
      const linkResponse = await fetch("/api/auth/link-phone-session", {
        method: "POST",
      });

      const linkText = await linkResponse.text();

      let linkResult: { error?: string; success?: boolean } = {};

      try {
        linkResult = linkText ? JSON.parse(linkText) : {};
      } catch {
        throw new Error("Server returned non-JSON response while linking phone.");
      }

      if (!linkResponse.ok) {
        throw new Error(linkResult.error || "Failed to link phone login.");
      }

      await finishLogin();
    } catch (err) {
      await supabase.auth.signOut();

      setMessageTone("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to complete sign in."
      );
      setLoading(false);
    }
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
                    Focus Dental Specialists Dashboard
                  </div>
                </div>
              </div>

              <div className="mt-16 max-w-xl">
                <h1 className="text-5xl font-semibold leading-tight">
                  One secure workspace
                  <br />
                  for daily practice
                  <br />
                  workflows.
                </h1>

                <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
                  Quickly access report writing, provider workflows, patient
                  entries, billing, and practice administration from one central
                  dashboard.
                </p>
              </div>
            </div>

            <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-medium text-white">Report writing</div>
                <div className="mt-1">Typist and provider workflows</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-medium text-white">Patient entries</div>
                <div className="mt-1">
                  Lab costs, implants, materials, and corrections
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="font-medium text-white">Practice tools</div>
                <div className="mt-1">
                  Billing, reporting, and administration
                </div>
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
                  Focus Dental Specialists Dashboard
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
              </div>

              <div className="mt-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("email");
                    setMessage("");
                    setMessageTone("default");
                  }}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    mode === "email"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Email
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("sms");
                    setMessage("");
                    setMessageTone("default");
                  }}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    mode === "sms"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  SMS
                </button>
              </div>

              {mode === "email" ? (
                <form onSubmit={handleEmailLogin} className="mt-8 space-y-5">
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
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        messageTone === "error"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
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

                  <div className="mt-4">
                    <Link
                      href="/reset-password"
                      className="text-sm font-medium text-blue-700 hover:text-blue-800"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={otpSent ? verifySmsCode : sendSmsCode}
                  className="mt-8 space-y-5"
                >
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">
                      Mobile number
                    </label>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      placeholder="e.g. 0412 345 678"
                      required
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Australian numbers are converted to +61 format
                      automatically.
                    </p>
                  </div>

                  {otpSent && (
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        SMS code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                        placeholder="Enter 6-digit code"
                        required
                      />
                    </div>
                  )}

                  {message && (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        messageTone === "error"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      {message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading
                      ? "Please wait..."
                      : otpSent
                      ? "Verify code"
                      : "Send SMS code"}
                  </button>

                  {otpSent && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setOtpSent(false);
                        setOtpCode("");
                        setMessage("");
                        setMessageTone("default");
                      }}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Change phone number
                    </button>
                  )}
                </form>
              )}

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