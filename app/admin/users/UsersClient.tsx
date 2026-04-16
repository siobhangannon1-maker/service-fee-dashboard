"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Toast from "@/components/ui/Toast";
import { writeAuditLog } from "@/lib/audit";

type Role = "admin" | "practice_manager" | "billing_staff" | "provider_readonly";

type UserRow = {
  user_id: string;
  role: Role;
};

export default function UsersClient() {
  const supabase = createClient();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");

  async function loadRoles() {
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .order("role");

    if (error) {
      setTone("error");
      setMessage(error.message);
      return;
    }

    setRows((data || []) as UserRow[]);
  }

  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateRole(userId: string, role: Role) {
    const { error } = await supabase
      .from("user_roles")
      .upsert({ user_id: userId, role });

    if (error) {
      setTone("error");
      setMessage(error.message);
      return;
    }

    await writeAuditLog({
      action: "role_updated",
      entityType: "user_role",
      entityId: userId,
      metadata: { role },
    });

    setTone("success");
    setMessage("Role updated.");
    loadRoles();
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-semibold">User Roles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage application access levels.
        </p>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.user_id}
                className="flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium">{row.user_id}</div>
                  <div className="text-sm text-slate-500">{row.role}</div>
                </div>

                <select
                  className="rounded-2xl border px-3 py-2"
                  value={row.role}
                  onChange={(e) => updateRole(row.user_id, e.target.value as Role)}
                >
                  <option value="admin">admin</option>
                  <option value="practice_manager">practice_manager</option>
                  <option value="billing_staff">billing_staff</option>
                  <option value="provider_readonly">provider_readonly</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}