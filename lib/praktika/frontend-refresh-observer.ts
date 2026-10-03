import { createHmac, randomBytes } from 'node:crypto';
import type { BrowserContext, Page, Request, Response } from 'playwright';
import { domainCookieState, domainCookieComparison, praktikaDomainCookies, safeSetCookieMetadata, type DomainCookieState } from './observer-cookie-metadata';

type Entry = Record<string, string | number | boolean>;
type End = 'authenticated' | 'credentials' | 'mfa' | 'ownership_lost' | 'context_replaced' | 'shutdown' | 'context_closed' | 'page_closed';
type Observer = { stop(reason: End): void };
const observers = new WeakMap<BrowserContext, Observer>();
export function stopFrontendRefreshObservation(context: BrowserContext | undefined, reason: End) {
  try { if (context) observers.get(context)?.stop(reason); } catch { /* Diagnostic only. */ }
}
export function frontendPath(value: string, origin: string): string | undefined {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return;
    if (url.pathname === '/php/security/db_refreshToken.php') return 'refresh_token';
    if (url.pathname.startsWith('/php/json/')) return 'php_json';
  } catch { /* Unavailable. */ }
}
// Page events exclude APIRequestContext. Frame association additionally excludes
// service workers and rejects ambiguous/missing attribution rather than guessing.
export function frontendRequest(request: Request, page: Page, origin: string) {
  try {
    const frame = request.frame();
    const resourceType = request.resourceType();
    const path = frontendPath(request.url(), origin);
    if (!path || frame.page() !== page || !['xhr', 'fetch'].includes(resourceType)
      || new URL(page.url()).origin !== origin) return;
    const method = request.method();
    return { path, resourceType, mainFrame: frame === page.mainFrame(),
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'other' };
  } catch { return; }
}
export function installFrontendRefreshObserver(context: BrowserContext, options: {
  enabled: boolean; page: Page; origin: string; emit(entry: Entry): void; captureMs?: number;
}): Observer | undefined {
  if (!options.enabled) return;
  const existing = observers.get(context); if (existing) return existing;
  const origin = new URL(options.origin).origin;
  const pages = [options.page]; // Only already-loaded Pages; no new-page subscription.
  const identity = randomBytes(8).toString('hex'), key = randomBytes(32);
  const digest = (value: string) => createHmac('sha256', key).update(value).digest('hex');
  const started = performance.now();
  let ended = false, triggered = false, sequence = 0, requests = 0, nextId = 0;
  let saw307 = false, sawRefresh = false, subsequentSuccess = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let baseline: DomainCookieState | undefined, pending = false, samples = 0, headerReads = 0;
  const ids = new Map<Request, { id: number; chain: number; method: string; afterTransition: boolean }>();
  const bindings: Array<{ page: Page; request: (r: Request) => void; response: (r: Response) => void }> = [];
  const emit = (entry: Entry) => { try { options.emit({ observation: identity, sequence: ++sequence,
    tMs: Math.max(0, Math.round(performance.now() - started)), source: 'frontend_page', ...entry }); } catch { /* Diagnostic only. */ } };
  const stop = (reason: End | 'capture_timeout' | 'event_limit' | 'installation_failed') => {
    if (reason === 'authenticated' || ended) return;
    ended = true; clearTimeout(timer);
    for (const b of bindings) { b.page.off('request', b.request); b.page.off('response', b.response); b.page.off('close', pageClosed); }
    context.off('close', closed); ids.clear(); baseline = undefined; key.fill(0);
    emit({ event: 'terminated', reason, triggered, qualifyingRequests: requests,
      frontend307: saw307 ? 'observed' : 'not_observed', refreshEndpoint: sawRefresh ? 'observed' : 'not_observed',
      subsequentPhpSuccess: subsequentSuccess ? 'observed' : 'not_observed' });
  };
  const record = (entry: Entry) => {
    if (ended) return;
    if (sequence >= 199) { stop('event_limit'); return; }
    emit(entry);
  };
  // At most four full-jar reads, only after triggering, single flight. No polling.
  // A hung transport read cannot cause a second concurrent read or keep a timer alive.
  const sample = () => {
    if (ended || pending || samples >= 4) return;
    pending = true; samples++;
    try {
      void context.cookies().then(jar => {
        if (ended) return;
        const relevant = praktikaDomainCookies(jar, origin);
        if (jar.length > 1000 || relevant.length > 100) { record({ event: 'cookie_state', available: false }); return; }
        const next = domainCookieState(relevant, origin, digest);
        record({ event: 'cookie_state', available: true, ...domainCookieComparison(next, baseline) });
        baseline = next;
      }, () => { if (!ended) record({ event: 'cookie_state', available: false }); })
        .catch(() => { if (!ended) record({ event: 'cookie_state', available: false }); })
        .finally(() => { pending = false; });
    } catch { pending = false; record({ event: 'cookie_state', available: false }); }
  };
  const trigger = () => {
    if (triggered) return;
    triggered = true;
    const duration = Number.isFinite(options.captureMs) ? Math.max(1, Math.min(options.captureMs!, 30_000)) : 30_000;
    timer = setTimeout(() => stop('capture_timeout'), duration); timer.unref?.();
    sample();
  };
  const identify = (r: Request, requestEvent = false) => {
    let value = ids.get(r);
    if (!value) {
      const parent = r.redirectedFrom(); const previous = parent ? ids.get(parent) : undefined;
      const id = ++nextId; requests++;
      value = { id, chain: previous?.chain ?? id, method: r.method(), afterTransition: requestEvent && (saw307 || sawRefresh) }; ids.set(r, value);
    }
    return value;
  };
  const closed = () => stop('context_closed');
  const pageClosed = () => stop('page_closed');
  const observer = { stop };
  observers.set(context, observer);
  try {
    for (const page of pages) {
      const request = (r: Request) => {
        try {
          if (ended) return;
          const fields = frontendRequest(r, page, origin); if (!fields) return;
          trigger();
          const value = identify(r, true), parent = r.redirectedFrom(), previous = parent ? ids.get(parent) : undefined;
          if (fields.path === 'refresh_token') sawRefresh = true;
          record({ event: 'request', correlation: value.id, chain: value.chain, ...fields,
            redirectedFrom: previous?.id ?? 0, redirectParent: previous ? 'observed' : 'not_observed',
            methodPreserved: !!previous && previous.method === r.method() });
        } catch { /* No raw errors. */ }
      };
      const response = (r: Response) => {
        try {
          if (ended) return;
          const req = r.request(), fields = frontendRequest(req, page, origin); if (!fields) return;
          trigger(); const value = identify(req), status = r.status();
          if (status === 307) saw307 = true;
          if (fields.path === 'refresh_token') sawRefresh = true;
          if (value.afterTransition && fields.path === 'php_json' && status >= 200 && status < 300) subsequentSuccess = true;
          // Synchronous cached response headers: no protocol/network command.
          const location = r.headers().location;
          record({ event: 'response', correlation: value.id, chain: value.chain, path: fields.path,
            method: fields.method, status, locationPresent: location !== undefined,
            redirectDestination: location ? frontendPath(new URL(location, req.url()).href, origin) ?? 'outside_allowlist' : 'not_observed',
            setCookieCoverage: 'pending' });
          // headers() omits security headers. headerValue reads metadata of the
          // already received response over Playwright's protocol, never HTTP.
          if (headerReads < 100) {
            headerReads++;
            void r.headerValue('set-cookie').then(cookie => {
              if (ended) return;
              record({ event: 'response_cookie_metadata', correlation: value.id, setCookiePresent: cookie !== null });
              if (cookie) for (const metadata of safeSetCookieMetadata(cookie, req.url(), origin)) {
                record({ event: 'set_cookie', correlation: value.id, ...metadata });
              }
            }).catch(() => { if (!ended) record({ event: 'response_cookie_metadata', correlation: value.id, coverage: 'unavailable' }); });
          } else record({ event: 'response_cookie_metadata', correlation: value.id, coverage: 'unavailable' });
          sample();
        } catch { /* No raw errors. */ }
      };
      bindings.push({ page, request, response }); page.on('request', request); page.on('response', response); page.on('close', pageClosed);
    }
    context.on('close', closed);
  } catch { stop('installation_failed'); }
  return observer;
}
