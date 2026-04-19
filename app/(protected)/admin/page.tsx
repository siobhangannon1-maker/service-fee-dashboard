import AdminDashboardClient from "./AdminDashboardClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireRole(["admin"]);

  return <AdminDashboardClient />;
}