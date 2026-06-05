import Link from "next/link";
import { requireUser } from "@/lib/auth";
import PageLayout from "@/components/ui/PageLayout";

export const dynamic = "force-dynamic";

const primaryActions = [
  {
    title: "Generate Service Fees",
    href: "/billing",
    description: "Run, lock, export, and email service fee statements.",
  },
  {
    title: "Enter Lab, Implants & Corrections",
    href: "/patient-entries",
    description: "Record lab costs, implant materials, and incorrect payments.",
  },
  {
    title: "Enter Merchant Fees",
    href: "/billing-details",
    description: "Enter Afterpay, Humm, and supporting billing detail entries.",
  },
];

const modules = [
  {
    section: "Typist",
    items: [
      {
        title: "Typist Letter Module",
        href: "/report-writing/typist",
        description: "Generate, upload and sent reports.",
      },
      {
        title: "Typist Dashboard",
        href: "/report-writing/dashboard",
        description: "Review status of letters.",
      },
      {
        title: "Letter Training",
        href: "/report-writing/admin/provider-examples",
        description: "Edit provider examples and rules",
      },
    ],
  },
  {
    section: "Billing & Data Entry",
    items: [
      {
        title: "Service Fee Generation",
        href: "/billing",
        description: "Generate statements, exports, locking, and billing workflows.",
      },
      {
        title: "Patient Entries",
        href: "/patient-entries",
        description: "Implants, materials, lab costs, and incorrect payments.",
      },
      {
        title: "Merchant Fees",
        href: "/billing-details",
        description: "Record merchant fees and billing adjustments.",
      },
    ],
  },
  {
    section: "Reporting",
    items: [
      {
        title: "Service Fee Reports",
        href: "/financials",
        description: "Review service fee trends and financial performance.",
      },
      {
        title: "Benchmark Reports",
        href: "/benchmarks/expense-reports",
        description: "Track expenses, benchmarks, and performance trends.",
      },
      {
        title: "KPI Scorecard",
        href: "/practice-manager/kpis",
        description: "Review practice KPIs and operational performance.",
      },
      {
        title: "Wages and Overtime",
        href: "/practice-manager/staff-wages-overtime-analysis",
        description: "Review wage benchmarks and overtime patterns.",
      },
    ],
  },
  {
    section: "Setup & Admin",
    items: [
      {
        title: "Edit Material Costs",
        href: "/material-costs",
        description: "Manage implant and material cost presets.",
      },
      {
        title: "Admin",
        href: "/admin",
        description: "Manage users, permissions, providers, and system settings.",
      },
    ],
  },
];

function formatRole(role: string) {
  if (!role) return "User";

  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Card({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400" />

      <div className="flex h-full min-h-[150px] flex-col">
        <div>
          <h3 className="text-lg font-semibold text-slate-950 transition group-hover:text-blue-700">
            {title}
          </h3>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>

        <div className="mt-auto pt-6 text-sm font-semibold text-blue-700 transition group-hover:translate-x-1">
          Open →
        </div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const displayName =
    profile?.full_name?.split(" ")[0] ||
    user.email?.split("@")[0] ||
    "there";

  const role = formatRole(profile?.role || "User");

  return (
    <PageLayout
      eyebrow="Dashboard"
      title="Focus Dental Specialists"
      description="Manage billing, reporting, provider records, and practice operations from one central workspace."
    >
      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
          <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-8 py-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                    Focus Dental Specialists
                  </div>

                  <div className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
                    Secure Workspace
                  </div>
                </div>

                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                  Welcome back, {displayName}
                </h1>

                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80 md:text-base">
                  Manage billing, track financial performance, and maintain
                  accurate provider-level records from one central workspace.
                </p>

                <div className="mt-5 inline-flex items-center rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/85">
                  <span className="mr-2 text-white/50">Role</span>
                  <span className="font-semibold text-white">{role}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/billing"
                  className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100"
                >
                  Generate Service Fees
                </Link>

                <Link
                  href="/financials"
                  className="rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  View Reports
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Daily Actions
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Start with the workflows your team uses most often.
            </p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {primaryActions.map((item) => (
              <Card key={item.href} {...item} />
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-10">
          {modules.map((group) => (
            <div key={group.section}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    {group.section}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {group.section === "Billing & Data Entry"
                      ? "Core billing workflows and supporting entries."
                      : group.section === "Reporting"
                      ? "Dashboards and reports for monitoring performance."
                      : "Configuration, setup, and administrative tools."}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => (
                  <Card key={item.href} {...item} />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </PageLayout>
  );
}