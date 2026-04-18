import ImportsUploadClient from "./ImportsUploadClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportsUploadPage() {
  await requireRole(["admin"]); // 👈 restrict here

  return <ImportsUploadClient />;
}