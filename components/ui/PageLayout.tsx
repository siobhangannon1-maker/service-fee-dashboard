import { ReactNode } from "react";

type PageLayoutProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export default function PageLayout({
  title,
  description,
  eyebrow,
  actions,
  children,
}: PageLayoutProps) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 rounded-3xl border border-slate-200 bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              {eyebrow && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {eyebrow}
                </p>
              )}

              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>

              {description && (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {description}
                </p>
              )}
            </div>

            {actions && (
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            )}
          </div>
        </div>

        <div className="space-y-6">{children}</div>
      </div>
    </main>
  );
}