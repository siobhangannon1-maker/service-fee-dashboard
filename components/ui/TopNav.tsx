"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "Home", description: "Home" },
  { href: "/billing", label: "Service Fees", description: "Generate and Export Service Fees" },
  {
    href: "/patient-entries",
    label: "Consumables & Incorrect Payments",
    description: "Enter Consumables / Incorrect Payments",
  },
  {
    href: "/billing-details",
    label: "Merchant Fees",
    description: "Enter Merchant Fees",
  },
  {
    href: "/material-costs",
    label: "Materials Costs",
    description: "Update Implant & Materials Costs",
  },
  {
    href: "/admin",
    label: "Admin",
    description: "Admin settings and configuration",
  },
  {
    href: "/financials",
    label: "Financials",
    description: "Financial Dashboard",
  },
  {
    href: "/benchmark/expense-reports",
    label: "Benchmarking",
    description: "Benchmark Reports",
  },
];

function NavItemLink({
  href,
  label,
  description,
  active,
}: {
  href: string;
  label: string;
  description: string;
  active: boolean;
}) {
  return (
    <div className="group relative">
      <Link
        href={href}
        aria-label={description}
        className={`inline-flex whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition ${
          active
            ? "bg-slate-900 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {label}
      </Link>

      <div className="pointer-events-none absolute left-1/2 top-full z-[100] mt-3 -translate-x-1/2 opacity-0 transition duration-200 group-hover:opacity-100">
        <div className="mx-auto mb-[-6px] h-3 w-3 rotate-45 border-l border-t border-slate-200 bg-slate-100" />
        <div className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-center text-xs font-medium leading-5 text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.12)] whitespace-nowrap">
          {description}
        </div>
      </div>
    </div>
  );
}

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
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex min-h-[90px] items-center justify-between gap-6 py-3">

          {/* LEFT SIDE */}
          <Link href="/" className="group flex items-center gap-5">
            
            {/* BIGGER LOGO */}
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.12)] transition duration-200 group-hover:scale-[1.03]">
              {logo ? (
                <img
                  src={logo}
                  alt="Practice logo"
                  className="h-13 w-13 object-contain"
                />
              ) : (
                <div className="h-12 w-12 rounded-2xl bg-slate-100" />
              )}
            </div>

            {/* SINGLE CLEAN TITLE */}
            <div className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 font-serif">
  Focus Dental Specialists Dashboard
</div>
          </Link>

          {/* RIGHT SIDE */}
          <div className="hidden items-center gap-3 2xl:flex">
            <nav className="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-[0_6px_18px_rgba(15,23,42,0.05)] backdrop-blur">
              {navItems.map((item) => (
                <NavItemLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  description={item.description}
                  active={isActive(item.href)}
                />
              ))}
            </nav>

            {/* LIGHT BLUE LOGOUT BUTTON */}
            <button
              onClick={handleLogout}
              className="rounded-2xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-[0_6px_18px_rgba(15,23,42,0.25)] transition hover:bg-slate-900"
            >
              Log out
            </button>
          </div>
        </div>

        {/* MOBILE / WRAP NAV */}
        <div className="hidden pb-3 xl:block 2xl:hidden">
          <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-[0_6px_18px_rgba(15,23,42,0.05)] backdrop-blur">
            {navItems.map((item) => (
              <NavItemLink
                key={item.href}
                href={item.href}
                label={item.label}
                description={item.description}
                active={isActive(item.href)}
              />
            ))}

            <button
              onClick={handleLogout}
              className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-900"
            >
              Log out
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}