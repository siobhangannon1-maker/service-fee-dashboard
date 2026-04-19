import FinancialsClient from "./FinancialsClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function FinancialsPage() {
  await requireRole(["admin"]);
  return <FinancialsClient />;
}