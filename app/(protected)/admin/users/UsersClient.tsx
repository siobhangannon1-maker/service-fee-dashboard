"use client";

import { useEffect, useMemo, useState } from "react";
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
  original_full_name?: string | null;
  is_active: boolean;
  savingName?: boolean;
  savingStatus?: boolean;
  resendingInvite?: boolean;
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
  const [searchTerm, setSearchTerm] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyInviteForm);

  async function loadRoles() {
    setLoading(true);

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .order("role");

    if (roleError) {
      setTone("error");
      setMessage(roleError.message);
      setLoading(false);
      return;
    }

    const roleRows = (roleData || []) as Array<{ user_id: string; role: Role }>;

    try {
      const response = await fetch("/api/admin/list-users", {
        method: "GET",
        cache: "no-store",
      });

      const rawText = await response.text();

      let result: {
        users?: Array<{
          user_id: string;
          email?: string | null;
          full_name?: string | null;
          is_active?: boolean;
        }>;
        error?: string;
      } = {};

      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server returned non-JSON response from list-users.");
      }

      if (!response.ok) {
        throw new Error(result.error || "Failed to load user profiles.");
      }

      const usersById = new Map<
        string,
        {
          email?: string | null;
          full_name?: string | null;
          is_active?: boolean;
        }
      >();

      for (const user of result.users || []) {
        usersById.set(user.user_id, {
          email: user.email ?? null,
          full_name: user.full_name ?? null,
          is_active: user.is_active ?? true,
        });
      }

      const mergedRows: UserRow[] = roleRows.map((row) => {
        const matchedUser = usersById.get(row.user_id);

        return {
          user_id: row.user_id,
          role: row.role,
          email: matchedUser?.email ?? null,
          full_name: matchedUser?.full_name ?? null,
          original_full_name: matchedUser?.full_name ?? null,
          is_active: matchedUser?.is_active ?? true,
          savingName: false,
          savingStatus: false,
          resendingInvite: false,
        };
      });

      setRows(mergedRows);
    } catch (err) {
      setRows(
        roleRows.map((row) => ({
          ...row,
          email: null,
          full_name: null,
          original_full_name: null,
          is_active: true,
          savingName: false,
          savingStatus: false,
          resendingInvite: false,
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
    await loadRoles();
  }

  async function updateName(userId: string) {
    const row = rows.find((r) => r.user_id === userId);
    const fullName = row?.full_name?.trim() || "";

    if (!fullName) {
      setTone("error");
      setMessage("Please enter a name before saving.");
      return;
    }

    if (row?.full_name === row?.original_full_name) {
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.user_id === userId ? { ...r, savingName: true } : r
      )
    );

    try {
      const response = await fetch("/api/admin/update-user-name", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          full_name: fullName,
        }),
      });

      const rawText = await response.text();

      let result: { error?: string; success?: boolean } = {};
      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server returned non-JSON response.");
      }

      if (!response.ok) {
        throw new Error(result.error || "Failed to update name.");
      }

      await writeAuditLog({
        action: "name_updated",
        entityType: "profile",
        entityId: userId,
        metadata: { full_name: fullName },
      });

      setRows((prev) =>
        prev.map((r) =>
          r.user_id === userId
            ? {
                ...r,
                original_full_name: fullName,
                savingName: false,
              }
            : r
        )
      );

      setTone("success");
      setMessage("Name updated successfully.");
      await loadRoles();
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.user_id === userId ? { ...r, savingName: false } : r
        )
      );

      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to update name.");
    }
  }

  async function updateUserStatus(userId: string, isActive: boolean) {
    setRows((prev) =>
      prev.map((r) =>
        r.user_id === userId ? { ...r, savingStatus: true } : r
      )
    );

    try {
      const response = await fetch("/api/admin/update-user-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          is_active: isActive,
        }),
      });

      const rawText = await response.text();

      let result: { error?: string; success?: boolean } = {};
      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server returned non-JSON response.");
      }

      if (!response.ok) {
        throw new Error(result.error || "Failed to update user status.");
      }

      await writeAuditLog({
        action: isActive ? "user_reactivated" : "user_deactivated",
        entityType: "user_status",
        entityId: userId,
        metadata: { is_active: isActive },
      });

      setRows((prev) =>
        prev.map((r) =>
          r.user_id === userId
            ? { ...r, is_active: isActive, savingStatus: false }
            : r
        )
      );

      setTone("success");
      setMessage(
        isActive
          ? "User reactivated successfully."
          : "User deactivated successfully."
      );
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.user_id === userId ? { ...r, savingStatus: false } : r
        )
      );

      setTone("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to update user status."
      );
    }
  }

  async function resendInvite(userId: string) {
    const row = rows.find((r) => r.user_id === userId);

    if (!row?.email) {
      setTone("error");
      setMessage("This user does not have an email address.");
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.user_id === userId ? { ...r, resendingInvite: true } : r
      )
    );

    try {
      const response = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: row.email,
          full_name: row.full_name ?? "",
          role: row.role,
        }),
      });

      const rawText = await response.text();

      let result: { error?: string; success?: boolean } = {};
      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server returned non-JSON response.");
      }

      if (!response.ok) {
        throw new Error(result.error || "Failed to resend invite.");
      }

      await writeAuditLog({
        action: "invite_resent",
        entityType: "user_invite",
        entityId: userId,
        metadata: {
          email: row.email,
          role: row.role,
        },
      });

      setTone("success");
      setMessage("Invite email sent again.");
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to resend invite.");
    } finally {
      setRows((prev) =>
        prev.map((r) =>
          r.user_id === userId ? { ...r, resendingInvite: false } : r
        )
      );
    }
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

      const rawText = await response.text();

      let result: { error?: string; success?: boolean } = {};
      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server returned non-JSON response.");
      }

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

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return rows;
    }

    return rows.filter((row) => {
      const name = row.full_name?.toLowerCase() ?? "";
      const email = row.email?.toLowerCase() ?? "";
      const role = row.role.toLowerCase();
      const status = row.is_active ? "active" : "inactive";

      return (
        name.includes(term) ||
        email.includes(term) ||
        role.includes(term) ||
        status.includes(term)
      );
    });
  }, [rows, searchTerm]);

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
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Existing Users</h2>
              <p className="mt-1 text-sm text-slate-600">
                Search by full name, email, role, or status.
              </p>
            </div>

            <div className="w-full md:w-80">
              <label className="mb-1 block text-sm">Search users</label>
              <input
                type="text"
                className="w-full rounded-2xl border px-3 py-2"
                placeholder="Search name, email, role, or status"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-slate-500">Loading users...</div>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredRows.map((row) => (
                <div
                  key={row.user_id}
                  className="flex flex-col gap-4 rounded-2xl border p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-xs text-slate-500">
                        Full name
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-2xl border px-3 py-2"
                        value={row.full_name ?? ""}
                        placeholder="Enter full name"
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.user_id === row.user_id
                                ? { ...r, full_name: e.target.value }
                                : r
                            )
                          )
                        }
                        onBlur={() => updateName(row.user_id)}
                      />

                      <div className="mt-3 text-sm text-slate-600">
                        {row.email || "No email found"}
                      </div>
                      <div className="mt-1 break-all text-xs text-slate-500">
                        User ID: {row.user_id}
                      </div>
                    </div>

                    <div>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          row.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {row.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-4">
                    <div>
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
                        <option value="practice_manager">
                          practice_manager
                        </option>
                        <option value="billing_staff">billing_staff</option>
                        <option value="provider_readonly">
                          provider_readonly
                        </option>
                      </select>
                    </div>

                    <div className="flex items-end text-sm text-slate-500">
                      {row.savingName ? "Saving name..." : ""}
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        disabled={row.savingStatus}
                        onClick={() =>
                          updateUserStatus(row.user_id, !row.is_active)
                        }
                        className={`w-full rounded-2xl px-4 py-2 text-white disabled:opacity-50 ${
                          row.is_active
                            ? "bg-red-600 hover:bg-red-700"
                            : "bg-slate-600 hover:bg-slate-700"
                        }`}
                      >
                        {row.savingStatus
                          ? "Saving..."
                          : row.is_active
                          ? "Deactivate User"
                          : "Reactivate User"}
                      </button>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        disabled={row.resendingInvite || !row.email}
                        onClick={() => resendInvite(row.user_id)}
                        className="w-full rounded-2xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {row.resendingInvite ? "Sending..." : "Resend Invite"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {filteredRows.length === 0 && (
                <div className="text-sm text-slate-500">
                  No users matched your search.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}