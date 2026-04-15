"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/billing", label: "Billing" },
  { href: "/patient-entries", label: "Patient Entries" },
  { href: "/billing-details", label: "Billing Details" },
  { href: "/providers", label: "Providers" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">

        {/* LEFT */}
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border bg-white">
            {logo ? (
              <img src={logo} className="h-8 w-8 object-contain" />
            ) : (
              <div className="h-8 w-8 bg-slate-100" />
            )}
          </div>

          <div>
            <div className="text-sm text-slate-500">
              Focus Dental Specialists
            </div>
            <div className="text-lg font-semibold">
              Service Fee Dashboard
            </div>
          </div>
        </Link>

        {/* RIGHT */}
        <div className="flex items-center gap-2">
          {navItems.map((item) => {
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3 py-2 text-sm ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <button
            onClick={handleLogout}
            className="ml-2 rounded-xl border px-3 py-2 text-sm"
          >
            Log out
          </button>
        </div>

      </div>
    </header>
  );
}