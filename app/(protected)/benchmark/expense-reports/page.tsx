import ExpenseReportsClient from "./ExpenseReportsClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ExpenseReportsPage() {
  await requireRole(["admin"]);
  return <ExpenseReportsClient />;
}