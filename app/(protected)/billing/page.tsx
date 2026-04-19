import BillingClient from "./BillingClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireRole(["admin"]);
  return <BillingClient />;
}