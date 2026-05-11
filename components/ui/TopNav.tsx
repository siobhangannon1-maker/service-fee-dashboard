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

function isUserRole(value: unknown): value is UserRole {
  return (
    value === "super_admin" ||
    value === "provider_readonly" ||
    value === "billing_staff" ||
    value === "practice_manager" ||
    value === "admin"
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [logo, setLogo] = useState<string | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loadingRole, setLoadingRole] = useState(true);
  const [openDropdown, setOpenDropdown] = useState<DropdownPosition | null>(null);

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
  }, [pathname]);

  useEffect(() => {
    function closeDropdown() {
      setOpenDropdown(null);
    }

    window.addEventListener("resize", closeDropdown);
    window.addEventListener("scroll", closeDropdown, true);

    return () => {
      window.removeEventListener("resize", closeDropdown);
      window.removeEventListener("scroll", closeDropdown, true);
    };
  }, []);

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
        items: group.items.filter(
          (item) => !item.roles || hasRole(item.roles),
        ),
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
        <div className="w-full px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link href="/" className="flex shrink-0 items-center gap-4">
              {logo ? (
                <img
                  src={logo}
                  alt="Practice logo"
                  className="h-14 w-auto object-contain"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-slate-100" />
              )}

              <div>
                <div className="whitespace-nowrap text-[24px] font-bold tracking-[-0.03em] text-slate-950">
                  Focus Dental Specialists
                </div>
                <div className="text-[15px] font-medium text-slate-500">
                  Dashboard
                </div>
              </div>
            </Link>

            <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
                  const active = group.items.some((item) => isActive(item.href));
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

            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-2xl bg-[#0F172A] px-5 py-2.5 text-[15px] font-semibold tracking-tight text-white shadow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {openDropdown && selectedGroup && (
        <div
          className="fixed z-[10000] max-h-[70vh] w-[460px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_20px_60px_rgba(15,23,42,0.14)]"
          style={{
            left: Math.min(
              Math.max(openDropdown.left, 240),
              typeof window !== "undefined" ? window.innerWidth - 240 : openDropdown.left,
            ),
            top: openDropdown.top,
            transform: "translateX(-50%)",
          }}
        >
          <div className="relative grid gap-1">
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
      )}
    </>
  );
}