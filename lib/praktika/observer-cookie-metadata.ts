// Diagnostic-only. Private keyed digests are never included in returned log fields.
import type { Cookie } from 'playwright';

type Fields = Record<string, string | number | boolean>;
type Digest = (value: string) => string;
type PrivateCookie = {
  name: string; value: string; attributes: string; expiry: string;
};
export type DomainCookieState = { cookies: Map<string, PrivateCookie>; counts: Fields; applicable: Set<string>[] };
const requiredNames = ['PHPSESSID', 'UAT'] as const;
const categories = ['root', 'php', 'php_json', 'php_security', 'v2', 'other_same_origin'] as const;

export function cookiePathCategory(path: string): typeof categories[number] {
  if (path === '/') return 'root';
  const beneath = (prefix: string) => path === prefix || path.startsWith(prefix + '/');
  if (beneath('/php/json')) return 'php_json';
  if (beneath('/php/security')) return 'php_security';
  if (beneath('/php')) return 'php';
  if (beneath('/v2')) return 'v2';
  return 'other_same_origin';
}

export function cookieDomainCategory(domain: string, host: string): 'host' | 'parent_domain' | 'unrelated' {
  const normalized = domain.toLowerCase();
  const bare = normalized.replace(/^\./, '');
  if (bare === host.toLowerCase()) return 'host';
  if (normalized.startsWith('.') && host.toLowerCase().endsWith('.' + bare)) return 'parent_domain';
  return 'unrelated';
}

