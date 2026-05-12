"use client";

import { useEffect, useRef, useState } from "react";

type AutomationPreview = {
  ok?: boolean;
  status?: "safe" | "blocked" | "review";
  summary?: string;
  allowedActions?: string[];
  blockedActions?: Array<{
    action: string;
    reason: string;
  }>;
  blockedReasons?: string[];
  warnings?: string[];
  matchedRules?: Array<{
    id: string;
    title: string;
    category?: string | null;
    rule_type?: string | null;
    priority?: number | null;
  }>;
  facts?: Record<string, any>;
};

type ExecuteResult = {
  ok?: boolean;
  status?: string;
  message?: string;
  executedActions?: string[];
  skippedActions?: Array<{ action: string; reason: string }>;
  preview?: AutomationPreview;
  afterFilingPreview?: AutomationPreview;
  item?: any;
  error?: string;
};

function statusClasses(status?: string) {
  if (status === "safe") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (status === "review") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (status === "blocked") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }

  return "border-slate-200 bg-white text-slate-900";
}

function actionLabel(action: string) {
  switch (action) {
    case "file_to_praktika":
      return "File to Praktika";
    case "archive":
      return "Archive";
    case "create_outlook_draft":
      return "Create Outlook draft";
    case "send_outlook":
      return "Send from Outlook";
    case "send_sms":
      return "Send SMS";
    case "create_new_patient":
      return "Create new patient";
    default:
      return action;
  }
}

function actionSentence(actions?: string[]) {
  const safeActions = Array.isArray(actions) ? actions : [];

  if (safeActions.length === 0) return "No actions were executed.";

  return safeActions.map(actionLabel).join(", ");
}

