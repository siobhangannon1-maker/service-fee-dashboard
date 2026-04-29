"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

type UserRole =
  | "provider_readonly"
  | "billing_staff"
  | "practice_manager"
  | "admin";

type NavItem = {
  href: string;
  label: string;
  description: string;
  roles?: UserRole[];
};

type NavGroup = {
  label: string;
  roles: UserRole[];
  items: NavItem[];
};

const primaryNavItems: NavItem[] = [
  { href: "/", label: "Home", description: "Home" },
];

const navGroups: NavGroup[] = [
  {
    label: "Service Fees",
    roles: ["admin"],
    items: [
      {
        href: "/billing",
        label: "Service Fees",
        description: "Generate and Export Service Fees",
      },
      {
        href: "/imports/upload",
        label: "Import Production Reports",
        description: "Upload Praktika Production Reports",
      },
    ],
  },
  {
    label: "Billing",
    roles: ["billing_staff", "practice_manager", "admin", "provider_readonly"],
    items: [
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
        label: "Edit Materials Costs",
        description: "Update Implant & Materials Costs",
      },
    ],
  },
  {
    label: "Practice Manager",
    roles: ["practice_manager", "admin"],
    items: [
      {
        href: "/practice-manager/kpis",
        label: "KPIs Scorecard",
        description: "Benchmarks, staffing and new patient metrics",
      },
      {
        href: "/practice-manager/staff-wages-overtime-analysis",
        label: "Staff Wages",
        description: "Analysis of staff wages and overtime",
      },
      {
    label: "Benchmark Analysis",
    href: "/practice-manager/benchmark-analysis",
    description:
      "Review benchmark percentages with category trend charts, status colours, and benchmark advice popups.",
  },
  {
    label: "Tasks",
    href: "/practice-manager/tasks",
    description:
      "Review automatically generated tasks",
  },
    ],
  },
  {
    label: "Provider",
    roles: ["provider_readonly", "practice_manager", "admin"],
    items: [
      {
        href: "/provider",
        label: "Provider",
        description: "Individual Provider Metrics",
      },
    ],
  },
  {
    label: "Admin",
    roles: ["admin"],
    items: [
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
        href: "/benchmark/referrals",
        label: "Referrals",
        description: "Analyse metrics of referrals received",
      },
      {
        href: "/admin/provider-dashboard",
        label: "Provider Dashboard",
        description: "Analysis of provider clinical and financial metrics",
      },
      {
        href: "/admin/provider-imports",
        label: "Imports",
        description:
          "Import Praktika reports - new patients, appointments, provider performance, FTAs and cancellations",
      },
      {
        href: "/benchmarks/expense-reports",
        label: "Expense Reports",
        description: "Analysis of practice benchmarks",
      },
      {
        href: "/benchmarks/edit",
        label: "Edit Benchmarks",
        description: "Edit benchmarks for KPI categories",
      },
    ],
  },
];

function DesktopNavItem({
  href,
  label,
  description,
  active,
}: NavItem & { active: boolean }) {
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

      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-xs -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
        {description}
      </div>
    </div>
  );
}

