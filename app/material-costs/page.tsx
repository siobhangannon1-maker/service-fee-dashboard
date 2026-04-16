import MaterialCostsClient from "./MaterialCostsClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MaterialCostsPage() {
  await requireRole(["admin", "practice_manager", "billing_staff"]);
  return <MaterialCostsClient />;
}