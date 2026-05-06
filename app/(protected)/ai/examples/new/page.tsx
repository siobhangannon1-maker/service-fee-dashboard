import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function createExample(formData: FormData) {
  "use server";

  await requireRole(["super_admin"]);

  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "").trim();
  const incomingMessage = String(formData.get("incoming_message") || "").trim();
  const approvedReplySubject = String(
    formData.get("approved_reply_subject") || ""
  ).trim();
  const approvedReplyBody = String(
    formData.get("approved_reply_body") || ""
  ).trim();
  const toneNotes = String(formData.get("tone_notes") || "").trim();
  const avoidNotes = String(formData.get("avoid_notes") || "").trim();

  if (!incomingMessage || !approvedReplyBody) {
    throw new Error("Incoming message and approved reply body are required.");
  }

  await supabaseAdmin.from("ai_approved_examples").insert({
    title,
    category,
    incoming_message: incomingMessage,
    approved_reply_subject: approvedReplySubject,
    approved_reply_body: approvedReplyBody,
    tone_notes: toneNotes,
    avoid_notes: avoidNotes,
    source: "manual",
    is_active: true,
  });

  redirect("/ai/examples");
}

export default async function NewAIExamplePage() {
  await requireRole(["super_admin"]);

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Add Approved Example
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste a real incoming message and the ideal receptionist reply.
        </p>
      </div>

      <form action={createExample} className="space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Title
              </span>
              <input
                name="title"
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                placeholder="Example: New implant referral reply"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Category
              </span>
              <select
                name="category"
                defaultValue="new_referral"
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              >
                <option value="new_referral">new_referral</option>
                <option value="existing_patient_correspondence">
                  existing_patient_correspondence
                </option>
                <option value="patient_request">patient_request</option>
                <option value="reschedule_request">reschedule_request</option>
                <option value="billing_question">billing_question</option>
                <option value="post_op">post_op</option>
                <option value="complaint">complaint</option>
                <option value="admin">admin</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">
              Incoming message
            </span>
            <textarea
              name="incoming_message"
              required
              className="mt-1 min-h-52 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              placeholder="Paste the incoming patient/referrer email here. Remove unnecessary identifiers if possible."
            />
          </label>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">
              Approved reply subject
            </span>
            <input
              name="approved_reply_subject"
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              placeholder="Subject line used by reception"
            />
          </label>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">
              Approved reply body
            </span>
            <textarea
              name="approved_reply_body"
              required
              className="mt-1 min-h-52 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              placeholder="Paste the final approved reply here."
            />
          </label>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Tone notes
              </span>
              <textarea
                name="tone_notes"
                className="mt-1 min-h-28 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                placeholder="Example: Warm, concise, professional."
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Avoid notes
              </span>
              <textarea
                name="avoid_notes"
                className="mt-1 min-h-28 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                placeholder="Example: Do not promise appointment availability."
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <a
            href="/ai/examples"
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </a>

          <button
            type="submit"
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Save example
          </button>
        </div>
      </form>
    </main>
  );
}