// RFC path-boundary matching, not a bare prefix (/php must not match /phpOther).
export function cookieApplies(cookie: Cookie, url: URL, now = Date.now()): boolean {
  return cookieDomainCategory(cookie.domain, url.hostname) !== 'unrelated'
    && (!cookie.secure || url.protocol === 'https:')
    && (cookie.expires === -1 || cookie.expires * 1000 > now)
    && (url.pathname === cookie.path || (url.pathname.startsWith(cookie.path)
      && (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/')));
}

export function praktikaDomainCookies(jar: Cookie[], origin: string): Cookie[] {
  const host = new URL(origin).hostname;
  return jar.filter(cookie => cookieDomainCategory(cookie.domain, host) !== 'unrelated');
}

export function domainCookieState(jar: Cookie[], origin: string, digest: Digest, now = Date.now()): DomainCookieState {
  const host = new URL(origin).hostname;
  const relevant = praktikaDomainCookies(jar, origin);
  const cookies: DomainCookieState['cookies'] = new Map();
  const counts: Fields = { praktikaCookieCount: relevant.length, distinctCookieNameCount: 0,
    duplicateNameCount: 0, rootScopedCookieCount: 0, phpScopedCookieCount: 0, otherPathScopedCookieCount: 0 };
  const byName = new Map<string, number>();
  for (const name of requiredNames) {
    counts[name + 'Count'] = 0;
    counts[name + 'HostDomainCount'] = 0; counts[name + 'ParentDomainCount'] = 0;
    for (const expiry of ['session', 'persistent', 'expired']) counts[name + 'Expiry_' + expiry + 'Count'] = 0;
    for (const category of categories) counts[name + 'Path_' + category + 'Count'] = 0;
  }
  for (const cookie of relevant) {
    const id = digest(JSON.stringify([cookie.name, cookie.domain, cookie.path,
      'partitionKey' in cookie ? cookie.partitionKey : null]));
    cookies.set(id, { name: requiredNames.includes(cookie.name as typeof requiredNames[number]) ? cookie.name : '[other_cookie]',
      value: digest(cookie.value), attributes: digest(JSON.stringify([cookie.secure, cookie.httpOnly, cookie.sameSite, cookie.expires])),
      expiry: cookie.expires === -1 ? 'session' : cookie.expires * 1000 <= now ? 'expired' : 'persistent' });
    byName.set(cookie.name, (byName.get(cookie.name) ?? 0) + 1);
    const category = cookiePathCategory(cookie.path);
    const scope = category === 'root' ? 'rootScopedCookieCount' : category.startsWith('php') ? 'phpScopedCookieCount' : 'otherPathScopedCookieCount';
    counts[scope] = Number(counts[scope]) + 1;
    if (requiredNames.includes(cookie.name as typeof requiredNames[number])) {
      const name = cookie.name;
      counts[name + 'Count'] = Number(counts[name + 'Count']) + 1;
      counts[name + 'Path_' + category + 'Count'] = Number(counts[name + 'Path_' + category + 'Count']) + 1;
      const domainField = name + (cookieDomainCategory(cookie.domain, host) === 'host' ? 'HostDomainCount' : 'ParentDomainCount');
      counts[domainField] = Number(counts[domainField]) + 1;
      const expiryField = name + 'Expiry_' + cookies.get(id)!.expiry + 'Count';
      counts[expiryField] = Number(counts[expiryField]) + 1;
    }
  }
  counts.distinctCookieNameCount = byName.size;
  counts.duplicateNameCount = [...byName.values()].filter(count => count > 1).length;
  const targets = [new URL('/v2/', origin), new URL('/php/json/db_reportingDataWarehouse.php', origin), new URL('/php/security/db_refreshToken.php', origin)];
  const applicable = targets.map(url => relevant.filter(cookie => cookieApplies(cookie, url, now)));
  const labels = ['v2', 'phpJson', 'phpSecurity'];
  applicable.forEach((set, index) => {
    counts[labels[index] + 'ApplicableCookieCount'] = set.length;
    for (const name of requiredNames) counts[labels[index] + name + 'Count'] = set.filter(c => c.name === name).length;
  });
  const identitySets = applicable.map(set => new Set(set.map(c => digest(JSON.stringify([c.name, c.domain, c.path, 'partitionKey' in c ? c.partitionKey : null])))));
  const identities = identitySets.map(set => new Set([...set].filter(id => cookies.get(id)?.name !== '[other_cookie]')));
  const differs = (a: Set<string>, b: Set<string>) => a.size !== b.size || [...a].some(id => !b.has(id));
  counts.requiredCookieSetDiffersBetweenV2AndPhpJson = differs(identities[0], identities[1]);
  counts.requiredCookieSetDiffersBetweenPhpJsonAndPhpSecurity = differs(identities[1], identities[2]);
  return { cookies, counts, applicable: identitySets };
}

export function domainCookieComparison(next: DomainCookieState, before?: DomainCookieState): Fields {
  const fields: Fields = { fullDomainBaselineKnown: !!before, ...next.counts };
  if (!before) return fields; // Unknown must never be reported as unchanged.
  const ids = new Set([...before.cookies.keys(), ...next.cookies.keys()]);
  const summarize = (prefix: string, predicate: (cookie: PrivateCookie) => boolean) => {
    const selected = [...ids].filter(id => [before.cookies.get(id), next.cookies.get(id)].some(c => c && predicate(c)));
    const added = selected.filter(id => !before.cookies.has(id)).length;
    const removed = selected.filter(id => !next.cookies.has(id)).length;
    const changed = (field: 'value' | 'attributes' | 'expiry') => selected.filter(id => before.cookies.has(id) && next.cookies.has(id)
      && before.cookies.get(id)![field] !== next.cookies.get(id)![field]).length;
    fields[prefix + 'CookiesAddedCount'] = added; fields[prefix + 'CookiesRemovedCount'] = removed;
    fields[prefix + 'CookiesValueChangedCount'] = changed('value');
    fields[prefix + 'CookiesAttributesChangedCount'] = changed('attributes');
    fields[prefix + 'CookiesExpiryClassificationChangedCount'] = changed('expiry');
    fields[prefix + 'IdentityChanged'] = added + removed > 0;
  };
  summarize('fullDomain', () => true);
  summarize('other', cookie => cookie.name === '[other_cookie]');
  for (const name of requiredNames) summarize(name, cookie => cookie.name === name);
  fields.duplicateNameCountChanged = next.counts.duplicateNameCount !== before.counts.duplicateNameCount;
  fields.phpScopedCookieCountChanged = next.counts.phpScopedCookieCount !== before.counts.phpScopedCookieCount;
  ['v2', 'phpJson', 'phpSecurity'].forEach((label, index) => {
    const previous = before.applicable[index], current = next.applicable[index];
    fields[label + 'CookieStateChanged'] = previous.size !== current.size || [...new Set([...previous, ...current])].some(id => {
      if (!previous.has(id) || !current.has(id)) return true;
      const a = before.cookies.get(id)!, b = next.cookies.get(id)!;
      return a.value !== b.value || a.attributes !== b.attributes || a.expiry !== b.expiry;
    });
  });
  return fields;
}

// Only metadata from an already received response. Never fetch or expose raw attributes.
export function safeSetCookieMetadata(header: string, responseUrl: string, origin: string, now = Date.now()): Fields[] {
  if (header.length > 32_768) return [{ metadataAvailable: false, reason: 'header_limit' }];
  const url = new URL(responseUrl, origin);
  if (url.origin !== new URL(origin).origin) return [];
  const lines = header.split(/\n|,(?=\s*[^\s;,=]+\s*=)/);
  const result = lines.slice(0, 20).map(line => {
    const parts = line.split(';'); const equals = parts[0].indexOf('=');
    if (equals <= 0) return { metadataAvailable: false, reason: 'unparseable' } as Fields;
    const name = parts[0].slice(0, equals).trim();
    const attributes = new Map(parts.slice(1).map(part => {
      const index = part.indexOf('=');
      return [part.slice(0, index < 0 ? undefined : index).trim().toLowerCase(), index < 0 ? '' : part.slice(index + 1).trim()];
    }));
    const domain = attributes.get('domain'); const path = attributes.get('path');
    const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
    const effectivePath = path?.startsWith('/') ? path : defaultPath;
    const sameSite = attributes.get('samesite')?.toLowerCase();
    const maxAge = attributes.get('max-age'); const expires = attributes.get('expires');
    const validMaxAge = maxAge !== undefined && /^-?\d+$/.test(maxAge) && Number.isFinite(Number(maxAge));
    const expiryTime = expires === undefined ? NaN : Date.parse(expires);
    return { metadataAvailable: true, name: requiredNames.includes(name as typeof requiredNames[number]) ? name : '[other_cookie]',
      domainCategory: domain === undefined ? 'default_host' : cookieDomainCategory(domain.startsWith('.') ? domain : '.' + domain, url.hostname),
      pathCategory: cookiePathCategory(effectivePath), pathPresent: attributes.has('path'), domainPresent: attributes.has('domain'),
      pathUsesDefault: !path?.startsWith('/'), secure: attributes.has('secure'), httpOnly: attributes.has('httponly'),
      sameSite: ['strict', 'lax', 'none'].includes(sameSite ?? '') ? sameSite! : sameSite === undefined ? 'absent' : 'unrecognized',
      maxAgePresent: attributes.has('max-age'), expiresPresent: attributes.has('expires'),
      expiryInstructionPresent: attributes.has('max-age') || attributes.has('expires'),
      deletionInstructionKnown: validMaxAge || Number.isFinite(expiryTime),
      deletionInstruction: validMaxAge ? Number(maxAge) <= 0 : Number.isFinite(expiryTime) && expiryTime <= now };
  });
  if (lines.length > 20) result.push({ metadataAvailable: false, reason: 'cookie_header_limit' });
  return result;
}
