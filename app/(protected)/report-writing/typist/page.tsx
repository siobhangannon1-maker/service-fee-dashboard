import { requireRole } from "@/lib/auth"
import TypistPage from "./TypistPage"

export default async function Page() {
  await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "typist",
  ])

  return <TypistPage />
}