export default function AutomationPreviewCard({
  inboxItemId,
  onItemUpdated,
  onExecuted,
}: {
  inboxItemId: string;
  onItemUpdated?: (item: any) => void;
  onExecuted?: (item: any) => void;
}) {
  const [preview, setPreview] = useState<AutomationPreview | null>(null);
  const [lastResult, setLastResult] = useState<ExecuteResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"preview" | "execute" | "verify" | null>(
    null,
  );
  const [showFacts, setShowFacts] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const executeLockRef = useRef(false);
  const verifyTimersRef = useRef<number[]>([]);

  function clearVerifyTimers() {
    for (const timer of verifyTimersRef.current) {
      window.clearTimeout(timer);
    }

    verifyTimersRef.current = [];
  }

  function applyUpdatedItem(item: any) {
    if (!item) return;
    onItemUpdated?.(item);
    onExecuted?.(item);
  }

  async function loadPreview({ silent = false } = {}) {
    if (!inboxItemId) return null;

    if (!silent) {
      setBusy("preview");
      setMessage("");
    }

    try {
      const response = await fetch("/api/ai/automation-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inboxItemId }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Automation preview failed.");
      }

      setPreview(result.preview || null);
      return result.preview || null;
    } catch (error) {
      if (!silent) {
        setMessage(
          error instanceof Error ? error.message : "Automation preview failed.",
        );
        setPreview(null);
      }

      return null;
    } finally {
      if (!silent) {
        setBusy(null);
      }
    }
  }

  async function verifyAfterExecution(delayMs: number) {
    const timer = window.setTimeout(async () => {
      setBusy((current) => (current === null ? "verify" : current));

      try {
        const refreshedPreview = await loadPreview({ silent: true });

        if (refreshedPreview) {
          setMessage((current) => {
            if (current.includes("Refreshed")) return current;
            return `${current || "Automation executed."} Refreshed status from server.`;
          });
        }
      } finally {
        setBusy((current) => (current === "verify" ? null : current));
      }
    }, delayMs);

    verifyTimersRef.current.push(timer);
  }

  async function executeAutomation() {
    if (executeLockRef.current || busy !== null) return;

    const confirmed = window.confirm(
      "Execute approved automation now? This can file to Praktika and may archive the item if all completion gates are met.",
    );

    if (!confirmed) return;

    executeLockRef.current = true;
    clearVerifyTimers();
    setBusy("execute");
    setMessage("Running approved automation...");
    setLastResult(null);
    setShowResult(false);

    try {
      const response = await fetch("/api/ai/automation-execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inboxItemId }),
      });

      const result: ExecuteResult | null = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Automation execution failed.");
      }

      setLastResult(result);
      setShowResult(true);

      if (result.item) {
        applyUpdatedItem(result.item);
      }

      const nextPreview = result.afterFilingPreview || result.preview || null;

      if (nextPreview) {
        setPreview(nextPreview);
      }

      setMessage(
        result.message ||
          `Automation completed: ${actionSentence(result.executedActions)}.`,
      );

      await verifyAfterExecution(1500);
      await verifyAfterExecution(4500);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Automation execution failed.",
      );
    } finally {
      setBusy(null);
      executeLockRef.current = false;
    }
  }

  useEffect(() => {
    clearVerifyTimers();
    setPreview(null);
    setLastResult(null);
    setMessage("");
    loadPreview();

    return () => clearVerifyTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxItemId]);

  const allowedActions = preview?.allowedActions || [];
  const blockedActions = preview?.blockedActions || [];
  const warnings = preview?.warnings || [];
  const matchedRules = preview?.matchedRules || [];
  const isBusy = busy !== null;
  const canExecute = !isBusy && allowedActions.length > 0;

  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm ${statusClasses(
        preview?.status,
      )}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-bold">Automation preview</div>
          <p className="mt-1 text-sm opacity-80">
            {busy === "preview"
              ? "Checking active learning-rule automation..."
              : busy === "execute"
                ? "Executing approved automation..."
                : busy === "verify"
                  ? "Refreshing automation status..."
                  : preview?.summary || "No preview loaded yet."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadPreview()}
            disabled={isBusy}
            className="rounded-xl border border-current/20 bg-white/70 px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {busy === "preview" ? "Refreshing..." : "Refresh preview"}
          </button>

          <button
            type="button"
            onClick={executeAutomation}
            disabled={!canExecute}
            className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "execute"
              ? "Executing..."
              : allowedActions.length > 0
                ? "Execute approved automation"
                : "No safe actions"}
          </button>
        </div>
      </div>

      {allowedActions.length > 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-white/70 p-3">
          <div className="text-xs font-semibold text-emerald-800">
            Allowed actions
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {allowedActions.map((action) => (
              <span
                key={action}
                className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800"
              >
                {actionLabel(action)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {blockedActions.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-3">
          <div className="text-xs font-semibold text-slate-700">
            Blocked actions
          </div>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {blockedActions.slice(0, 8).map((blocked, index) => (
              <li key={`${blocked.action}-${index}`}>
                <strong>{actionLabel(blocked.action)}:</strong> {blocked.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 p-3">
          <div className="text-xs font-semibold text-amber-800">Warnings</div>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-current/10 bg-white/70 p-3">
        <div className="text-xs font-semibold opacity-80">
          Matched automation learning rules
        </div>

        {matchedRules.length === 0 ? (
          <p className="mt-2 text-xs opacity-70">
            No active rules with rule type <strong>automation</strong> found.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {matchedRules.slice(0, 5).map((rule) => (
              <div key={rule.id} className="text-xs opacity-80">
                <strong>{rule.title}</strong>
                <span className="opacity-70">
                  {" "}
                  · {rule.category || "all"} · priority {rule.priority ?? 100}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {lastResult ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-white/70 p-3">
          <button
            type="button"
            onClick={() => setShowResult((current) => !current)}
            className="text-xs font-semibold text-blue-800 underline"
          >
            {showResult ? "Hide last execution result" : "Show last execution result"}
          </button>

          {showResult ? (
            <div className="mt-2 space-y-2 text-xs text-blue-900">
              <div>
                <strong>Status:</strong> {lastResult.status || "completed"}
              </div>
              <div>
                <strong>Executed:</strong>{" "}
                {actionSentence(lastResult.executedActions)}
              </div>

              {lastResult.skippedActions && lastResult.skippedActions.length > 0 ? (
                <div>
                  <strong>Skipped:</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {lastResult.skippedActions.map((skipped, index) => (
                      <li key={`${skipped.action}-${index}`}>
                        {actionLabel(skipped.action)} — {skipped.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowFacts((current) => !current)}
        className="mt-3 text-xs font-medium underline opacity-75"
      >
        {showFacts ? "Hide facts" : "Show facts"}
      </button>

      {showFacts ? (
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-white/80 p-3 text-xs text-slate-700">
          {JSON.stringify(preview?.facts || {}, null, 2)}
        </pre>
      ) : null}

      {message ? (
        <p className="mt-3 text-sm font-medium opacity-90">{message}</p>
      ) : null}
    </section>
  );
}
