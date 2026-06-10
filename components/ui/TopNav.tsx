"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchStoredLogoDataUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/client";

type UserRole =
  | "super_admin"
  | "provider_readonly"
  | "billing_staff"
  | "practice_manager"
  | "admin"
  | "typist"
  | "staff";

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

type DropdownPosition = {
  label: string;
  left: number;
  top: number;
};

const primaryNavItems: NavItem[] = [
  { href: "/", label: "Home", description: "Home" },
];

const navGroups: NavGroup[] = [
  {
    label: "AI Reception",
    roles: ["super_admin"],
    items: [
      {
        href: "/ai-reception/workbench",
        label: "Workbench",
        description: "Start-to-finish AI reception workflows",
      },
      {
        href: "/ai-reception/inbox",
        label: "Inbox",
        description: "Manage correspondence and referrals",
      },
      {
        href: "/ai-reception/upload",
        label: "Upload",
        description: "Upload referrals, letters, x-rays and documents",
      },
      {
        href: "/ai-reception/approval-queue",
        label: "Approval Queue",
        description: "Review AI-classified referrals and correspondence",
      },
      {
        href: "/ai/brain",
        label: "AI Training & Rules",
        description: "Manage AI brain, examples, feedback and learning rules",
      },
    ],
  },
  {
    label: "Staff",
    roles: ["staff"],
    items: [
      {
        href: "/patient-entries",
        label: "Lab Bills & Patient Entries",
        description: "Enter lab bills, materials, and patient adjustments",
      },
      {
        href: "/communication-excellence/my-hub",
        label: "My Training",
        description: "Complete assigned training and review coaching",
      },
      {
        href: "/communication-excellence/scenarios",
        label: "Practice Scenarios",
        description: "Practise patient conversations",
      },
    ],
  },
  {
    label: "Service Fees",
    roles: ["admin", "super_admin"],
    items: [
      {
        href: "/billing",
        label: "Service Fees",
        description: "Generate and Export Service Fees",
      },
      {
        href: "/imports/upload",
        label: "Import Production Reports",
        description: "Upload and Sync Praktika Production Reports",
      },
    ],
  },
  {
    label: "Billing",
    roles: [
      "staff",
      "billing_staff",
      "practice_manager",
      "admin",
      "super_admin",
    ],
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
    label: "Communication Excellence",
    roles: ["super_admin"],
    items: [
      {
        href: "/communication-excellence",
        label: "Dashboard",
        description: "Communication training overview",
      },
      {
        href: "/communication-excellence/my-hub",
        label: "My Training",
        description: "Training, microlearning, scores and coaching",
      },
      {
        href: "/communication-excellence/scenarios",
        label: "Practice Scenarios",
        description: "Text and voice patient conversation practice",
      },
      {
        href: "/communication-excellence/call-reviews",
        label: "Call Reviews",
        description: "Review and coach real call communication",
      },
      {
        href: "/communication-excellence/admin",
        label: "Training Admin",
        description: "Manage modules, scenarios, rubrics and rules",
      },
      {
        href: "/communication-excellence/admin/intelligence",
        label: "Analytics",
        description: "Communication insights, trends and manager summaries",
      },
      {
        href: "/communication-excellence/admin/integrations/maxotel",
        label: "Integrations",
        description: "Manage MaxoTel call review integration",
      },
    ],
  },
  {
    label: "Practice Manager",
    roles: ["practice_manager", "admin", "super_admin"],
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
        href: "/practice-manager/benchmark-analysis",
        label: "Benchmark Analysis",
        description: "Review benchmark percentages with category trend charts.",
      },
      {
        href: "/practice-manager/tasks",
        label: "Tasks",
        description: "Review automatically generated tasks",
      },
    ],
  },
  {
    label: "Provider",
    roles: ["provider_readonly", "practice_manager", "admin", "super_admin"],
    items: [
      {
        href: "/provider",
        label: "Provider",
        description: "Individual Provider Metrics",
      },
      {
        href: "/report-writing/provider",
        label: "Letters",
        description: "Dictate or generate letters from clinical notes",
      },
      {
        href: "/report-writing/provider/training",
        label: "Typist Training",
        description:
          "Upload template examples and add rules for AI letter generation",
      },
      {
        href: "/clinical-scribe",
        label: "Clinical Scribe",
        description:
          "Listen in and generate intelligent notes from your appointment",
      },
      {
        href: "/clinical-scribe/training",
        label: "Clinical Scribe Training",
        description:
          "Upload clinical notes templates and train your clinical scribe",
      },
    ],
  },
  {
    label: "Operations",
    roles: ["admin", "super_admin"],
    items: [
      {
        href: "/admin/reports",
        label: "Service Fee Reports",
        description: "Centralised reporting of service fees",
      },
      {
        href: "/benchmark/referrals",
        label: "Referrals",
        description: "Analyse metrics of referrals received",
      },
      {
        href: "/benchmark/referrer-performance",
        label: "Top Referrers",
        description: "Analysis of top referrer metrics",
      },
      {
        href: "/benchmark/referral-opportunities",
        label: "Referrer Opportunities",
        description: "Analysis of non referring clinics",
      },
      {
        href: "/admin/provider-dashboard",
        label: "Provider Dashboard",
        description: "Analysis of provider clinical and financial metrics",
      },
      {
        href: "/benchmark/expense-reports",
        label: "Expense Reports",
        description: "Analysis of practice benchmarks",
      },
    ],
  },
  {
    label: "Typist",
    roles: ["practice_manager", "admin", "super_admin", "typist"],
    items: [
      {
        href: "/report-writing/typist",
        label: "Letter Generation",
        description:
          "Generate, approve and edit, upload and email provider's letters and upload to Praktika",
      },
      {
        href: "/report-writing/history",
        label: "Report History",
        description: "Search details of previous letters",
      },
      {
        href: "/report-writing/dashboard",
        label: "Report Dashboard",
        description: "Review status of letters",
      },
      {
        href: "/ai/bulk-document-filing",
        label: "Bulk File",
        description: "Bulk file documents to Praktika",
      },
      {
        href: "/report-writing/admin/provider-examples",
        label: "Provider Letter Examples",
        description: "Upload examples of letters for AI training",
      },
      {
        href: "/report-writing/admin/universal-rules",
        label: "Letter Universal Rules",
        description: "Create and edit universal rules for AI letter writing",
      },
    ],
  },
  {
    label: "Admin",
    roles: ["admin", "super_admin"],
    items: [
      {
        href: "/admin",
        label: "Admin",
        description: "User roles, providers, settings and configuration",
      },
      {
        href: "/admin/provider-imports",
        label: "Imports and Syncs",
        description: "Import and sync Praktika reports",
      },
      {
        href: "/benchmarks/edit",
        label: "Edit Benchmarks",
        description: "Edit benchmarks for KPI categories",
      },
      {
        href: "/clinical-scribe/universal-rules",
        label: "Clinical Scribe Universal Rules",
        description:
          "Enter universal rules for safety and efficiency of clinical scribe note writing",
      },
    ],
  },
];

