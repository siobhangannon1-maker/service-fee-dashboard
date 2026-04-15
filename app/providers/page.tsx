import ProvidersClient from "./ProvidersClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  await requireRole(["admin", "practice_manager"]);
  return <ProvidersClient />;
}