"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "Home", description: "Home" },
  {
    href: "/billing",
    label: "Service Fees",
    description: "Generate and Export Service Fees",
  },
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
    href: "/admin/reports",
    label: "Financial Reports",
    description: "Financial Reports",
  },
  {
    href: "/practice-manager",
    label: "Practice Manager",
    description: "Benchmarks, staffing and new patients",
  },
  {
    href: "/provider",
    label: "Provider",
    description: "Provider Metrics",
  },
];

function DesktopNavItem({
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
        className={`inline-flex whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition ${
          active
            ? "bg-slate-900 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {label}
      </Link>

      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
        {description}
      </div>
    </div>
  );
}

function MobileNavItem({
  href,
  label,
  description,
  active,
  onClick,
}: {
  href: string;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-2xl border px-4 py-3 transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div
        className={`mt-1 text-xs leading-5 ${
          active ? "text-slate-200" : "text-slate-500"
        }`}
      >
        {description}
      </div>
    </Link>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [logo, setLogo] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setMobileMenuOpen(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
      <div className="w-full px-3 sm:px-5 xl:px-6">
        <div className="flex min-h-[88px] items-center justify-between gap-4 py-3">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-4 pr-4"
          >
            <div className="flex shrink-0 items-center justify-center">
              {logo ? (
                <img
                  src={logo}
                  alt="Practice logo"
                  className="h-16 w-auto object-contain sm:h-20 xl:h-24"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-slate-100 sm:h-20 sm:w-20 xl:h-24 xl:w-24" />
              )}
            </div>

            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl xl:text-2xl">
                Focus Dental Specialists
              </div>
              <div className="hidden text-sm text-slate-500 sm:block">
                Dashboard
              </div>
            </div>
          </Link>

          <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 xl:flex">
            <nav className="flex min-w-0 items-center gap-2 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-[0_6px_18px_rgba(15,23,42,0.05)] backdrop-blur">
              {navItems.map((item) => (
                <DesktopNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  description={item.description}
                  active={isActive(item.href)}
                />
              ))}
            </nav>

            <button
              onClick={handleLogout}
              className="shrink-0 rounded-2xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-[0_6px_18px_rgba(15,23,42,0.25)] transition hover:bg-slate-900"
            >
              Log out
            </button>
          </div>

          <button
            type="button"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 xl:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 py-4 xl:hidden">
            <nav className="grid gap-3">
              {navItems.map((item) => (
                <MobileNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  description={item.description}
                  active={isActive(item.href)}
                  onClick={() => setMobileMenuOpen(false)}
                />
              ))}

              <button
                onClick={handleLogout}
                className="mt-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Log out
              </button>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}