function isUserRole(value: unknown): value is UserRole {
  return (
    value === "super_admin" ||
    value === "provider_readonly" ||
    value === "billing_staff" ||
    value === "practice_manager" ||
    value === "admin" ||
    value === "typist" ||
    value === "staff"
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [logo, setLogo] = useState<string | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loadingRole, setLoadingRole] = useState(true);
  const [openDropdown, setOpenDropdown] = useState<DropdownPosition | null>(
    null,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isLoginPage = pathname === "/login" || pathname.startsWith("/login/");

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  useEffect(() => {
    async function loadRoles() {
      setLoadingRole(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setRoles([]);
        setLoadingRole(false);
        return;
      }

      const loadedRoles: UserRole[] = [];

      const metadataRole = user.user_metadata?.role || user.app_metadata?.role;
      if (isUserRole(metadataRole)) loadedRoles.push(metadataRole);

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (error) {
        console.error("TopNav role lookup failed:", error);
      } else {
        for (const row of data ?? []) {
          if (isUserRole(row.role)) loadedRoles.push(row.role);
        }
      }

      setRoles(Array.from(new Set(loadedRoles)));
      setLoadingRole(false);
    }

    if (!isLoginPage) loadRoles();
  }, [supabase, isLoginPage]);

  useEffect(() => {
    setOpenDropdown(null);
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function closeMenus() {
      setOpenDropdown(null);
      setMobileMenuOpen(false);
    }

    window.addEventListener("resize", closeMenus);

    return () => {
      window.removeEventListener("resize", closeMenus);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileMenuOpen]);

  function hasRole(allowedRoles: UserRole[]) {
    return roles.some((role) => allowedRoles.includes(role));
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const visibleNavGroups = useMemo(() => {
    if (roles.length === 0) return [];

    return navGroups
      .filter((group) => hasRole(group.roles))
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.roles || hasRole(item.roles)),
      }))
      .filter((group) => group.items.length > 0);
  }, [roles]);

  const selectedGroup = openDropdown
    ? visibleNavGroups.find((group) => group.label === openDropdown.label)
    : null;

  function toggleDropdown(groupLabel: string, button: HTMLButtonElement) {
    if (openDropdown?.label === groupLabel) {
      setOpenDropdown(null);
      return;
    }

    const rect = button.getBoundingClientRect();

    setOpenDropdown({
      label: groupLabel,
      left: rect.left + rect.width / 2,
      top: rect.bottom + 12,
    });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (isLoginPage) return null;

  return (
    <>
      <header className="sticky top-0 z-[9999] border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="w-full px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex min-w-0 shrink items-center gap-3 sm:gap-4"
            >
              {logo ? (
                <img
                  src={logo}
                  alt="Practice logo"
                  className="h-10 w-auto shrink-0 object-contain sm:h-14"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100 sm:h-14 sm:w-14" />
              )}

              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold tracking-[-0.03em] text-slate-950 sm:text-[24px]">
                  Focus Dental Specialists
                </div>
                <div className="text-[12px] font-medium text-slate-500 sm:text-[15px]">
                  Dashboard
                </div>
              </div>
            </Link>

            <nav className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 xl:flex">
              {primaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-2xl px-5 py-2.5 text-[15px] font-medium tracking-tight transition-all duration-200 ${
                    isActive(item.href)
                      ? "bg-[#0F172A] text-white shadow-sm"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {!loadingRole &&
                visibleNavGroups.map((group) => {
                  const active = group.items.some((item) =>
                    isActive(item.href),
                  );
                  const isOpen = openDropdown?.label === group.label;

                  return (
                    <button
                      key={group.label}
                      type="button"
                      onClick={(event) =>
                        toggleDropdown(group.label, event.currentTarget)
                      }
                      className={`shrink-0 rounded-2xl px-5 py-2.5 text-[15px] font-medium tracking-tight transition-all duration-200 ${
                        active || isOpen
                          ? "bg-[#0F172A] text-white shadow-sm"
                          : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                      }`}
                    >
                      {group.label}
                    </button>
                  );
                })}
            </nav>

            <div className="hidden shrink-0 xl:block">
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-2xl bg-[#0F172A] px-5 py-2.5 text-[15px] font-semibold tracking-tight text-white shadow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-slate-800"
              >
                Log out
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setOpenDropdown(null);
                setMobileMenuOpen((prev) => !prev);
              }}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm xl:hidden"
            >
              <span className="sr-only">
                {mobileMenuOpen ? "Close menu" : "Open menu"}
              </span>
              <span className="flex flex-col gap-1.5">
                <span
                  className={`block h-0.5 w-5 rounded-full bg-current transition ${
                    mobileMenuOpen ? "translate-y-2 rotate-45" : ""
                  }`}
                />
                <span
                  className={`block h-0.5 w-5 rounded-full bg-current transition ${
                    mobileMenuOpen ? "opacity-0" : ""
                  }`}
                />
                <span
                  className={`block h-0.5 w-5 rounded-full bg-current transition ${
                    mobileMenuOpen ? "-translate-y-2 -rotate-45" : ""
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[10000] bg-white xl:hidden">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-base font-bold text-slate-950">
                  Focus Dental Specialists
                </div>
                <div className="text-xs font-medium text-slate-500">Menu</div>
              </div>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl leading-none text-slate-900"
                aria-label="Close menu"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <div className="space-y-5 pb-8">
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    Main
                  </div>

                  <div className="grid gap-2">
                    {primaryNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block rounded-2xl px-4 py-3 text-sm font-semibold ${
                          isActive(item.href)
                            ? "bg-[#0F172A] text-white"
                            : "bg-slate-50 text-slate-800"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>

                {!loadingRole &&
                  visibleNavGroups.map((group) => (
                    <section key={group.label}>
                      <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                        {group.label}
                      </div>

                      <div className="grid gap-2">
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`block rounded-2xl px-4 py-3 transition ${
                              isActive(item.href)
                                ? "bg-[#0F172A] text-white shadow-sm"
                                : "bg-slate-50 text-slate-800 active:bg-slate-100"
                            }`}
                          >
                            <div className="text-sm font-semibold tracking-tight">
                              {item.label}
                            </div>
                            <div
                              className={`mt-1 text-xs leading-5 ${
                                isActive(item.href)
                                  ? "text-slate-200"
                                  : "text-slate-500"
                              }`}
                            >
                              {item.description}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </section>
                  ))}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white shadow-sm"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {openDropdown && selectedGroup && (
        <div
          className="fixed z-[10000] hidden max-h-[calc(100vh-140px)] w-[460px] max-w-[calc(100vw-24px)] flex-col rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.14)] xl:flex"
          style={{
            left: Math.min(
              Math.max(openDropdown.left, 240),
              typeof window !== "undefined"
                ? window.innerWidth - 240
                : openDropdown.left,
            ),
            top: openDropdown.top,
            transform: "translateX(-50%)",
          }}
        >
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
              {selectedGroup.label}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            <div className="grid gap-1">
              {selectedGroup.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group block rounded-2xl px-4 py-3.5 transition-all duration-200 ${
                    isActive(item.href)
                      ? "bg-[#0F172A] text-white shadow-sm"
                      : "bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <div className="text-[15px] font-semibold tracking-tight">
                    {item.label}
                  </div>
                  <div
                    className={`mt-1 text-sm leading-5 ${
                      isActive(item.href)
                        ? "text-slate-200"
                        : "text-slate-500 group-hover:text-slate-600"
                    }`}
                  >
                    {item.description}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
