"use client";

import Link from "next/link";

export default function HomePage() {
  const cards = [
    {
      title: "Monthly Billing",
      description: "Enter monthly production, adjustments, fees, and export provider statements.",
      href: "/billing",
    },
    {
      title: "Patient Financial Entries",
      description: "Add lab / materials, paid to Focus, fees owed, and paid-in-error entries.",
      href: "/patient-entries",
    },
    {
      title: "Billing Detail Entries",
      description: "Add Humm, Afterpay, and incorrect payment line items with patient names and notes.",
      href: "/billing-details",
    },
    {
      title: "Providers",
      description: "Review provider settings, formulas, and tiered service fee rules.",
      href: "/providers",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl border bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Focus Dental Specialists</p>
          <h1 className="mt-2 text-3xl font-semibold">Service Fee Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Manage billing periods, patient entries, provider fee calculations, and statement exports.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-3xl border bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-xl font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{card.description}</p>
              <div className="mt-4 text-sm font-medium text-slate-900">Open →</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
