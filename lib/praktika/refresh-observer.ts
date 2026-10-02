import { createHmac, randomBytes } from 'node:crypto';
import type { BrowserContext, Request, Response, Page, Frame, Cookie } from 'playwright';

const paths = new Set(['/php/security/db_refreshToken.php', '/php/json/db_reportingDataWarehouse.php', '/v2/', '/v2/login', '/v2/logout', '/v2/scheduler']);
const names = new Set(['UAT', 'PHPSESSID']);
export function safeObserverPath(value: string, origin: string): string | undefined {
  try { const u = new URL(value, origin); return u.origin === origin ? (paths.has(u.pathname) ? u.pathname : '[other_same_origin]') : undefined; } catch { return undefined; }
}
type End = 'timeout' | 'authenticated' | 'credentials' | 'mfa' | 'ownership_lost' | 'context_replaced' | 'shutdown' | 'context_closed';
type Entry = Record<string, string | number | boolean>;
type Reason = End | 'event_limit' | 'installation_failed';
type KeepaliveResult = { ok: boolean; status: number };
export type RefreshObserver = { response(source: 'helper_probe' | 'page', method: string, url: string, status: number, headers: Record<string, string>): void; stop(reason: End): void; keepalive(result: KeepaliveResult, elapsedMs: number): void };
const observers = new WeakMap<BrowserContext, RefreshObserver>();
export function observeKeepalive(context: BrowserContext, result: KeepaliveResult, elapsedMs: number) {
  try { observers.get(context)?.keepalive(result, elapsedMs); } catch { /* Diagnostic only. */ }
}
export function observeProbeResponse(context: BrowserContext, method: string, url: string, status: number, headers: Record<string, string>) {
  try { observers.get(context)?.response('helper_probe', method, url, status, headers); } catch { /* Diagnostic only. */ }
}
export function stopRefreshObservation(context: BrowserContext | undefined, reason: End) {
  // Existing authenticated signal occurs only after strict GST acceptance and the
  // owned authenticate write. It now arms diagnostics; it never grants authentication.
  try { if (context) observers.get(context)?.stop(reason); } catch { /* Diagnostic only. */ }
}
type CookieState = Map<string, { value: string; attributes: string; required: boolean }>;
export function installRefreshObserver(context: BrowserContext, options: {
  enabled: boolean; origin: string; generation: string; emit(entry: Entry): void;
  windowMs?: number; armedMs?: number;
}): RefreshObserver | undefined {
  if (!options.enabled) return;
  // Repeated installation on the same context must not reset its capture budget.
  const existing = observers.get(context);
  if (existing) return existing;
  const emitFailure = () => { try { options.emit({ event: 'installation_failed', reason: 'observer_setup_unavailable' }); } catch { /* Diagnostic only. */ } };
  let cleanup: (() => void) | undefined;
  try {
    const origin = new URL(options.origin).origin;
    const key = randomBytes(32);
    const hash = (value: string) => createHmac('sha256', key).update(value).digest('hex');
    const identity = randomBytes(8).toString('hex'); // Correlation only; no cookie/generation hash is emitted.
    const installedAt = performance.now();
    const emit = (entry: Entry) => { try { options.emit({ observation: identity, ...entry }); } catch { /* Diagnostic only. */ } };
    let disposed = false, authenticated = false, armedOnce = false, fallbackUsed = false;
    let active = false, triggered = false, capturingAt = 0, recorded = 0, captures = 0;
    let sampleVersion = 0, sampling = false, baseline: CookieState | undefined;
    let keepaliveCount = 0, keepaliveSampling = false;
    let keepaliveTimer: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ring: Entry[] = [];
    const pages = new Map<Page, (frame: Frame) => void>();
    const duration = (value: number | undefined, maximum: number) => Number.isFinite(value) ? Math.max(1, Math.min(value!, maximum)) : maximum;
    const detach = () => {
      clearTimeout(timer);
      context.off('request', request); context.off('response', response); context.off('page', page);
      for (const [p, listener] of pages) p.off('framenavigated', listener);
      pages.clear(); ring.length = 0;
    };
    const terminate = (reason: Reason, final = false) => {
      const wasActive = active, wasTriggered = triggered;
      active = false; triggered = false; sampleVersion++; sampling = false;
      detach();
      if (wasActive || final) emit({ event: 'terminated', reason, triggered: wasTriggered,
        lifetimeMs: Math.max(0, Math.round(performance.now() - installedAt)),
        captureMs: wasTriggered ? Math.max(0, Math.round(performance.now() - capturingAt)) : 0,
        recordedEvents: recorded, captures, fallbackUsed });
      if (final) {
        clearTimeout(keepaliveTimer);
        disposed = true; authenticated = false; baseline?.clear(); baseline = undefined; key.fill(0);
        context.off('close', closed);
        // Keep only the inert object in the WeakMap: reinstall cannot revive a fenced context.
      }
    };
    const record = (entry: Entry) => {
      if (!active || disposed) return;
      const safe = { tMs: Math.max(0, Math.round(performance.now() - installedAt)), ...entry };
      if (!triggered) { ring.push(safe); if (ring.length > 30) ring.shift(); return; }
      if (recorded < 200) { recorded++; emit(safe); }
      if (recorded >= 200) terminate('event_limit');
    };
    const state = (jar: Cookie[]): CookieState => new Map(jar.map(cookie => [
      hash(JSON.stringify([cookie.name, cookie.domain, cookie.path])),
      { value: hash(cookie.value), attributes: hash(JSON.stringify([cookie.secure, cookie.httpOnly, cookie.sameSite, cookie.expires])), required: names.has(cookie.name) },
    ]));
    const sample = async (establishBaseline = false) => {
      if (disposed || sampling || (!active && !establishBaseline)) return;
      sampling = true;
      const version = sampleVersion;
      try {
        const jar = await context.cookies(origin);
        if (disposed || version !== sampleVersion) return;
        // Never describe a truncated jar as unchanged.
        if (jar.length > 100) { record({ event: 'cookie_observation_unavailable', reason: 'cookie_limit' }); return; }
        const next = state(jar);
        const requiredCookieCount = new Set(jar.filter(c => names.has(c.name)).map(c => c.name)).size;
        if (establishBaseline) { baseline = next; record({ event: 'cookie_baseline', available: true, requiredCookieCount, cookieCount: jar.length }); return; }
        const select = (s: CookieState, required: boolean) => [...s].filter(([, v]) => v.required === required);
        const identitiesChanged = (required: boolean) => !!baseline && (
          select(baseline, required).length !== select(next, required).length || select(next, required).some(([id]) => !baseline!.has(id)));
        const valuesChanged = (required: boolean) => !!baseline && select(next, required).some(([id, v]) => baseline!.has(id) && baseline!.get(id)!.value !== v.value);
        record({ event: 'cookie_state', baselineKnown: !!baseline, requiredCookieCount, cookieCount: jar.length,
          requiredIdentityChanged: identitiesChanged(true), requiredValueChanged: valuesChanged(true),
          additionalStateChanged: identitiesChanged(false) || valuesChanged(false),
          attributesChanged: !!baseline && [...next].some(([id, v]) => baseline!.has(id) && baseline!.get(id)!.attributes !== v.attributes) });
      } catch { if (!disposed && version === sampleVersion) record({ event: 'cookie_observation_unavailable', reason: 'cookie_read_unavailable' }); }
      finally { if (version === sampleVersion) sampling = false; }
    };
    const request = (r: Request) => {
      try { const path = safeObserverPath(r.url(), origin); if (path) record({ event: 'request', source: 'page', path,
        method: ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(r.method()) ? r.method() : 'other',
        category: ['document', 'xhr', 'fetch'].includes(r.resourceType()) ? r.resourceType() : 'other' }); } catch { /* Diagnostic only. */ }
    };
    const response = (r: Response) => { try { observer.response('page', r.request().method(), r.url(), r.status(), r.headers()); } catch { /* Diagnostic only. */ } };
    const page = (p: Page) => {
      if (pages.has(p)) return;
      const listener = (f: Frame) => {
        try { if (f !== p.mainFrame()) return; const path = safeObserverPath(f.url(), origin);
          if (path) record({ event: 'navigation', source: 'page', path });
          if (path === '/v2/login' || path === '/v2/logout') observer.stop('credentials');
        } catch { /* Diagnostic only. */ }
      };
      pages.set(p, listener); p.on('framenavigated', listener);
    };
    const closed = () => observer.stop('context_closed');
    const arm = (fallback: boolean) => {
      active = true; triggered = false; recorded = 0;
      try {
        context.on('request', request); context.on('response', response); context.on('page', page); context.pages().forEach(page);
        timer = setTimeout(() => terminate('timeout'), duration(options.armedMs, 300_000)); timer.unref?.();
        emit({ event: 'armed', reason: fallback ? 'probe_refresh_transition' : 'authenticated', fallback });
        return true;
      } catch { emitFailure(); terminate('installation_failed', true); return false; }
    };
    const observer: RefreshObserver = {
      keepalive(result, elapsedMs) {
        if (disposed || keepaliveCount >= 24) return;
        const sequence = ++keepaliveCount;
        const entry: Entry = { event: 'keepalive_summary', sequence,
          tMs: Math.max(0, Math.round(performance.now() - installedAt)),
          elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0,
          outcome: result.ok ? 'success' : result.status >= 100 ? 'http_error' : 'fetch_failure',
          destinationCategory: 'unavailable' };
        if (Number.isInteger(result.status) && result.status >= 100 && result.status <= 599) entry.httpStatus = result.status;
        // redirect:error rejects without exposing Location/status to the fetch caller.
        // Never infer a redirect or a destination from that generic failure.
        if (keepaliveSampling) { emit({ ...entry, cookieObservationAvailable: false }); return; }
        keepaliveSampling = true;
        let finished = false;
        const finish = (fields: Entry) => {
          if (finished) return;
          finished = true; clearTimeout(keepaliveTimer);
          if (!disposed) emit({ ...entry, ...fields });
        };
        // Diagnostic deadline never delays the keepalive caller. A stuck cookie read
        // remains single-flight; future summaries report unavailable without more reads.
        keepaliveTimer = setTimeout(() => finish({ cookieObservationAvailable: false }), 2_000);
        keepaliveTimer.unref?.();
        void (async () => {
          try {
            const jar = await context.cookies(origin);
            if (finished || disposed) return;
            if (jar.length > 100) { finish({ cookieObservationAvailable: false }); return; }
            const fields: Entry = { cookieObservationAvailable: !!baseline,
              requiredCookieCount: new Set(jar.filter(c => names.has(c.name)).map(c => c.name)).size };
            if (baseline) {
              const next = state(jar), before = baseline;
              const ids = new Set([...before.keys(), ...next.keys()]);
              const requiredIds = [...ids].filter(id => before.get(id)?.required || next.get(id)?.required);
              fields.requiredIdentityChanged = requiredIds.some(id => !before.has(id) || !next.has(id));
              fields.requiredValueChanged = requiredIds.some(id => before.has(id) && next.has(id) && before.get(id)!.value !== next.get(id)!.value);
              fields.requiredAttributesChanged = requiredIds.some(id => before.has(id) && next.has(id) && before.get(id)!.attributes !== next.get(id)!.attributes);
              fields.additionalCookieChangeCount = [...ids].filter(id => !(before.get(id)?.required || next.get(id)?.required) &&
                (!before.has(id) || !next.has(id) || before.get(id)!.value !== next.get(id)!.value || before.get(id)!.attributes !== next.get(id)!.attributes)).length;
            }
            finish(fields);
          } catch { finish({ cookieObservationAvailable: false }); }
          finally { keepaliveSampling = false; }
        })();
      },
      stop(reason) {
        if (disposed) return;
        if (reason === 'authenticated') {
          authenticated = true;
          if (triggered) terminate('authenticated');
          // One post-auth arm and one fallback only, never one per successful write.
          if (!armedOnce) { armedOnce = true; if (arm(false)) void sample(true); }
          return;
        }
        if (reason === 'credentials' || reason === 'mfa') {
          if (!authenticated && !active) return;
          authenticated = false; baseline?.clear(); baseline = undefined;
          terminate(reason);
          return;
        }
        terminate(reason, ['ownership_lost', 'context_replaced', 'shutdown', 'context_closed'].includes(reason));
      },
      response(source, method, url, status, headers) {
        if (disposed || !authenticated) return;
        const path = safeObserverPath(url, origin); if (!path) return;
        const location = Object.entries(headers).find(([k]) => k.toLowerCase() === 'location')?.[1];
        const setCookie = Object.keys(headers).some(k => k.toLowerCase() === 'set-cookie');
        const destination = location ? safeObserverPath(location, origin) : undefined;
        const refresh = status === 307 && destination === '/php/security/db_refreshToken.php' && setCookie && origin.startsWith('https:');
        if (!active) {
          if (source !== 'helper_probe' || !refresh || fallbackUsed) return;
          fallbackUsed = true;
          if (!arm(true)) return;
        }
        if (!triggered && refresh) {
          // A baseline still in flight must not become a post-transition baseline.
          if (sampling && !baseline) { sampleVersion++; sampling = false; }
          triggered = true; capturingAt = performance.now(); captures++; clearTimeout(timer);
          emit({ event: 'start', fallback: fallbackUsed, baselineKnown: !!baseline });
          const buffered = ring.splice(0); for (const entry of buffered) record(entry);
          timer = setTimeout(() => terminate('timeout'), duration(options.windowMs, 15_000)); timer.unref?.();
        }
        record({ event: 'response', source, path, status, setCookiePresent: setCookie,
          method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'other',
          redirectPath: destination ?? '[unavailable_or_external]' });
        if (active && triggered && setCookie) {
          const header = Object.entries(headers).find(([k]) => k.toLowerCase() === 'set-cookie')?.[1] ?? '';
          for (const line of header.split('\n').slice(0, 20)) {
            const name = line.slice(0, line.indexOf('=')).trim();
            record({ event: 'set_cookie', name: names.has(name) ? name : '[other_cookie]',
              secure: /;\s*secure(?:;|$)/i.test(line), httpOnly: /;\s*httponly(?:;|$)/i.test(line),
              expiryInstructionPresent: /;\s*(?:expires|max-age)=/i.test(line) });
          }
        }
        if (active && triggered) void sample();
      },
    };
    cleanup = () => terminate('installation_failed', true);
    context.on('close', closed);
    observers.set(context, observer);
    emit({ event: 'installed', state: 'awaiting_authentication' });
    return observer;
  } catch { emitFailure(); try { cleanup?.(); } catch { /* Diagnostic only. */ } return undefined; }
}
