"use client";

import { useEffect, useMemo, useState } from "react";

type AppointmentType = {
  id: string;
  type_key: string;
  label: string;
  default_template: string;
};

type Rule = {
  id: string;
  appointment_type: string;
  rule_text: string;
};

type Example = {
  id: string;
  appointment_type: string;
  title: string | null;
  example_note: string;
  is_preferred: boolean;
};

type StructuredField = {
  id: string;
  appointment_type: string;
  field_key: string;
  label: string;
  placeholder: string | null;
  input_type: string;
  display_order: number;
  required: boolean;
};

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export default function ProviderScribeTrainingClient({
  providerId,
}: {
  providerId: string;
}) {
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [fields, setFields] = useState<StructuredField[]>([]);

  const [selectedType, setSelectedType] = useState("");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [templateText, setTemplateText] = useState("");

  const [ruleText, setRuleText] = useState("");

  const [exampleTitle, setExampleTitle] = useState("");
  const [exampleNote, setExampleNote] = useState("");
  const [examplePreferred, setExamplePreferred] = useState(false);
  const [editingExampleId, setEditingExampleId] = useState<string | null>(null);

  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldPlaceholder, setFieldPlaceholder] = useState("");
  const [fieldInputType, setFieldInputType] = useState("textarea");
  const [fieldDisplayOrder, setFieldDisplayOrder] = useState("100");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  const [templateSearch, setTemplateSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const selectedAppointmentType = appointmentTypes.find(
    (type) => type.type_key === selectedType,
  );

  const filteredAppointmentTypes = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();

    if (!query) return appointmentTypes;

    return appointmentTypes.filter((type) =>
      [type.label, type.type_key].join(" ").toLowerCase().includes(query),
    );
  }, [appointmentTypes, templateSearch]);

  const selectedRules = useMemo(
    () =>
      rules.filter(
        (rule) =>
          rule.appointment_type === selectedType ||
          rule.appointment_type === "all",
      ),
    [rules, selectedType],
  );

  const selectedExamples = useMemo(
    () => examples.filter((example) => example.appointment_type === selectedType),
    [examples, selectedType],
  );

  const selectedFields = useMemo(
    () =>
      fields
        .filter((field) => field.appointment_type === selectedType)
        .sort((a, b) => a.display_order - b.display_order),
    [fields, selectedType],
  );

  useEffect(() => {
    loadTraining();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTraining() {
    const response = await fetch(
      `/api/clinical-scribe/training?providerId=${providerId}`,
    );

    const data = await readJson(response);

    if (data.success) {
      const loadedTypes: AppointmentType[] = data.appointmentTypes || [];

      setAppointmentTypes(loadedTypes);
      setRules(data.rules || []);
      setExamples(data.examples || []);
      setFields(data.fields || []);

      if (!selectedType && loadedTypes.length > 0) {
        setSelectedType(loadedTypes[0].type_key);
        setTemplateText(loadedTypes[0].default_template || "");
      }

      if (selectedType && loadedTypes.length > 0) {
        const stillExists = loadedTypes.find(
          (type) => type.type_key === selectedType,
        );

        if (stillExists) {
          setTemplateText(stillExists.default_template || "");
        } else {
          setSelectedType(loadedTypes[0].type_key);
          setTemplateText(loadedTypes[0].default_template || "");
        }
      }
    }

    setLoaded(true);
  }

  function handleSelectType(typeKey: string) {
    setSelectedType(typeKey);

    const found = appointmentTypes.find((type) => type.type_key === typeKey);
    setTemplateText(found?.default_template || "");

    clearExampleForm();
    clearFieldForm();
  }

  function clearExampleForm() {
    setEditingExampleId(null);
    setExampleTitle("");
    setExampleNote("");
    setExamplePreferred(false);
  }

  function clearFieldForm() {
    setEditingFieldId(null);
    setFieldLabel("");
    setFieldKey("");
    setFieldPlaceholder("");
    setFieldInputType("textarea");
    setFieldDisplayOrder("100");
    setFieldRequired(false);
  }

  async function addAppointmentType() {
    if (!newTypeLabel.trim()) {
      alert("Enter an appointment type name.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/clinical-scribe/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          action: "add_appointment_type",
          label: newTypeLabel,
        }),
      });

      const data = await readJson(response);

      if (!data.success) {
        alert(data.error || "Failed to add appointment type.");
        return;
      }

      setNewTypeLabel("");
      setSelectedType(data.typeKey);
      setTemplateText("");
      await loadTraining();
    } finally {
      setLoading(false);
    }
  }

  async function saveTemplate() {
    if (!selectedType) {
      alert("Select an appointment type first.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/clinical-scribe/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          action: "save_template",
          appointmentType: selectedType,
          defaultTemplate: templateText,
        }),
      });

      const data = await readJson(response);

      if (!data.success) {
        alert(data.error || "Failed to save template.");
        return;
      }

      await loadTraining();
      alert("Template saved.");
    } finally {
      setLoading(false);
    }
  }

  async function addRule() {
    if (!selectedType || !ruleText.trim()) {
      alert("Select appointment type and enter a rule.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/clinical-scribe/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          action: "add_rule",
          appointmentType: selectedType,
          ruleText,
        }),
      });

      const data = await readJson(response);

      if (!data.success) {
        alert(data.error || "Failed to add rule.");
        return;
      }

      setRuleText("");
      await loadTraining();
    } finally {
      setLoading(false);
    }
  }

  async function saveExample() {
    if (!selectedType || !exampleNote.trim()) {
      alert("Select appointment type and enter an example note.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/clinical-scribe/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          action: editingExampleId ? "update_example" : "add_example",
          id: editingExampleId,
          appointmentType: selectedType,
          title: exampleTitle,
          exampleNote,
          isPreferred: examplePreferred,
        }),
      });

      const data = await readJson(response);

      if (!data.success) {
        alert(data.error || "Failed to save example.");
        return;
      }

      clearExampleForm();
      await loadTraining();
    } finally {
      setLoading(false);
    }
  }

  function editExample(example: Example) {
    setEditingExampleId(example.id);
    setExampleTitle(example.title || "");
    setExampleNote(example.example_note || "");
    setExamplePreferred(Boolean(example.is_preferred));
  }

  async function saveField() {
    if (!selectedType || !fieldLabel.trim()) {
      alert("Select appointment type and enter a field label.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/clinical-scribe/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          action: editingFieldId ? "update_field" : "add_field",
          id: editingFieldId,
          appointmentType: selectedType,
          fieldKey,
          label: fieldLabel,
          placeholder: fieldPlaceholder,
          inputType: fieldInputType,
          displayOrder: Number(fieldDisplayOrder || 0),
          required: fieldRequired,
        }),
      });

      const data = await readJson(response);

      if (!data.success) {
        alert(data.error || "Failed to save structured field.");
        return;
      }

      clearFieldForm();
      await loadTraining();
    } finally {
      setLoading(false);
    }
  }

  function editField(field: StructuredField) {
    setEditingFieldId(field.id);
    setFieldLabel(field.label || "");
    setFieldKey(field.field_key || "");
    setFieldPlaceholder(field.placeholder || "");
    setFieldInputType(field.input_type || "textarea");
    setFieldDisplayOrder(String(field.display_order || 0));
    setFieldRequired(Boolean(field.required));
  }

  async function deleteItem(
    type: "appointment_type" | "rule" | "example" | "field",
    id: string,
  ) {
    const extraWarning =
      type === "appointment_type"
        ? "\n\nThis will also delete the template's rules, examples and structured fields."
        : "";

    const confirmed = confirm(`Delete this item?${extraWarning}`);
    if (!confirmed) return;

    const response = await fetch("/api/clinical-scribe/training/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, type, id }),
    });

    const data = await readJson(response);

    if (!data.success) {
      alert(data.error || "Failed to delete item.");
      return;
    }

    if (type === "appointment_type") {
      setSelectedType("");
      setTemplateText("");
      clearExampleForm();
      clearFieldForm();
    }

    await loadTraining();
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="grid min-h-[calc(100vh-7rem)] gap-5 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="rounded-3xl border bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <div className="mb-4 border-b pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              AI Clinical Scribe
            </p>

            <h1 className="mt-1 text-xl font-bold text-slate-950">
              Scribe Templates
            </h1>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Create provider-specific appointment templates, structured fields,
              rules and examples.
            </p>
          </div>

          <div className="rounded-2xl border bg-slate-50 p-3">
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              New template
            </label>

            <input
              className="mt-2 w-full rounded-xl border bg-white p-3 text-sm"
              placeholder="e.g. Implant consult"
              value={newTypeLabel}
              onChange={(event) => setNewTypeLabel(event.target.value)}
            />

            <button
              type="button"
              onClick={addAppointmentType}
              disabled={loading}
              className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              + Add Template
            </button>
          </div>

          <div className="mt-4">
            <input
              className="w-full rounded-xl border p-2 text-xs"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
            />
          </div>

          <div className="mt-3 space-y-2">
            {filteredAppointmentTypes.map((type) => {
              const selected = type.type_key === selectedType;
              const typeRuleCount = rules.filter(
                (rule) => rule.appointment_type === type.type_key,
              ).length;
              const typeFieldCount = fields.filter(
                (field) => field.appointment_type === type.type_key,
              ).length;
              const typeExampleCount = examples.filter(
                (example) => example.appointment_type === type.type_key,
              ).length;

              return (
                <div
                  key={type.id}
                  className={[
                    "group flex items-start gap-2 rounded-2xl border p-2",
                    selected
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectType(type.type_key)}
                    className="min-w-0 flex-1 rounded-xl p-1 text-left text-sm hover:bg-white/60"
                  >
                    <div className="truncate font-semibold text-slate-950">
                      {type.label}
                    </div>

                    <div className="mt-1 truncate text-xs text-slate-500">
                      {typeFieldCount} fields · {typeRuleCount} rules ·{" "}
                      {typeExampleCount} examples
                    </div>

                    <div className="mt-1 truncate text-[11px] text-slate-400">
                      {type.type_key}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteItem("appointment_type", type.id)}
                    disabled={loading}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                    title="Delete template"
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {loaded && filteredAppointmentTypes.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-xs text-slate-500">
                No templates yet. Add your first template above.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="space-y-6">
          {!selectedType ? (
            <div className="rounded-3xl border border-dashed bg-white p-8 text-sm text-slate-500">
              Select a template from the left, or add a new one.
            </div>
          ) : null}

          {selectedType ? (
            <>
              <section className="rounded-3xl border bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                      Editing Template
                    </p>

                    <h2 className="mt-1 text-2xl font-bold text-slate-950">
                      {selectedAppointmentType?.label || selectedType}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      This template controls clinical note structure, custom
                      data fields, rules and examples.
                    </p>
                  </div>

                  {selectedAppointmentType ? (
                    <button
                      type="button"
                      onClick={() =>
                        deleteItem("appointment_type", selectedAppointmentType.id)
                      }
                      disabled={loading}
                      className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Delete Template
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="rounded-3xl border bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold">Default Template</h2>

                <textarea
                  className="mt-4 h-72 w-full rounded-2xl border p-4 text-sm"
                  placeholder="Template headings..."
                  value={templateText}
                  onChange={(event) => setTemplateText(event.target.value)}
                />

                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={loading || !selectedType}
                  className="mt-4 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Save Template
                </button>
              </section>

              <section className="rounded-3xl border bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold">Structured Fields</h2>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input
                    className="rounded-xl border p-3"
                    placeholder="Field label, e.g. BOP score"
                    value={fieldLabel}
                    onChange={(e) => setFieldLabel(e.target.value)}
                  />

                  <input
                    className="rounded-xl border p-3"
                    placeholder="Field key, optional"
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                  />

                  <input
                    className="rounded-xl border p-3"
                    placeholder="Placeholder"
                    value={fieldPlaceholder}
                    onChange={(e) => setFieldPlaceholder(e.target.value)}
                  />

                  <input
                    className="rounded-xl border p-3"
                    placeholder="Display order"
                    value={fieldDisplayOrder}
                    onChange={(e) => setFieldDisplayOrder(e.target.value)}
                  />

                  <select
                    className="rounded-xl border p-3"
                    value={fieldInputType}
                    onChange={(e) => setFieldInputType(e.target.value)}
                  >
                    <option value="textarea">Textarea</option>
                    <option value="text">Text</option>
                  </select>

                  <label className="flex items-center gap-2 rounded-xl border p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={fieldRequired}
                      onChange={(e) => setFieldRequired(e.target.checked)}
                    />
                    Required
                  </label>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={saveField}
                    disabled={loading || !selectedType}
                    className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    {editingFieldId ? "Save Field Changes" : "Add Field"}
                  </button>

                  {editingFieldId ? (
                    <button
                      type="button"
                      onClick={clearFieldForm}
                      className="rounded-xl border px-5 py-3 font-semibold"
                    >
                      Cancel Edit
                    </button>
                  ) : null}
                </div>

                <div className="mt-6 space-y-3">
                  {selectedFields.map((field) => (
                    <div key={field.id} className="rounded-xl border p-4">
                      <div className="font-semibold">{field.label}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {field.field_key} · {field.input_type} · order{" "}
                        {field.display_order}
                      </div>
                      <div className="mt-3 flex gap-3">
                        <button
                          onClick={() => editField(field)}
                          className="text-sm font-semibold text-blue-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteItem("field", field.id)}
                          className="text-sm font-semibold text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}

                  {selectedFields.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">
                      No structured fields for this template yet.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold">Rules</h2>

                  <textarea
                    className="mt-4 h-36 w-full rounded-2xl border p-4 text-sm"
                    placeholder="Example: Always include BOP percentage if provided."
                    value={ruleText}
                    onChange={(event) => setRuleText(event.target.value)}
                  />

                  <button
                    type="button"
                    onClick={addRule}
                    disabled={loading || !selectedType}
                    className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Add Rule
                  </button>

                  <div className="mt-6 space-y-3">
                    {selectedRules.map((rule) => (
                      <div key={rule.id} className="rounded-xl border p-4">
                        <div className="text-xs font-bold uppercase text-slate-500">
                          {rule.appointment_type}
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm">
                          {rule.rule_text}
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteItem("rule", rule.id)}
                          className="mt-3 text-sm font-semibold text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold">Example Notes</h2>

                  <input
                    className="mt-4 w-full rounded-xl border p-3"
                    placeholder="Example title"
                    value={exampleTitle}
                    onChange={(event) => setExampleTitle(event.target.value)}
                  />

                  <textarea
                    className="mt-4 h-36 w-full rounded-2xl border p-4 text-sm"
                    placeholder="Paste an approved example clinical note..."
                    value={exampleNote}
                    onChange={(event) => setExampleNote(event.target.value)}
                  />

                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={examplePreferred}
                      onChange={(event) =>
                        setExamplePreferred(event.target.checked)
                      }
                    />
                    Preferred example
                  </label>

                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={saveExample}
                      disabled={loading || !selectedType}
                      className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      {editingExampleId
                        ? "Save Example Changes"
                        : "Add Example"}
                    </button>

                    {editingExampleId ? (
                      <button
                        type="button"
                        onClick={clearExampleForm}
                        className="rounded-xl border px-5 py-3 font-semibold"
                      >
                        Cancel Edit
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-6 space-y-3">
                    {selectedExamples.map((example) => (
                      <div key={example.id} className="rounded-xl border p-4">
                        <div className="font-semibold">
                          {example.title || "Untitled example"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {example.is_preferred ? "Preferred" : "Standard"}
                        </div>
                        <div className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm">
                          {example.example_note}
                        </div>
                        <div className="mt-3 flex gap-3">
                          <button
                            onClick={() => editExample(example)}
                            className="text-sm font-semibold text-blue-600"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteItem("example", example.id)}
                            className="text-sm font-semibold text-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}