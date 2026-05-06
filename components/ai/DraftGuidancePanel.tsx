type KnowledgeSource = {
  id?: string;
  document_id?: string;
  title?: string;
  heading?: string | null;
  similarity?: number | null;
};

type DraftGuidance = {
  category?: string;
  used_learning_rules?: string[];
  used_examples?: string[];
  used_knowledge?: string[];
  safety_notes?: string[];
  learning_rules_count?: number;
  approved_examples_count?: number;
  knowledge_chunks_count?: number;
  learning_rule_ids?: string[];
  approved_example_ids?: string[];
  knowledge_sources?: KnowledgeSource[];
};

function formatSimilarity(value: number | null | undefined) {
  if (typeof value !== "number") return null;
  return `${Math.round(value * 100)}% match`;
}

export default function DraftGuidancePanel({
  guidance,
  description = "AI memory, approved examples, clinic knowledge and safety checks used while generating this draft.",
}: {
  guidance: DraftGuidance | null | undefined;
  description?: string;
}) {
  if (!guidance) return null;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Draft Guidance Used
          </h4>

          <p className="text-xs text-slate-600">{description}</p>
        </div>

        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
          {guidance.category || "unknown"}
        </div>
      </div>

      {guidance.used_knowledge?.length ? (
        <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
            Clinic knowledge used
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            {guidance.used_knowledge.map((source, index) => (
              <span
                key={index}
                className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs text-violet-800"
              >
                {source}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {guidance.knowledge_sources?.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Retrieved knowledge sources
          </p>

          <div className="mt-2 space-y-2">
            {guidance.knowledge_sources.map((source, index) => (
              <div
                key={`${source.id || source.document_id || index}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
              >
                <p className="text-sm font-medium text-slate-900">
                  {source.title || "Untitled clinic note"}
                </p>

                {source.heading ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Section: {source.heading}
                  </p>
                ) : null}

                {formatSimilarity(source.similarity) ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {formatSimilarity(source.similarity)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {guidance.used_learning_rules?.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Learning rules applied
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            {guidance.used_learning_rules.map((rule, index) => (
              <span
                key={index}
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700"
              >
                {rule}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {guidance.used_examples?.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Approved examples used
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            {guidance.used_examples.map((example, index) => (
              <span
                key={index}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
              >
                {example}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {guidance.safety_notes?.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Safety notes
          </p>

          <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">
            {guidance.safety_notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <span>Learning rules: {guidance.learning_rules_count || 0}</span>
        <span>•</span>
        <span>Approved examples: {guidance.approved_examples_count || 0}</span>
        <span>•</span>
        <span>Clinic knowledge chunks: {guidance.knowledge_chunks_count || 0}</span>
      </div>
    </div>
  );
}