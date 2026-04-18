import UploadPageClient from "./UploadPageClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  await requireRole(["admin"]);

  return <UploadPageClient />;
}