function DesktopDropdown({
  group,
  open,
  onToggle,
  onClose,
  isActive,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  isActive: (href: string) => boolean;
}) {
  const groupIsActive = group.items.some((item) => isActive(item.href));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition ${
          groupIsActive
            ? "bg-slate-900 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {group.label}
        <span className="text-xs">▾</span>
      </button>

      {open && (
       <div className="absolute left-1/2 top-full z-50 mt-2 w-80 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`block rounded-xl px-4 py-3 transition ${
                isActive(item.href)
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <div className="text-sm font-semibold">{item.label}</div>
              <div
                className={`mt-1 text-xs leading-5 ${
                  isActive(item.href) ? "text-slate-200" : "text-slate-500"
                }`}
              >
                {item.description}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileNavItem({
  href,
  label,
  description,
  active,
  onClick,
}: NavItem & {
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
  const [role, setRole] = useState<UserRole | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDesktopDropdown, setOpenDesktopDropdown] = useState<string | null>(
    null
  );
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  useEffect(() => {
    async function loadRole() {
      setLoadingRole(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRole(null);
        setLoadingRole(false);
        return;
      }

      const metadataRole =
        user.user_metadata?.role || user.app_metadata?.role || null;

      if (metadataRole) {
        setRole(metadataRole as UserRole);
        setLoadingRole(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      setRole((data?.role as UserRole) || null);
      setLoadingRole(false);
    }

    loadRole();
  }, [supabase]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setOpenDesktopDropdown(null);
    setOpenMobileGroup(null);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const visibleNavGroups = useMemo(() => {
    if (!role) return [];
    return navGroups
      .filter((group) => group.roles.includes(role))
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !item.roles || item.roles.includes(role)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [role]);

  const visibleMobileItems = useMemo(() => {
    return [...primaryNavItems, ...visibleNavGroups.flatMap((g) => g.items)];
  }, [visibleNavGroups]);

  async function handleLogout() {
    await supabase.auth.signOut();
    setMobileMenuOpen(false);
    setOpenDesktopDropdown(null);
    setOpenMobileGroup(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="w-full px-3 sm:px-5 xl:px-6">
        <div className="flex min-h-[76px] items-center justify-between gap-3 py-3 sm:min-h-[88px]">
          <Link href="/" className="flex min-w-0 shrink items-center gap-3 pr-2 sm:gap-4 sm:pr-4">
            <div className="flex shrink-0 items-center justify-center">
              {logo ? (
                <img
                  src={logo}
                  alt="Practice logo"
                  className="h-12 w-auto object-contain sm:h-20 xl:h-24"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-slate-100 sm:h-20 sm:w-20 xl:h-24 xl:w-24" />
              )}
            </div>

            <div className="min-w-0">
              <div className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-xl xl:text-2xl">
                Focus Dental Specialists
              </div>
              <div className="hidden text-sm text-slate-500 sm:block">
                Dashboard
              </div>
            </div>
          </Link>

          <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 xl:flex">
            <nav className="relative flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-[0_6px_18px_rgba(15,23,42,0.05)] backdrop-blur">
              {primaryNavItems.map((item) => (
                <DesktopNavItem
                  key={item.href}
                  {...item}
                  active={isActive(item.href)}
                />
              ))}

              {!loadingRole &&
                visibleNavGroups.map((group) => (
                  <DesktopDropdown
                    key={group.label}
                    group={group}
                    open={openDesktopDropdown === group.label}
                    onToggle={() =>
                      setOpenDesktopDropdown((current) =>
                        current === group.label ? null : group.label
                      )
                    }
                    onClose={() => setOpenDesktopDropdown(null)}
                    isActive={isActive}
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
            className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 xl:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="max-h-[calc(100vh-88px)] overflow-y-auto border-t border-slate-200 py-4 xl:hidden">
            <nav className="grid gap-3">
              {primaryNavItems.map((item) => (
                <MobileNavItem
                  key={item.href}
                  {...item}
                  active={isActive(item.href)}
                  onClick={() => setMobileMenuOpen(false)}
                />
              ))}

              {!loadingRole &&
                visibleNavGroups.map((group) => {
                  const groupIsActive = group.items.some((item) =>
                    isActive(item.href)
                  );
                  const isOpen =
                    openMobileGroup === group.label || groupIsActive;

                  return (
                    <div
                      key={group.label}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-2"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMobileGroup((current) =>
                            current === group.label ? null : group.label
                          )
                        }
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-900"
                      >
                        <span>{group.label}</span>
                        <span className="text-xs">{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {isOpen && (
                        <div className="mt-2 grid gap-2">
                          {group.items.map((item) => (
                            <MobileNavItem
                              key={item.href}
                              {...item}
                              active={isActive(item.href)}
                              onClick={() => setMobileMenuOpen(false)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

              {!loadingRole && visibleMobileItems.length === 1 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  No role-based modules are available for this account.
                </div>
              )}

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