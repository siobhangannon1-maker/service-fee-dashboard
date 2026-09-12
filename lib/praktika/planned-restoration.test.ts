import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { mayRestoreAfterShutdown, claimPlannedRestoration, requestPlannedRestoration } from "./planned-restoration";
import type { SupabaseClient } from "@supabase/supabase-js";
const read = (file: string) => readFileSync(file, "utf8");
const sql = read("supabase/migrations/202609090003_praktika_planned_restoration.sql");
function functions(file: string, names: string[], globals: Record<string, unknown>) {
 const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
 const code = ts.transpileModule(ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text || "")).map(n => n.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return runInNewContext(code + `\n({${names.join(",")}})`, globals);
}
test("only planned operational drained helper with remaining idle lifetime qualifies", () => {
 assert.equal(mayRestoreAfterShutdown(true, true, false, 720000), true);
 for (const values of [[false,true,false,720000],[true,false,false,720000],[true,true,true,720000],[true,true,false,0]] as const) {
   assert.equal(mayRestoreAfterShutdown(values[0], values[1], values[2], values[3]), false);
 }
});
test("migration contract: no backfill, server-only intents, generation/lease/challenge/unresolved-job fencing", () => {
 assert.match(sql, /enable row level security/);
 assert.match(sql, /revoke all on public.praktika_helper_restorations from public, anon, authenticated/);
 assert.doesNotMatch(sql, /insert into public.praktika_helper_restorations[^;]*select/i);
 const request = sql.slice(sql.indexOf("create function public.request_praktika_restoration"), sql.indexOf("create function public.claim_praktika_restoration"));
 assert.match(request, /helper_instance_id is distinct from p_instance_id/);
 assert.match(request, /interval '90 seconds'/);
 assert.match(request, /s.status <> 'connected'/);
 assert.match(request, /status = 'processing'/);
 assert.match(request, /clock_timestamp\(\)/);
 assert.match(request, /least\(t \+ interval '10 minutes', idle_deadline\)/);
 assert.ok(request.indexOf("for update") < request.indexOf("praktika_helper_write"));
 assert.ok(request.indexOf("praktika_helper_write") < request.indexOf("insert into public.praktika_helper_restorations"));
 assert.doesNotMatch(request, /set authenticated_at/);
});
test("migration contract: atomic one-shot consumption, source match, expiry and no owner takeover", () => {
 const claim = sql.slice(sql.indexOf("create function public.claim_praktika_restoration"));
 assert.equal((claim.match(/for update/g) || []).length, 2);
 for (const contract of [/r.source_instance_id is distinct from p_source_instance_id/,/r.consumed_at is not null/,/r.expires_at <= t/,/r.idle_deadline_at <= t/,/s.helper_instance_id is not null/,/status = 'processing'/]) assert.match(claim, contract);
 assert.ok(claim.indexOf("set consumed_at") < claim.indexOf("update public.praktika_sessions"));
 assert.match(claim, /authenticated_at = null/);
 assert.match(sql, /'refresh_requested','waiting_for_credentials','waiting_for_mfa','error','expired'/);
 assert.match(sql, /consumed_instance_id is distinct from new.helper_instance_id/);
});
test("RPC boundary sends source fence and cannot inflate restored idle lifetime", async () => {
 let called = "";
 const db = { rpc(name: string, args: Record<string, unknown>) {
   called = name;
   if (name === "claim_praktika_restoration") {
     assert.equal(args.p_source_instance_id, "source");
     return { abortSignal: async () => ({ data: { instance_id: "new", idle_remaining_ms: 720000 }, error: null }) };
   }
   assert.equal(args.p_instance_id, "source"); assert.equal(args.p_idle_remaining_ms, 720000);
   return { abortSignal: async () => ({ data: true, error: null }) };
 } } as unknown as SupabaseClient;
 const claim = await claimPlannedRestoration(db,"fixture","source");
 assert.equal(claim?.instance_id,"new"); assert.ok(claim!.idle_remaining_ms <= 720000 && claim!.idle_remaining_ms > 710000);
 assert.equal(await requestPlannedRestoration(db,"fixture","source",720000),true);
 assert.equal(called,"request_praktika_restoration");
});
test("watcher prioritises staff/jobs, scans only intents, and restoration consumes once at RPC boundary", async () => {
 const file = "scripts/watch-praktika-refresh.ts";
 const source = read(file);
 assert.ok(source.indexOf("await checkRefreshRequests();") < source.indexOf("await checkPendingJobs();"));
 assert.ok(source.indexOf("await checkPendingJobs();") < source.indexOf("await checkRestorationRequests();"));
 assert.match(source, /from\("praktika_helper_restorations"\)/);
 assert.match(source, /\.is\("consumed_at", null\)\.gt\("expires_at", nowIso\(\)\)/);
 let consumed = false, launches = 0;
 const make = () => functions(file,["helperCapacityAvailable","startHelperForSession"], {
   recovering:new Map(),praktikaNoAuthGateEnabled:()=>false,shuttingDown:false,running:new Set(),children:new Map(),MAX_CONCURRENT_HELPERS:1,
   performance,console:{log(){},warn(){},error(){}},supabase:{},process:{execPath:"node",cwd:()=>".",platform:"linux"},
   claimPlannedRestoration:async()=>{if(consumed)return null;consumed=true;return {instance_id:"owner",idle_remaining_ms:720000};},
   spawn:(_cmd:string,args:string[])=>{launches++;assert.ok(args.some(v=>v.startsWith("--restore-idle-remaining-ms=")));return {on(){}};},
 });
 const a=make(),b=make();
 await Promise.all([a.startHelperForSession({id:"fixture",source_instance_id:"source"},"restoration"),b.startHelperForSession({id:"fixture",source_instance_id:"source"},"restoration")]);
 assert.equal(launches,1);
 assert.equal(await a.startHelperForSession({id:"other"},"restoration"),false);
 // This tests orchestration with an atomic RPC double; SQL concurrency needs an isolated DB run before rollout.
});
test("helper preserves restored idle budget; only useful work resets it; shutdown RPC follows browser close", () => {
 let now=1000;
 const globals={scopedNoAuth:false,usefulWorkDeadline:721000,performance:{now:()=>now},HELPER_IDLE_SHUTDOWN_MS:5400000};
 const api=functions("scripts/refresh-praktika-session.ts",["remainingUsefulWorkMs","noteUsefulWork"],globals);
 assert.equal(api.remainingUsefulWorkMs(),720000);now+=60000;assert.equal(api.remainingUsefulWorkMs(),660000);
 now=721000;assert.equal(api.remainingUsefulWorkMs(),0);
 api.noteUsefulWork();assert.equal(api.remainingUsefulWorkMs(),5400000);
 const source=read("scripts/refresh-praktika-session.ts");
 assert.match(source,/if \(usefulWorkDeadline === null\) noteUsefulWork\(\)/);
 assert.ok(source.indexOf("shutdownCoordinator.close()",source.indexOf("} finally {",source.indexOf("async function refreshOnce"))) < source.lastIndexOf("await requestPlannedRestoration"));
 assert.match(source,/if \(shuttingDown\) unresolvedShutdownWork = true/);
 assert.match(source,/process.exitCode = 75/);
 assert.match(read("scripts/watch-praktika-refresh.ts"),/code === 75/);
});

