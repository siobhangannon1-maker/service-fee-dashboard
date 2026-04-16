"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/billing", label: "Billing" },
  { href: "/patient-entries", label: "Consumables/Incorrect Payments" },
  { href: "/billing-details", label: "Merchant Fees/Billing Details" },
  { href: "/providers", label: "Providers" },
  { href: "/material-costs", label: "Implants/Materials Costs" },
  { href: "/admin/users", label: "Admin" },{ href: "/financials", label: "Financial Dashboard" },
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
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {logo ? (
              <img
                src={logo}
                alt="Practice logo"
                className="h-8 w-8 object-contain"
              />
            ) : (
              <div className="h-8 w-8 rounded-xl bg-slate-100" />
            )}
          </div>

          <div className="leading-tight">
            <div className="text-sm font-medium text-slate-500">
              Focus Dental Specialists
            </div>
            <div className="text-lg font-semibold tracking-tight text-slate-900">
              Service Fee Dashboard
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          {navItems.map((item) => {
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <button
            onClick={handleLogout}
            className="ml-2 rounded-xl border px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}