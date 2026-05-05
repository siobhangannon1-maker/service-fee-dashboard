"use client";

import { ReactNode, useState } from "react";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
};

export default function CollapsibleSection({
  title,
  description,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left hover:bg-slate-50"
      >
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          )}
        </div>

        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && <div className="border-t border-slate-100 px-6 py-5">{children}</div>}
    </section>
  );
}