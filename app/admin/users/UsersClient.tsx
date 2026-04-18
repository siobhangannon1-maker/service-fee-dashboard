"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Toast from "@/components/ui/Toast";
import { writeAuditLog } from "@/lib/audit";

type Role =
  | "admin"
  | "practice_manager"
  | "billing_staff"
  | "provider_readonly";

type UserRow = {
  user_id: string;
  role: Role;
  email?: string | null;
  full_name?: string | null;
};

type InviteForm = {
  email: string;
  full_name: string;
  role: Role;
};

const emptyInviteForm: InviteForm = {
  email: "",
  full_name: "",
  role: "billing_staff",
};

export default function UsersClient() {
  const supabase = createClient();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyInviteForm);

  async function loadRoles() {
    setLoading(true);

    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .order("role");

    if (error) {
      setTone("error");
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const roleRows = (data || []) as Array<{ user_id: string; role: Role }>;

    try {
      const response = await fetch("/api/admin/list-users", {
        method: "GET",
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load user profiles.");
      }

      const usersById = new Map<
        string,
        { email?: string | null; full_name?: string | null }
      >();

      for (const user of result.users || []) {
        usersById.set(user.user_id, {
          email: user.email ?? null,
          full_name: user.full_name ?? null,
        });
      }

      const mergedRows: UserRow[] = roleRows.map((row) => {
        const matchedUser = usersById.get(row.user_id);

        return {
          user_id: row.user_id,
          role: row.role,
          email: matchedUser?.email ?? null,
          full_name: matchedUser?.full_name ?? null,
        };
      });

      setRows(mergedRows);
    } catch (err) {
      setRows(
        roleRows.map((row) => ({
          ...row,
          email: null,
          full_name: null,
        }))
      );

      setTone("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to load user details."
      );
    } finally {
      setLoading(false);
    }
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

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const email = inviteForm.email.trim().toLowerCase();
    const fullName = inviteForm.full_name.trim();

    if (!email) {
      setTone("error");
      setMessage("Please enter an email address.");
      return;
    }

    setInviting(true);

    try {
      const response = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          full_name: fullName,
          role: inviteForm.role,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to invite user.");
      }

      setTone("success");
      setMessage("User invited successfully.");
      setInviteForm(emptyInviteForm);
      await loadRoles();
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to invite user.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold">User Roles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Invite users and manage application access levels.
        </p>

        {message && (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        )}

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Invite New User</h2>
          <p className="mt-1 text-sm text-slate-600">
            Send an invitation email and assign a role at the same time.
          </p>

          <form
            onSubmit={inviteUser}
            className="mt-4 grid gap-4 md:grid-cols-2"
          >
            <div>
              <label className="mb-1 block text-sm">Full name</label>
              <input
                type="text"
                className="w-full rounded-2xl border px-3 py-2"
                placeholder="e.g. Jane Smith"
                value={inviteForm.full_name}
                onChange={(e) =>
                  setInviteForm((prev) => ({
                    ...prev,
                    full_name: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Email address</label>
              <input
                type="email"
                className="w-full rounded-2xl border px-3 py-2"
                placeholder="e.g. jane@example.com"
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Role</label>
              <select
                className="w-full rounded-2xl border px-3 py-2"
                value={inviteForm.role}
                onChange={(e) =>
                  setInviteForm((prev) => ({
                    ...prev,
                    role: e.target.value as Role,
                  }))
                }
              >
                <option value="admin">admin</option>
                <option value="practice_manager">practice_manager</option>
                <option value="billing_staff">billing_staff</option>
                <option value="provider_readonly">provider_readonly</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={inviting}
                className="rounded-2xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {inviting ? "Sending Invite..." : "Invite User"}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Existing Users</h2>

          {loading ? (
            <div className="mt-4 text-sm text-slate-500">Loading users...</div>
          ) : (
            <div className="mt-4 space-y-3">
              {rows.map((row) => (
                <div
                  key={row.user_id}
                  className="flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">
                      {row.full_name || "No name saved"}
                    </div>
                    <div className="text-sm text-slate-600">
                      {row.email || "No email found"}
                    </div>
                    <div className="mt-1 break-all text-xs text-slate-500">
                      User ID: {row.user_id}
                    </div>
                  </div>

                  <div className="w-full md:w-64">
                    <label className="mb-1 block text-xs text-slate-500">
                      Role
                    </label>
                    <select
                      className="w-full rounded-2xl border px-3 py-2"
                      value={row.role}
                      onChange={(e) =>
                        updateRole(row.user_id, e.target.value as Role)
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="practice_manager">practice_manager</option>
                      <option value="billing_staff">billing_staff</option>
                      <option value="provider_readonly">provider_readonly</option>
                    </select>
                  </div>
                </div>
              ))}

              {rows.length === 0 && (
                <div className="text-sm text-slate-500">
                  No users found yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}