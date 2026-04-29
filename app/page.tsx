"use client";

import Link from "next/link";

const cards = [
  {
    title: "Service Fee Generation",
    href: "/billing",
    description:
      "Generate service fee statements, locking, exports, and statement email workflows.",
  },
  {
    title: "Enter Lab, Materials & Incorrect Payments",
    href: "/patient-entries",
    description:
      "Record details of implants, material costs, and incorrect patient payment adjustments.",
  },
  {
    title: "Enter Merchant Fees",
    href: "/billing-details",
    description:
      "Record merchant fees and any other supporting billing detail entries.",
  },
  {
    title: "Edit Implant & Material Costs",
    href: "/material-costs",
    description:
      "Update common implant and material cost presets used across billing.",
  },
  {
    title: "Financial Dashboard",
    href: "/financials",
    description:
      "Review charts, trends, and month-to-month financial performance.",
  },
  {
    title: "Practice Manager",
    href: "/practice-manager",
    description: "Practice Manager tools",
  },
  {
    title: "Admin",
    href: "/admin",
    description:
      "Manage user access, permissions, edit providers and benchmarks.",
  },
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <section className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur sm:mb-8 sm:p-6 lg:mb-10 lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-700 sm:text-sm">
                Billing Portal
              </p>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                Financial Operations Dashboard
              </h1>

              <p className="mt-4 text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
                Welcome to the Focus Dental Specialists Portal.
                Enter implant, lab and materials costs, record incorrect
                payments, and generate service fee statements.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[360px]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Modules
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {cards.length}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Access
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  Secure
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Area
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  Admin & Billing
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 sm:mb-5">
            <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">
              Portal Modules
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Select a section to manage billing, fees, providers, and
              reporting.
            </p>
          </div>

          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-sky-200 hover:shadow-xl sm:p-6"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-600 via-cyan-500 to-teal-400 opacity-90" />

                <div className="mb-4 inline-flex rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-sky-700 sm:mb-5 sm:text-xs">
                  Module
                </div>

                <div className="flex min-h-[140px] flex-col sm:min-h-[160px]">
                  <div>
                    <h3 className="text-lg font-semibold leading-snug text-slate-900 transition-colors group-hover:text-sky-800 sm:text-xl">
                      {card.title}
                    </h3>

                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {card.description}
                    </p>
                  </div>

                  <div className="mt-auto pt-6">
                    <div className="inline-flex items-center gap-2 text-sm font-semibold text-sky-700 transition-all group-hover:gap-3">
                      Open section
                      <span aria-hidden="true">→</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}