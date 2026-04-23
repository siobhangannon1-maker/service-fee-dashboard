import { ReactNode } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";

const navItems = [
  { label: "Dashboard Home", href: "/practice-manager" },
  { label: "New Patients", href: "/practice-manager/new-patient-booking-rate" },
  {
    label: "Wages & Overtime",
    href: "/practice-manager/staff-wages-overtime-analysis",
  },
  { label: "Benchmark Analysis", href: "/practice-manager/benchmark-analysis" },
];

export default async function PracticeManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireRole(["admin", "practice_manager"]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <header className="mb-8 overflow-hidden rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
                Practice Manager Portal
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Practice Manager Dashboard
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                A central reporting area for bookings, staffing, and benchmark
                performance, designed for practice managers and administrators.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Modules
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">3</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Access
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  Admin + PM
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

          <nav className="mt-6 flex flex-wrap gap-3">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:text-sky-800 hover:shadow"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {children}
      </div>
    </div>
  );
}