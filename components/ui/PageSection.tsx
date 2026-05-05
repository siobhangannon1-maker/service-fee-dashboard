import { ReactNode } from "react";

type Props = {
  title?: string;
  description?: string;
  children: ReactNode;
};

export default function PageSection({ title, description, children }: Props) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      {(title || description) && (
        <div className="border-b border-slate-100 px-6 py-5">
          {title && (
            <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          )}

          {description && (
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {description}
            </p>
          )}
        </div>
      )}

      <div className="px-6 py-5">{children}</div>
    </section>
  );
}