test("queued work consumes an existing warm intent without resetting the idle budget", async () => {
 let claimed=0,launched=0;
 const lookup = { select(){return this;},eq(){return this;},is(){return this;},gt(){return this;},maybeSingle:async()=>({data:{source_instance_id:"source"},error:null}) };
 const api=functions("scripts/watch-praktika-refresh.ts",["helperCapacityAvailable","startHelperForSession"],{
   recovering:new Map(),praktikaNoAuthGateEnabled:()=>false,shuttingDown:false,running:new Set(),children:new Map(),MAX_CONCURRENT_HELPERS:1,performance,nowIso:()=>new Date().toISOString(),
   console:{log(){},warn(){},error(){}},supabase:{from:()=>lookup},process:{execPath:"node",cwd:()=>".",platform:"linux"},
   claimPlannedRestoration:async()=>{claimed++;return {instance_id:"new",idle_remaining_ms:720000};},
   claimPraktikaHelper:async()=>{assert.fail("normal claim would discard idle budget");},
   spawn:(_cmd:string,args:string[])=>{launched++;const budget=Number(args.find(v=>v.startsWith("--restore-idle-remaining-ms="))?.split("=")[1]);assert.ok(budget<=720000);return {on(){}};},
 });
 assert.equal(await api.startHelperForSession({id:"fixture"},"pending_job"),true);
 assert.equal(claimed,1);assert.equal(launched,1);
});
