import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

export default async function CommunicationExcellencePage() {
  await requireRole(["super_admin"]);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Communication Excellence"
      description="Patient communication training, competencies, audit history, microlearning, and future voice coaching."
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-8">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
              New module
            </div>

            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
              Train consistent, confident patient communication.
            </h2>

            <p className="mt-3 text-sm leading-6 text-white/75">
              Start with training modules, quizzes and competencies. Voice practice
              and call review foundations are included but can remain disabled until
              you are ready.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardCard
          title="My Hub"
          description="Personal scores, assigned modules and microlearning."
          href="/communication-excellence/my-hub"
        />
        <DashboardCard
          title="Training"
          description="Complete assigned modules and quizzes."
          href="/communication-excellence/training"
        />
        <DashboardCard
          title="Voice Practice"
          description="Future voice coaching session records."
          href="/communication-excellence/voice-practice"
        />
        <DashboardCard
          title="Admin"
          description="Manage modules, assignments and staff completion."
          href="/communication-excellence/admin"
        />
      </section>
    </PageLayout>
  );
}

function DashboardCard({
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
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="text-lg font-semibold tracking-tight text-slate-950">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    </Link>
  );
}