import "server-only";
import { derivePraktikaConnection } from "./authentication";
import { getPraktikaSession, type PraktikaSessionMode } from "./hybrid-session-store";

export async function validatePraktikaSession(mode: PraktikaSessionMode = { scope: "practice" }) {
  const result = derivePraktikaConnection(await getPraktikaSession(mode));
  return { ...result, reason: result.connected ? undefined : result.status };
}
