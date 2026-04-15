import ProvidersClient from "./ProvidersClient";
import { requireRole } from "@/lib/auth";

export default async function ProvidersPage() {
  await requireRole(["admin", "practice_manager"]);
  return <ProvidersClient />;
}