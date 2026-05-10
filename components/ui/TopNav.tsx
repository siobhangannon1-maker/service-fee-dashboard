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
    label: "AI Reception",
    roles: ["super_admin"],
    items: [
      { href: "/ai-reception/workbench", label: "AI Workbench", description: "Start to finish AI workflows" },
      { href: "/ai-reception/inbox", label: "AI Inbox", description: "Manage correspondence and referrals" },
      { href: "/ai-reception/provider-trello-settings", label: "Provider Trello Settings", description: "Manage provider trello boards and lists" },
      { href: "/ai-reception/approval-queue", label: "Approval Queue", description: "Review AI-classified referrals and correspondence" },
      { href: "/ai-reception/upload", label: "Upload Correspondence", description: "Upload referrals, letters, x-rays and documents" },
      { href: "/ai-reception/response-templates", label: "Response Templates", description: "Manage approved AI email response templates" },
      { href: "/ai/brain", label: "AI Brain", description: "AI Brain" },
      { href: "/ai/feedback", label: "AI Feedback", description: "AI Feedback" },
      { href: "/ai/insights", label: "AI Insights", description: "AI Insights" },
      { href: "/ai/learning-rules", label: "AI Learning Rules", description: "AI Learning Rules" },
      { href: "/ai/examples", label: "AI Examples", description: "Upload existing email correspondence to train the AI brain" },
      { href: "/ai/examples/new", label: "AI New Examples", description: "Upload existing email correspondence to train the AI brain" },
      { href: "/ai-reception/manual-email", label: "Manual Email", description: "Paste emails for AI processing" },
    ],
  },
  {
    label: "Service Fees",
    roles: ["admin", "super_admin"],
    items: [
      { href: "/billing", label: "Service Fees", description: "Generate and Export Service Fees" },
      { href: "/imports/upload", label: "Import Production Reports", description: "Upload and Sync Praktika Production Reports" },
    ],
  },
  {
    label: "Billing",
    roles: ["billing_staff", "practice_manager", "admin", "super_admin", "provider_readonly"],
    items: [
      { href: "/patient-entries", label: "Consumables & Incorrect Payments", description: "Enter Consumables / Incorrect Payments" },
      { href: "/billing-details", label: "Merchant Fees", description: "Enter Merchant Fees" },
      { href: "/material-costs", label: "Edit Materials Costs", description: "Update Implant & Materials Costs" },
    ],
  },
  {
    label: "Practice Manager",
    roles: ["practice_manager", "admin", "super_admin"],
    items: [
      { href: "/practice-manager/kpis", label: "KPIs Scorecard", description: "Benchmarks, staffing and new patient metrics" },
      { href: "/practice-manager/staff-wages-overtime-analysis", label: "Staff Wages", description: "Analysis of staff wages and overtime" },
      { href: "/practice-manager/benchmark-analysis", label: "Benchmark Analysis", description: "Review benchmark percentages with category trend charts." },
      { href: "/practice-manager/tasks", label: "Tasks", description: "Review automatically generated tasks" },
    ],
  },
  {
    label: "Provider",
    roles: ["provider_readonly", "practice_manager", "admin", "super_admin"],
    items: [
      { href: "/provider", label: "Provider", description: "Individual Provider Metrics" },
    ],
  },
  {
    label: "Admin",
    roles: ["admin", "super_admin"],
    items: [
      { href: "/admin", label: "Admin", description: "Admin settings and configuration" },
      { href: "/admin/reports", label: "Service Fee Reports", description: "Centralised reporting of service fees" },
      { href: "/benchmark/referrals", label: "Referrals", description: "Analyse metrics of referrals received" },
      { href: "/benchmark/referrer-performance", label: "Top Referrers", description: "Analysis of top referrer metrics" },
      { href: "/benchmark/referral-opportunities", label: "Referrer Opportunities", description: "Analysis of non referring clinics" },
      { href: "/admin/provider-dashboard", label: "Provider Dashboard", description: "Analysis of provider clinical and financial metrics" },
      { href: "/admin/provider-imports", label: "Imports and Syncs", description: "Import and sync Praktika reports" },
      { href: "/benchmark/expense-reports", label: "Expense Reports", description: "Analysis of practice benchmarks" },
      { href: "/benchmarks/edit", label: "Edit Benchmarks", description: "Edit benchmarks for KPI categories" },
    ],
  },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [logo, setLogo] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);

  useEffect(() => {
    fetchStoredLogoDataUrl().then(setLogo);
  }, []);

  useEffect(() => {
    async function loadRole() {
      setLoadingRole(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setRole(null);
        setLoadingRole(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("TopNav role lookup failed:", error);
        setRole(null);
      } else {
        setRole((data?.role as UserRole) ?? null);
      }

      setLoadingRole(false);
    }

    loadRole();
  }, [supabase]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setOpenDropdown(null);
    setOpenMobileGroup(null);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
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

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-[9999] border-b border-slate-200 bg-white shadow-md">
      <div className="w-full px-3 sm:px-5 xl:px-6">
        <div className="flex min-h-[76px] items-center justify-between gap-3 py-3 sm:min-h-[88px]">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3 pr-2 sm:gap-4">
            {logo ? (
              <img src={logo} alt="Practice logo" className="h-12 w-auto object-contain sm:h-16 lg:h-20" />
            ) : (
              <div className="h-12 w-12 rounded-full bg-slate-100 sm:h-16 sm:w-16 lg:h-20 lg:w-20" />
            )}

            <div className="min-w-0">
              <div className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-xl">
                Focus Dental Specialists
              </div>
              <div className="hidden text-sm text-slate-500 sm:block">Dashboard</div>
            </div>
          </Link>

          <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 lg:flex">
            <nav className="flex min-w-0 flex-wrap items-center justify-end gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              {primaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive(item.href)
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {!loadingRole &&
                visibleNavGroups.map((group) => {
                  const active = group.items.some((item) => isActive(item.href));

                  return (
                    <div key={group.label} className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenDropdown((current) =>
                            current === group.label ? null : group.label
                          )
                        }
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                          active
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        {group.label} ▾
                      </button>

                      {openDropdown === group.label && (
                        <div className="absolute right-0 top-full z-[10000] mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={`block rounded-xl px-4 py-3 transition ${
                                isActive(item.href)
                                  ? "bg-slate-900 text-white"
                                  : "text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <div className="text-sm font-semibold">{item.label}</div>
                              <div className={`mt-1 text-xs leading-5 ${isActive(item.href) ? "text-slate-200" : "text-slate-500"}`}>
                                {item.description}
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </nav>

            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-2xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-slate-900"
            >
              Log out
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm lg:hidden"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="max-h-[calc(100vh-88px)] overflow-y-auto border-t border-slate-200 py-4 lg:hidden">
            <nav className="grid gap-3">
              {primaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
                    isActive(item.href)
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {!loadingRole &&
                visibleNavGroups.map((group) => {
                  const groupIsActive = group.items.some((item) => isActive(item.href));
                  const isOpen = openMobileGroup === group.label || groupIsActive;

                  return (
                    <div key={group.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
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
                        <span>{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {isOpen && (
                        <div className="mt-2 grid gap-2">
                          {group.items.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={`rounded-2xl border px-4 py-3 ${
                                isActive(item.href)
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-900"
                              }`}
                            >
                              <div className="text-sm font-semibold">{item.label}</div>
                              <div className={`mt-1 text-xs ${isActive(item.href) ? "text-slate-200" : "text-slate-500"}`}>
                                {item.description}
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

              <button
                type="button"
                onClick={handleLogout}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
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