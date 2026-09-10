import "server-only";
import { NextResponse } from "next/server";
import { getAuditActor } from "@/lib/report-writing/audit";
import { getUserStatus } from "@/lib/getUserStatus";

// Shared-practice access follows the tools-status signed-in, active-account policy.
export async function authorizeMedirefSession() {
  const actor = await getAuditActor();
  if (!actor.actorUserId) return { response: NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 }) };
  if (!await getUserStatus(actor.actorUserId, { failClosed: true })) {
    return { response: NextResponse.json({ ok: false, error: "Account is inactive or unavailable." }, { status: 403 }) };
  }
  return { actorUserId: actor.actorUserId };
}
