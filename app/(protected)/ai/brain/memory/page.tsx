import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AIBrainMemoryPage() {
  await requireRole(["super_admin"]);

  const [rulesResult, templatesResult, examplesResult, feedbackResult] =
    await Promise.all([
      supabaseAdmin
        .from("ai_learning_rules")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: true })
        .limit(30),

      supabaseAdmin
        .from("ai_response_templates")
        .select("*")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(30),

      supabaseAdmin
        .from("ai_approved_examples")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(30),

      supabaseAdmin
        .from("ai_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const rules = rulesResult.data || [];
  const templates = templatesResult.data || [];
  const examples = examplesResult.data || [];
  const feedback = feedbackResult.data || [];

  return (
    <main className="space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          AI Memory
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          The live memory objects used by AI draft generation.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <MemoryStat title="Rules" value={rules.length} />
        <MemoryStat title="Templates" value={templates.length} />
        <MemoryStat title="Examples" value={examples.length} />
        <MemoryStat title="Feedback" value={feedback.length} />
      </section>

      <MemorySection title="Active Learning Rules">
        {rules.map((rule) => (
          <MemoryCard key={rule.id}>
            <p className="font-semibold text-slate-900">{rule.title}</p>
            <p className="mt-1 text-xs text-slate-500">
              {rule.category || "all"} · {rule.rule_type || "general"} · priority {rule.priority ?? 100}
            </p>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {rule.rule}
            </div>
          </MemoryCard>
        ))}
      </MemorySection>

      <MemorySection title="Response Templates">
        {templates.map((template) => (
          <MemoryCard key={template.id}>
            <p className="font-semibold text-slate-900">{template.title}</p>
            <p className="mt-1 text-xs text-slate-500">{template.category || "all"}</p>
            <div className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {template.body_template}
            </div>
          </MemoryCard>
        ))}
      </MemorySection>

      <MemorySection title="Approved Examples">
        {examples.map((example) => (
          <MemoryCard key={example.id}>
            <p className="font-semibold text-slate-900">{example.title}</p>
            <p className="mt-1 text-xs text-slate-500">{example.category || "all"}</p>
            <div className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {example.approved_reply_body}
            </div>
          </MemoryCard>
        ))}
      </MemorySection>
    </main>
  );
}

function MemoryStat({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function MemorySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function MemoryCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      {children}
    </div>
  );
}
