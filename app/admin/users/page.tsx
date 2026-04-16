import UsersClient from "./UsersClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireRole(["admin"]);
  return <UsersClient />;
}