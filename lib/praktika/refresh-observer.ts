import { createHmac, randomBytes } from 'node:crypto';
import type { BrowserContext, Request, Response, Page, Frame } from 'playwright';

// Diagnostic only: static allowlists prevent identifiers embedded in paths/names leaking.
const paths = new Set(['/php/security/db_refreshToken.php', '/php/json/db_reportingDataWarehouse.php', '/v2/', '/v2/login', '/v2/logout', '/v2/scheduler']);
const names = new Set(['UAT', 'PHPSESSID']);
export function safeObserverPath(value: string, origin: string): string | undefined {
  try { const u = new URL(value, origin); return u.origin === origin ? (paths.has(u.pathname) ? u.pathname : '[other_same_origin]') : undefined; } catch { return undefined; }
}
type End = 'timeout' | 'authenticated' | 'credentials' | 'mfa' | 'ownership_lost' | 'context_replaced' | 'shutdown' | 'context_closed';
type Entry = Record<string, string | number | boolean>;
export type RefreshObserver = { response(source: 'helper_probe' | 'page', method: string, url: string, status: number, headers: Record<string,string>): void; stop(reason: End): void; };
const observers = new WeakMap<BrowserContext, RefreshObserver>();
export function observeProbeResponse(context: BrowserContext, method: string, url: string, status: number, headers: Record<string,string>) {
  try { observers.get(context)?.response('helper_probe', method, url, status, headers); } catch { /* Diagnostic cannot affect authentication. */ }
}
export function stopRefreshObservation(context: BrowserContext | undefined, reason: End) {
  try { if (context) observers.get(context)?.stop(reason); } catch { /* Diagnostic only. */ }
}
export function installRefreshObserver(context: BrowserContext, options: {
  enabled: boolean; origin: string; generation: string; emit(entry: Entry): void;
  windowMs?: number; armedMs?: number;
}): RefreshObserver | undefined {
  if (!options.enabled) return;
  observers.get(context)?.stop('context_replaced');
  const origin = new URL(options.origin).origin;
  const key = randomBytes(32);
  const identity = createHmac('sha256', key).update(options.generation).digest('hex').slice(0,16);
  const start = performance.now();
  let stopped = false, triggered = false, triggerAt = 0, count = 0, sampling = false;
  let prior: Map<string,string> | undefined;
  const ring: Entry[] = [];
  const pages = new Map<Page, (frame: Frame) => void>();
  let timer: ReturnType<typeof setTimeout>;
  const emit = (entry: Entry) => { try { options.emit({ observation: identity, ...entry }); } catch { /* No propagation. */ } };
  const record = (entry: Entry) => {
    if (stopped || count >= 200) return;
    const safe = { tMs: Math.round(performance.now()-start), ...entry };
    if (triggered) { count++; emit(safe); } else { ring.push(safe); if (ring.length > 30) ring.shift(); }
  };
  const cookies = async () => {
    if (stopped || sampling) return;
    sampling = true;
    try {
      const jar = await context.cookies(origin);
      if (stopped) return;
      const next = new Map<string,string>();
      for (const cookie of jar.slice(0,100)) {
        const id = createHmac('sha256',key).update(JSON.stringify([cookie.name,cookie.domain,cookie.path])).digest('hex');
        const hash = createHmac('sha256',key).update(cookie.value).digest('hex');
        next.set(id, hash);
        record({event:'cookie', name:names.has(cookie.name)?cookie.name:'[other_cookie]', secure:cookie.secure, httpOnly:cookie.httpOnly,
          sameSite:['Strict','Lax','None'].includes(cookie.sameSite)?cookie.sameSite:'unknown', baselineKnown:!!prior, changed:!!prior && prior.get(id)!==hash });
      }
      if (prior) record({ event:'cookie_jar', changed: prior.size!==next.size || [...next].some(([id,h])=>prior!.get(id)!==h) });
      prior=next;
    } catch { record({event:'cookie_observation_unavailable'}); } finally { sampling=false; }
  };
  const stop = (reason: End) => {
    if (stopped || (reason === 'authenticated' && !triggered)) return;
    if (triggered) emit({event:'end', reason, observationMs:Math.round(performance.now()-triggerAt), eventLimitReached:count>=200});
    stopped=true; clearTimeout(timer); key.fill(0); prior?.clear(); ring.length=0;
    context.off('request',request); context.off('response',response); context.off('page',page); context.off('close',closed);
    for (const [p,listener] of pages) p.off('framenavigated',listener);
    pages.clear(); observers.delete(context);
  };
  const observer: RefreshObserver = { stop, response(source,method,url,status,headers) {
    if (stopped) return;
    const path=safeObserverPath(url,origin); if (!path) return;
    const location=Object.entries(headers).find(([k])=>k.toLowerCase()==='location')?.[1];
    const setCookie=Object.keys(headers).some(k=>k.toLowerCase()==='set-cookie');
    const destination=location ? safeObserverPath(location,origin) : undefined;
    if (!triggered && status===307 && destination==='/php/security/db_refreshToken.php' && setCookie && origin.startsWith('https:')) {
      triggered=true; triggerAt=performance.now(); clearTimeout(timer);
      emit({event:'start', tMs:Math.round(triggerAt-start)}); ring.forEach(emit); ring.length=0;
      timer=setTimeout(()=>stop('timeout'),Math.min(options.windowMs??15000,15000)); timer.unref?.();
    }
    record({event:'response',source,method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)?method:'other',path,status,setCookiePresent:setCookie,redirectPath:destination??'[unavailable_or_external]'});
    if (triggered && setCookie) {
      const header = Object.entries(headers).find(([k])=>k.toLowerCase()==='set-cookie')?.[1] ?? '';
      // Names/attributes are allowlisted; values and arbitrary Domain/Path are never emitted.
      for (const line of header.split('\n').slice(0,20)) {
        const name = line.slice(0,line.indexOf('=')).trim();
        record({event:'set_cookie', name:names.has(name)?name:'[other_cookie]',
          secure: /;\s*secure(?:;|$)/i.test(line), httpOnly:/;\s*httponly(?:;|$)/i.test(line),
          expiryInstructionPresent:/;\s*(?:expires|max-age)=/i.test(line)});
      }
    }
    if (triggered) void cookies();
  }};
  const request = (r: Request) => { const path=safeObserverPath(r.url(),origin); if(path) record({event:'request',source:'page',path,method:['GET','POST','HEAD','OPTIONS'].includes(r.method())?r.method():'other',category:['document','xhr','fetch'].includes(r.resourceType())?r.resourceType():'other'}); };
  const response = (r: Response) => { try { observer.response('page',r.request().method(),r.url(),r.status(),r.headers()); } catch { /* Diagnostic only. */ } };
  const page = (p: Page) => { if(pages.has(p)) return; const listener=(f: Frame)=>{ if(f!==p.mainFrame())return; const path=safeObserverPath(f.url(),origin); if(path)record({event:'navigation',path,source:'page'}); if(path==='/v2/login'||path==='/v2/logout')stop('credentials'); }; pages.set(p,listener); p.on('framenavigated',listener); };
  const closed=()=>stop('context_closed');
  timer=setTimeout(()=>stop('timeout'),Math.min(options.armedMs??300000,300000)); timer.unref?.();
  observers.set(context,observer); context.on('request',request);context.on('response',response);context.on('page',page);context.on('close',closed);context.pages().forEach(page);
  void cookies();
  return observer;
}
