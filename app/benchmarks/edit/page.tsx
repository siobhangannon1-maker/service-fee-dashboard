import EditBenchmarksClient from "./EditBenchmarksClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EditBenchmarksPage() {
  await requireRole(["admin"]);

  return <EditBenchmarksClient />;
}