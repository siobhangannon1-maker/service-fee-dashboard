// Worker-only bearer material. Never import this module into a client component.
import { constants, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, lstatSync, fstatSync, chmodSync, fsyncSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Cookie } from 'playwright';
export const COOKIE_SNAPSHOT_MAX_AGE_MS = 10 * 60_000;
export type SnapshotBinding = { sessionId: string; appUserId: string | null; scope: 'user' | 'practice'; profile: string; origin: string };
export type SnapshotReason = 'missing' | 'invalid' | 'stale' | 'binding_mismatch' | 'generation_mismatch' | 'io_failure' | 'missing_cookies';
const names = ['PHPSESSID', 'UAT'];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function cookies(value: unknown, origin: string): Cookie[] | null {
 if (!Array.isArray(value) || value.length !== 2) return null;
 const result: Cookie[] = [];
 for (const c of value) {
  if (!record(c) || !names.includes(String(c.name)) || result.some(x=>x.name===c.name) || typeof c.value !== 'string' || !c.value || c.value.length > 16000 ||
   typeof c.domain !== 'string' || c.domain.replace(/^\./,'') !== new URL(origin).hostname || c.path !== '/' || c.secure !== true || typeof c.httpOnly !== 'boolean' ||
   !['Strict','Lax','None'].includes(String(c.sameSite)) || typeof c.expires !== 'number' || !Number.isFinite(c.expires) || (c.expires !== -1 && c.expires <= 0)) return null;
  result.push({name:c.name as string,value:c.value,domain:c.domain,path:c.path,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite as Cookie['sameSite'],expires:c.expires});
 }
 return result;
}
export function createCookieSnapshotStore(storageRoot: string, binding: SnapshotBinding) {
 const dir = path.join(storageRoot, 'praktika-auth-snapshots');
 // One slot per session: binding changes invalidate the previous slot, not another user's slot.
 const file = path.join(dir, createHash('sha256').update(binding.sessionId).digest('hex') + '.json');
 const sameBinding = (v: unknown) => record(v) && Object.entries(binding).every(([k,x])=>v[k]===x);
 function secureDirectory() {
  mkdirSync(dir,{recursive:true,mode:0o700});
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw Error();
  chmodSync(dir,0o700);
 }
 function invalidate() { try { secureDirectory(); unlinkSync(file); } catch { /* Missing or inaccessible snapshots are never trusted. */ } }
 return {
  invalidate,
  capture(verifiedCookies: Cookie[], sourceGeneration: string, now = Date.now()): boolean {
   const selected = cookies(verifiedCookies.filter(c=>names.includes(c.name)), binding.origin);
   if (!selected) { invalidate(); return false; }
   let temp: string | undefined;
   try {
    secureDirectory(); temp=file+'.'+randomUUID()+'.tmp';
    const fd=openSync(temp,'wx',0o600);
    try { writeFileSync(fd,JSON.stringify({version:1,binding,sourceGeneration,capturedAt:now,cookies:selected})); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp,file);return true;
   } catch { return false; }
   finally { if(temp)try{unlinkSync(temp);}catch{} }
  },
  load(sourceGeneration: string, now = Date.now()): { cookies: Cookie[]; reason?: never } | { cookies: null; reason: SnapshotReason } {
   let fd: number | undefined;
   try {
    secureDirectory();
    fd=openSync(file,constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat=fstatSync(fd);if(!stat.isFile() || stat.size>65536 || (stat.mode & 0o077)!==0) return {cookies:null,reason:'invalid'};
    const data: unknown=JSON.parse(readFileSync(fd,'utf8'));
    if(!record(data) || data.version!==1 || typeof data.capturedAt!=='number') return {cookies:null,reason:'invalid'};
    if(!sameBinding(data.binding)) { invalidate();return {cookies:null,reason:'binding_mismatch'}; }
    if(data.sourceGeneration!==sourceGeneration) return {cookies:null,reason:'generation_mismatch'};
    if(!Number.isFinite(data.capturedAt) || data.capturedAt>now || now-data.capturedAt>=COOKIE_SNAPSHOT_MAX_AGE_MS) {invalidate();return {cookies:null,reason:'stale'};}
    const selected=cookies(data.cookies,binding.origin);
    if(!selected || selected.some(c=>c.expires!==-1 && c.expires*1000<=now)) {invalidate();return {cookies:null,reason:'invalid'};}
    return {cookies:selected};
   } catch(e) { return {cookies:null,reason:record(e)&&e.code==='ENOENT'?'missing':'io_failure'}; }
   finally {if(fd!==undefined)closeSync(fd);}
  },
 };
}
