import { requireRole } from "@/lib/auth";
import OutlookSyncClient from "./OutlookSyncClient";

export default async function OutlookSyncPage() {
  await requireRole(["super_admin"]);

  return <OutlookSyncClient />;
}