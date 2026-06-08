import Link from "next/link";
import { requireUser } from "@/lib/auth";
import PageLayout from "@/components/ui/PageLayout";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Focus Dental Specialists",
};

const commonModules = [
  {
    title: "Typist",
    href: "/report-writing/typist",
    description: "Generate, upload, review and send patient reports.",
    badge: "Letters",
    icon: "T",
    features: ["Upload dictation", "Generate letters", "Review and send"],
  },
  {
    title: "Provider Letters",
    href: "/report-writing/provider",
    description: "Transcribe a report or generate one from clinical notes.",
    badge: "Provider",
    icon: "P",
    features: ["Clinical notes", "Transcription", "Draft reports"],
  },
  {
    title: "Patient Entries",
    href: "/patient-entries",
    description: "Enter lab costs, implants, materials and corrections.",
    badge: "Billing data",
    icon: "E",
    features: ["Lab costs", "Implants", "Corrections"],
  },
];

function formatRole(role: string) {
  if (!role) return "User";

  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ModuleCard({
  title,
  description,
  href,
  badge,
  icon,
  features,
}: {
  title: string;
  description: string;
  href: string;
  badge: string;
  icon: string;
  features: string[];
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl active:scale-[0.99]"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-700 via-sky-500 to-cyan-400" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-xl font-bold text-blue-700 ring-1 ring-blue-100">
          {icon}
        </div>

        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {badge}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-2xl font-semibold tracking-tight text-slate-950 transition group-hover:text-blue-700">
          {title}
        </h3>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          {description}
        </p>
      </div>

      <div className="mt-6 grid gap-2">
        {features.map((feature) => (
          <div
            key={feature}
            className="flex items-center gap-2 text-sm text-slate-600"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">
              ✓
            </span>
            <span>{feature}</span>
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
        <span className="text-sm font-semibold text-blue-700">
          Open module
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-700 transition group-hover:translate-x-1 group-hover:bg-blue-700 group-hover:text-white">
          →
        </span>
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
      description="Your secure workspace for commonly used practice workflows."
    >
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <section className="relative overflow-hidden rounded-[32px] bg-slate-950 shadow-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700" />
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />

          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                    Secure Workspace
                  </div>

                  <div className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
                    Focus Dental Specialists
                  </div>
                </div>

                <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                  Welcome back, {displayName}
                </h1>

                <p className="mt-4 max-w-2xl text-sm leading-6 text-white/80 sm:text-base">
                  Quickly access report writing, provider letters and patient
                  entry workflows from one polished mobile-friendly dashboard.
                </p>
              </div>

              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/85 backdrop-blur">
                <span className="mr-2 text-white/50">Role</span>
                <span className="font-semibold text-white">{role}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                Common Modules
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Start with the workflows used most often by your team.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {commonModules.map((item) => (
              <ModuleCard key={item.href} {...item} />
            ))}
          </div>
        </section>
      </div>
    </PageLayout>
  );
}