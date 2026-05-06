import { requireRole } from "@/lib/auth";
import ManualEmailClient from "./ManualEmailClient";

export default async function ManualEmailPage() {
  await requireRole(["super_admin"]);

  return <ManualEmailClient />;
}