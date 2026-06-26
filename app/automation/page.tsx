"use client";

import { useEffect, useRef, useState } from "react";

type Worker = {
  id: string;
  name: string;
  type: string;
  status: string;
  is_paused: boolean;
  last_heartbeat_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
};

type AutomationError = {
  id: string;
  worker_id: string;
  message: string;
  created_at: string;
};

type AutomationCommand = {
  id: string;
  worker_id: string;
  command: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

type HelperJob = {
  id: string;
  system: "Praktika" | "MediRef";
  job_type: string;
  status: string;
  error: string | null;
  attempts: number | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function statusClass(status: string) {
  if (status === "online" || status === "done" || status === "completed") {
    return "bg-green-100 text-green-700 border-green-200";
  }

  if (
    status === "paused" ||
    status === "pending" ||
    status === "refreshing" ||
    status === "refresh_requested"
  ) {
    return "bg-yellow-100 text-yellow-700 border-yellow-200";
  }

  if (status === "error" || status === "failed") {
    return "bg-red-100 text-red-700 border-red-200";
  }

  if (status === "running" || status === "processing") {
    return "bg-blue-100 text-blue-700 border-blue-200";
  }

  return "bg-gray-100 text-gray-700 border-gray-200";
}

function shortId(id: string) {
  return id.slice(0, 8);
}

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  const controller = new AbortController();

  const timeout = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readJsonOrFallback<T>(
  result: PromiseSettledResult<Response>,
  fallback: T,
) {
  if (result.status !== "fulfilled") return fallback;
  if (!result.value.ok) return fallback;

  try {
    return await result.value.json();
  } catch {
    return fallback;
  }
}

export default function AutomationPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [errors, setErrors] = useState<AutomationError[]>([]);
  const [commands, setCommands] = useState<AutomationCommand[]>([]);
  const [helperJobs, setHelperJobs] = useState<HelperJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCommand, setBusyCommand] = useState<string | null>(null);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);

  const loadingRef = useRef(false);

  async function loadData() {
    if (loadingRef.current) return;

    loadingRef.current = true;
    setLoadMessage(null);

    try {
      const [workersRes, errorsRes, commandsRes, jobsRes] =
        await Promise.allSettled([
          fetchWithTimeout("/api/automation/workers"),
          fetchWithTimeout("/api/automation/errors"),
          fetchWithTimeout("/api/automation/command-history"),
          fetchWithTimeout("/api/automation/helper-jobs"),
        ]);

      const workersJson = await readJsonOrFallback(workersRes, {
        workers,
      });

      const errorsJson = await readJsonOrFallback(errorsRes, {
        errors,
      });

      const commandsJson = await readJsonOrFallback(commandsRes, {
        commands,
      });

      const jobsJson = await readJsonOrFallback(jobsRes, {
        jobs: helperJobs,
      });

      setWorkers(Array.isArray(workersJson.workers) ? workersJson.workers : []);
      setErrors(Array.isArray(errorsJson.errors) ? errorsJson.errors : []);
      setCommands(
        Array.isArray(commandsJson.commands) ? commandsJson.commands : [],
      );
      setHelperJobs(Array.isArray(jobsJson.jobs) ? jobsJson.jobs : []);

      const timedOutCount = [
        workersRes,
        errorsRes,
        commandsRes,
        jobsRes,
      ].filter((result) => result.status === "rejected").length;

      if (timedOutCount > 0) {
        setLoadMessage(
          `${timedOutCount} automation status request${
            timedOutCount === 1 ? "" : "s"
          } timed out. Showing the last available data.`,
        );
      }
    } catch (error) {
      console.warn("Automation status load failed:", error);
      setLoadMessage(
        "Automation status could not be refreshed. Showing the last available data.",
      );
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  async function sendCommand(workerId: string, command: string) {
    setBusyCommand(`${workerId}-${command}`);

    try {
      const res = await fetch("/api/automation/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId, command }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(json.error || "Command failed");
      }

      await loadData();
    } finally {
      setBusyCommand(null);
    }
  }

  useEffect(() => {
    loadData();

    const interval = window.setInterval(loadData, 15000);

    return () => {
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="p-6">Loading automation status...</div>;
  }

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automation</h1>
        <p className="text-sm text-gray-500">
          Monitor and control Praktika and MediRef cloud workers.
        </p>

        {loadMessage ? (
          <p className="mt-2 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            {loadMessage}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {workers.map((worker) => (
          <div
            key={worker.id}
            className="rounded-lg border bg-white p-4 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{worker.name}</h2>
              <span
                className={`rounded-full border px-3 py-1 text-sm ${statusClass(
                  worker.status,
                )}`}
              >
                {worker.status}
              </span>
            </div>

            <div className="text-sm space-y-1">
              <p>
                <strong>Worker ID:</strong> {worker.id}
              </p>
              <p>
                <strong>Paused:</strong> {worker.is_paused ? "Yes" : "No"}
              </p>
              <p>
                <strong>Last heartbeat:</strong>{" "}
                {formatDate(worker.last_heartbeat_at)}
              </p>
              <p>
                <strong>Last success:</strong>{" "}
                {formatDate(worker.last_success_at)}
              </p>
              <p>
                <strong>Last error:</strong> {formatDate(worker.last_error_at)}
              </p>

              {worker.last_error_message ? (
                <p className="text-red-600">
                  <strong>Error:</strong> {worker.last_error_message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {worker.is_paused ? (
                <button
                  className="rounded bg-green-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-resume_worker`}
                  onClick={() => sendCommand(worker.id, "resume_worker")}
                >
                  Resume
                </button>
              ) : (
                <button
                  className="rounded bg-yellow-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-pause_worker`}
                  onClick={() => sendCommand(worker.id, "pause_worker")}
                >
                  Pause
                </button>
              )}

              <button
                className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
                disabled={busyCommand === `${worker.id}-soft_restart`}
                onClick={() => sendCommand(worker.id, "soft_restart")}
              >
                Restart Worker
              </button>

              <button
                className="rounded bg-gray-800 px-3 py-2 text-white disabled:opacity-50"
                disabled={busyCommand === `${worker.id}-force_login`}
                onClick={() => sendCommand(worker.id, "force_login")}
              >
                Force Login
              </button>

              {worker.type === "praktika" ? (
                <button
                  className="rounded bg-purple-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-run_praktika_sync`}
                  onClick={() => sendCommand(worker.id, "run_praktika_sync")}
                >
                  Run Praktika Sync
                </button>
              ) : null}

              {worker.type === "mediref" ? (
                <button
                  className="rounded bg-purple-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-run_mediref_sync`}
                  onClick={() => sendCommand(worker.id, "run_mediref_sync")}
                >
                  Run MediRef Sync
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Recent Helper Jobs</h2>

        {helperJobs.length === 0 ? (
          <p className="text-sm text-gray-500">No helper jobs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">System</th>
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2 pr-3">Locked By</th>
                  <th className="py-2 pr-3">Updated</th>
                  <th className="py-2 pr-3">Error</th>
                </tr>
              </thead>

              <tbody>
                {helperJobs.map((job) => (
                  <tr key={`${job.system}-${job.id}`} className="border-b">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDate(job.created_at)}
                    </td>
                    <td className="py-2 pr-3">{job.system}</td>
                    <td className="py-2 pr-3">
                      <div>{job.job_type}</div>
                      <div className="text-xs text-gray-400">
                        {shortId(job.id)}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-xs ${statusClass(
                          job.status,
                        )}`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{job.attempts ?? 0}</td>
                    <td className="py-2 pr-3">{job.locked_by || ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDate(job.updated_at)}
                    </td>
                    <td className="py-2 pr-3 text-red-600">
                      {job.error || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Recent Commands</h2>

        {commands.length === 0 ? (
          <p className="text-sm text-gray-500">No commands yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Worker</th>
                  <th className="py-2 pr-3">Command</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Error</th>
                </tr>
              </thead>

              <tbody>
                {commands.map((command) => (
                  <tr key={command.id} className="border-b">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDate(command.created_at)}
                    </td>
                    <td className="py-2 pr-3">{command.worker_id}</td>
                    <td className="py-2 pr-3">{command.command}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-xs ${statusClass(
                          command.status,
                        )}`}
                      >
                        {command.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-red-600">
                      {command.error_message || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Recent Errors</h2>

        {errors.length === 0 ? (
          <p className="text-sm text-gray-500">No errors logged.</p>
        ) : (
          <div className="space-y-3">
            {errors.map((error) => (
              <div key={error.id} className="rounded border p-3 text-sm">
                <p>
                  <strong>Worker:</strong> {error.worker_id}
                </p>
                <p>
                  <strong>Time:</strong> {formatDate(error.created_at)}
                </p>
                <p className="text-red-600">
                  <strong>Error:</strong> {error.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}