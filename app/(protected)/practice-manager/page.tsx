"use client";

import Link from "next/link";

const cards = [
  {
    title: "New Patient Booking Rate",
    href: "/practice-manager/new-patient-booking-rate",
    description:
      "Track new patient booking performance over time. This module is not built yet and is currently a placeholder.",
  },
  {
    title: "Staff Wages and Overtime Analysis",
    href: "/practice-manager/staff-wages-overtime-analysis",
    description:
      "Review staff wage, superannuation, and overtime trends. This module is not built yet and is currently a placeholder.",
  },
  {
    title: "Benchmark Analysis",
    href: "/practice-manager/benchmark-analysis",
    description:
      "Review benchmark percentages with category trend charts, status colours, and benchmark advice popups.",
  },
  {
    title: "Scorecard",
    href: "/practice-manager/kpis",
    description:
      "Review weekly scorecard KPIs"
  },
];

export default function PracticeManagerDashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <section className="mb-10 overflow-hidden rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
                Practice Manager Portal
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Practice Manager Dashboard
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Access operational and benchmark reporting from one central place,
                including patient booking insights, staff cost analysis, and
                benchmark performance.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                  Admin + Practice Manager
                </div>
              </div>

              <div className="col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-1">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Area
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  Operations
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Practice Manager Modules
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Select a section to review bookings, staffing costs, and benchmark performance.
              </p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-sky-200 hover:shadow-xl"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-600 via-cyan-500 to-teal-400 opacity-90" />

                <div className="mb-5 inline-flex rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-sky-700">
                  Practice Manager
                </div>

                <div className="flex min-h-[160px] flex-col">
                  <div>
                    <h3 className="text-xl font-semibold leading-snug text-slate-900 transition-colors group-hover:text-sky-800">
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