"use client";

import { useEffect, useMemo, useState } from "react";

type TaskStatus = "open" | "completed" | "archived" | "all";

type PracticeManagerTask = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "completed" | "archived";
  referral_received_date: string | null;
  created_at: string;
  referrers?: {
    clinic_name: string | null;
    address: string | null;
    suburb: string | null;
    post_code: string | null;
    state: string | null;
  } | null;
};

export default function PracticeManagerTasksClient() {
  const [tasks, setTasks] = useState<PracticeManagerTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus>("open");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const openCount = useMemo(() => tasks.filter((task) => task.status === "open").length, [tasks]);

  useEffect(() => {
    loadTasks(statusFilter);
  }, [statusFilter]);

  async function loadTasks(status: TaskStatus) {
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch(`/api/practice-manager/tasks?status=${status}`);
      const json = await res.json();

      if (!res.ok) {
        setMessage(json.error || "Could not load tasks.");
        return;
      }

      setTasks(json.tasks || []);
    } catch (error) {
      console.error(error);
      setMessage("Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }

  async function updateTask(taskId: string, action: "complete" | "archive" | "reopen") {
    const res = await fetch(`/api/practice-manager/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });

    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error || "Could not update task.");
      return;
    }

    setMessage(action === "complete" ? "Task marked complete." : action === "archive" ? "Task archived." : "Task reopened.");
    await loadTasks(statusFilter);
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>Practice Manager Workflow</div>
          <h1 style={heroTitleStyle}>Practice Manager Tasks</h1>
          <p style={heroSubtitleStyle}>Follow up new referrers, send referral packs, and archive completed work.</p>
        </div>

        <div style={heroStatCard}>
          <span style={heroStatLabel}>Open tasks in view</span>
          <strong style={heroStatNumber}>{openCount}</strong>
        </div>
      </section>

      <section style={cardStyle}>
        <div style={toolbarStyle}>
          <div>
            <p style={sectionKickerStyle}>Task inbox</p>
            <h2 style={cardTitleStyle}>Referral follow-up tasks</h2>
          </div>

          <div style={filterGroupStyle}>
            <label>
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus)} style={inputStyle}>
                <option value="open">Open</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
            </label>

            <button onClick={() => loadTasks(statusFilter)} style={secondaryButton}>Refresh</button>
          </div>
        </div>

        {message && <div style={messageBox}>{message}</div>}
        {loading && <p>Loading tasks...</p>}
        {!loading && tasks.length === 0 && <div style={emptyStateBox}>No tasks found for this filter.</div>}

        {!loading && tasks.length > 0 && (
          <div style={taskGridStyle}>
            {tasks.map((task) => (
              <article key={task.id} style={taskCardStyle}>
                <div style={taskCardTopStyle}>
                  <div>
                    <span style={statusBadge(task.status)}>{task.status}</span>
                    <h3 style={taskTitleStyle}>{task.title}</h3>
                  </div>

                  {task.status === "open" && (
                    <button onClick={() => updateTask(task.id, "complete")} style={tickButtonStyle} title="Mark complete">✓</button>
                  )}
                </div>

                <p style={taskDescriptionStyle}>{task.description}</p>

                {task.referrers && (
                  <div style={referrerBoxStyle}>
                    <strong>{task.referrers.clinic_name}</strong>
                    <p style={subtleTextStyle}>
                      {task.referrers.address}<br />
                      {task.referrers.suburb} {task.referrers.post_code}, {task.referrers.state}
                    </p>
                  </div>
                )}

                <div style={actionRowStyle}>
                  {task.status !== "open" && <button onClick={() => updateTask(task.id, "reopen")} style={secondaryButton}>Reopen</button>}
                  {task.status !== "archived" && <button onClick={() => updateTask(task.id, "archive")} style={archiveButtonStyle}>Archive</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function statusBadge(status: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-block", padding: "4px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 };
  if (status === "open") return { ...base, background: "#dbeafe", color: "#1d4ed8" };
  if (status === "completed") return { ...base, background: "#dcfce7", color: "#166534" };
  return { ...base, background: "#f3f4f6", color: "#374151" };
}

const pageStyle: React.CSSProperties = { padding: 24, display: "grid", gap: 24, background: "#f8fafc" };
const heroStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 260px", gap: 24, padding: 28, borderRadius: 24, background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 52%, #2563eb 100%)", color: "white" };
const eyebrowStyle: React.CSSProperties = { display: "inline-block", padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,0.14)", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 };
const heroTitleStyle: React.CSSProperties = { margin: 0, fontSize: 42, lineHeight: 1.05, letterSpacing: "-0.04em" };
const heroSubtitleStyle: React.CSSProperties = { margin: "14px 0 0", color: "rgba(255,255,255,0.84)", fontSize: 16, lineHeight: 1.6 };
const heroStatCard: React.CSSProperties = { padding: 14, borderRadius: 16, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)", alignSelf: "end" };
const heroStatLabel: React.CSSProperties = { display: "block", color: "rgba(255,255,255,0.72)", fontSize: 12, marginBottom: 6 };
const heroStatNumber: React.CSSProperties = { fontSize: 32, lineHeight: 1 };
const cardStyle: React.CSSProperties = { padding: 20, border: "1px solid #e5e7eb", borderRadius: 18, background: "white" };
const toolbarStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, marginBottom: 18 };
const sectionKickerStyle: React.CSSProperties = { margin: "0 0 5px", color: "#2563eb", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" };
const cardTitleStyle: React.CSSProperties = { marginTop: 0, marginBottom: 6, fontSize: 22, letterSpacing: "-0.02em", color: "#111827" };
const subtleTextStyle: React.CSSProperties = { margin: "4px 0", color: "#6b7280", fontSize: 13 };
const filterGroupStyle: React.CSSProperties = { display: "flex", alignItems: "end", gap: 10 };
const inputStyle: React.CSSProperties = { display: "block", width: "100%", minWidth: 170, padding: 9, marginTop: 6, border: "1px solid #d1d5db", borderRadius: 8 };
const secondaryButton: React.CSSProperties = { padding: "9px 12px", background: "#2563eb", color: "white", border: "none", borderRadius: 8, cursor: "pointer" };
const archiveButtonStyle: React.CSSProperties = { padding: "9px 12px", background: "#6b7280", color: "white", border: "none", borderRadius: 8, cursor: "pointer" };
const messageBox: React.CSSProperties = { marginBottom: 14, padding: 12, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10 };
const emptyStateBox: React.CSSProperties = { padding: 20, border: "1px dashed #d1d5db", borderRadius: 12, background: "#f9fafb", color: "#6b7280" };
const taskGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 16 };
const taskCardStyle: React.CSSProperties = { padding: 16, border: "1px solid #e5e7eb", borderRadius: 16, background: "#f9fafb" };
const taskCardTopStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" };
const taskTitleStyle: React.CSSProperties = { margin: 0, fontSize: 20, color: "#111827" };
const tickButtonStyle: React.CSSProperties = { width: 42, height: 42, borderRadius: 999, border: "none", background: "#22c55e", color: "white", fontSize: 22, fontWeight: 900, cursor: "pointer" };
const taskDescriptionStyle: React.CSSProperties = { color: "#374151", lineHeight: 1.5 };
const referrerBoxStyle: React.CSSProperties = { padding: 12, borderRadius: 12, background: "white", border: "1px solid #e5e7eb", marginBottom: 12 };
const actionRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 };
