import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

export default async function CommunicationVoicePracticePage() {
  const { supabase, user } = await requireRole(["super_admin"]);

  const { data: profile } = await supabase
    .from("communication_staff_profiles")
    .select("voice_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  const voiceEnabled = Boolean(profile?.voice_enabled);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Voice Practice"
      description="Foundation for future AI voice coaching and MaxoTel call review."
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Voice coaching foundation
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            This page is intentionally scaffolded now, but the live voice feature
            should stay disabled until consent, privacy, and cost controls are ready.
          </p>
        </div>

        <div className="p-6">
          {voiceEnabled ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
              Voice practice is enabled for your profile. The next build step is
              to connect this page to an AI voice session API.
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Voice practice is currently disabled. This is recommended while the
              training, quiz, competency and audit foundations are being built.
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <InfoCard title="Consent ready" text="Consent logs table has been created." />
            <InfoCard title="Session ready" text="Voice session records can be stored." />
            <InfoCard title="Cost ready" text="Estimated cost fields are included." />
          </div>
        </div>
      </section>
    </PageLayout>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="font-semibold text-slate-950">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
    </div>
  );
}