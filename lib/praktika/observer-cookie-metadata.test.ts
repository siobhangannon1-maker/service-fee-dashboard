import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Cookie } from 'playwright';
import { cookieApplies, cookieDomainCategory, cookiePathCategory, domainCookieState, domainCookieComparison, safeSetCookieMetadata } from './observer-cookie-metadata';

const origin = 'https://praktika.praktika.net.au';
const secret = 'SYNTHETIC_COOKIE_VALUE_DO_NOT_LOG';
const digest = (text: string) => createHmac('sha256', 'PRIVATE_TEST_KEY').update(text).digest('hex');
const cookie = (name = 'PHPSESSID', path = '/', overrides: Partial<Cookie> = {}): Cookie => ({ name, path, value: secret,
  domain: 'praktika.praktika.net.au', secure: true, httpOnly: true, sameSite: 'Lax', expires: -1, ...overrides });
const state = (jar: Cookie[]) => domainCookieState(jar, origin, digest, 1_000_000);
const safe = (output: unknown) => assert.doesNotMatch(JSON.stringify(output),
  /SYNTHETIC|PRIVATE|DO_NOT_LOG|patient|password|https:|Set-Cookie|[a-f0-9]{64}/i);

test('root cookies apply equally to the three local paths; unknown baseline is explicit', () => {
  const fields = domainCookieComparison(state([cookie(), cookie('UAT')]));
  for (const label of ['v2', 'phpJson', 'phpSecurity']) assert.equal(fields[label + 'ApplicableCookieCount'], 2);
  assert.equal(fields.requiredCookieSetDiffersBetweenV2AndPhpJson, false);
  assert.equal(fields.requiredCookieSetDiffersBetweenPhpJsonAndPhpSecurity, false);
  assert.equal(fields.fullDomainBaselineKnown, false); assert.equal('fullDomainCookiesValueChangedCount' in fields, false); safe(fields);
});

test('duplicate required names distinguish root, PHP and security identities privately', () => {
  const fields = domainCookieComparison(state([cookie(), cookie('PHPSESSID', '/php/'), cookie('PHPSESSID', '/php/security/'),
    cookie('UAT'), cookie('UAT', '/php/json/', { domain: '.praktika.net.au' })]));
  assert.equal(fields.PHPSESSIDCount, 3); assert.equal(fields.UATCount, 2); assert.equal(fields.duplicateNameCount, 2);
  assert.equal(fields.PHPSESSIDPath_rootCount, 1); assert.equal(fields.PHPSESSIDPath_phpCount, 1);
  assert.equal(fields.PHPSESSIDPath_php_securityCount, 1); assert.equal(fields.UATParentDomainCount, 1);
  assert.equal(fields.v2ApplicableCookieCount, 2); assert.equal(fields.phpJsonApplicableCookieCount, 4);
  assert.equal(fields.phpSecurityApplicableCookieCount, 4);
  assert.equal(fields.requiredCookieSetDiffersBetweenV2AndPhpJson, true);
  assert.equal(fields.requiredCookieSetDiffersBetweenPhpJsonAndPhpSecurity, true); safe(fields);
});

test('domain matching rejects unrelated and deceptive suffixes; paths respect boundaries', () => {
  for (const domain of ['patient.secret.invalid', 'evilpraktika.net.au', 'praktika.net.au', '.evilpraktika.net.au']) {
    assert.equal(cookieDomainCategory(domain, 'praktika.praktika.net.au'), 'unrelated');
  }
  assert.equal(cookieDomainCategory('.praktika.net.au', 'praktika.praktika.net.au'), 'parent_domain');
  assert.equal(cookieDomainCategory('.praktika.praktika.net.au', 'praktika.praktika.net.au'), 'host');
  assert.equal(cookieApplies(cookie('PHPSESSID', '/php'), new URL('/phpOther', origin)), false);
  assert.equal(cookieApplies(cookie('PHPSESSID', '/php'), new URL('/php/json/a', origin)), true);
  assert.equal(cookieApplies(cookie(), new URL('http://praktika.praktika.net.au/v2/')), false);
  assert.equal(cookieApplies(cookie('UAT', '/', { expires: 1 }), new URL(origin), 2000), false);
  const fields = domainCookieComparison(state([cookie(), cookie('PRIVATE_THIRD_PARTY', '/patient/PRIVATE', { domain: '.outside.invalid' })]));
  assert.equal(fields.praktikaCookieCount, 1); safe(fields);
  assert.equal(cookiePathCategory('/php/security/patient/PRIVATE'), 'php_security');
  assert.equal(cookiePathCategory('/phpOther/patient/PRIVATE'), 'other_same_origin');
});

test('value, identity, attributes, expiry, addition and removal are independent sanitized aggregates', () => {
  const before = state([cookie(), cookie('UAT'), cookie('PRIVATE_REMOVED', '/php/')]);
  const after = state([cookie('PHPSESSID', '/', { value: secret + '_NEW', expires: 2000, httpOnly: false }),
    cookie('UAT', '/php/security/'), cookie('PRIVATE_ADDED', '/php/json/', { value: secret + '_OTHER' })]);
  const fields = domainCookieComparison(after, before);
  assert.equal(fields.PHPSESSIDCookiesValueChangedCount, 1); assert.equal(fields.PHPSESSIDCookiesAttributesChangedCount, 1);
  assert.equal(fields.PHPSESSIDCookiesExpiryClassificationChangedCount, 1); assert.equal(fields.PHPSESSIDIdentityChanged, false);
  assert.equal(fields.UATIdentityChanged, true); assert.equal(fields.UATCookiesAddedCount, 1); assert.equal(fields.UATCookiesRemovedCount, 1);
  assert.equal(fields.otherCookiesAddedCount, 1); assert.equal(fields.otherCookiesRemovedCount, 1);
  assert.equal(fields.phpJsonCookieStateChanged, true); assert.equal(fields.phpSecurityCookieStateChanged, true);
  assert.equal(fields.duplicateNameCountChanged, false); safe(fields);
});

test('expiry passage changes classification and local applicability without emitting timestamps', () => {
  const jar = [cookie('PHPSESSID', '/', { expires: 1001 })];
  const before = domainCookieState(jar, origin, digest, 1_000_000);
  const after = domainCookieState(jar, origin, digest, 1_002_000);
  const fields = domainCookieComparison(after, before);
  assert.equal(fields.PHPSESSIDCookiesAttributesChangedCount, 0);
  assert.equal(fields.PHPSESSIDCookiesExpiryClassificationChangedCount, 1);
  assert.equal(fields.phpJsonApplicableCookieCount, 0); assert.equal(fields.phpJsonCookieStateChanged, true); safe(fields);
});

test('307 Set-Cookie metadata classifies explicit scopes and defaults without logging raw headers', () => {
  const header = `PHPSESSID=${secret}; Path=/php/security/; Domain=praktika.net.au; Secure; HttpOnly; SameSite=None; Max-Age=0; Expires=Wed, 01 Jan 2020 00:00:00 GMT\nUAT=${secret}; Path=/; SameSite=Lax\nPRIVATE_NAME=${secret}; Domain=patient.secret.invalid; Path=/patient/PRIVATE; Weird=password`;
  const fields = safeSetCookieMetadata(header, origin + '/php/json/db_reportingDataWarehouse.php?password=PRIVATE', origin, 1_000_000);
  assert.equal(fields[0].name, 'PHPSESSID'); assert.equal(fields[0].domainCategory, 'parent_domain');
  assert.equal(fields[0].pathCategory, 'php_security'); assert.equal(fields[0].secure, true); assert.equal(fields[0].httpOnly, true);
  assert.equal(fields[0].sameSite, 'none'); assert.equal(fields[0].deletionInstruction, true);
  assert.equal(fields[1].pathCategory, 'root'); assert.equal(fields[2].name, '[other_cookie]');
  assert.equal(fields[2].domainCategory, 'unrelated'); assert.equal(fields[2].pathCategory, 'other_same_origin'); safe(fields);
  const defaults = safeSetCookieMetadata(`PHPSESSID=${secret}; Secure`, origin + '/php/json/probe.php', origin);
  assert.equal(defaults[0].pathCategory, 'php_json'); assert.equal(defaults[0].pathUsesDefault, true);
  assert.equal(defaults[0].domainCategory, 'default_host'); assert.equal(defaults[0].deletionInstructionKnown, false);
});

test('combined headers, invalid expiry, precedence and parser limits remain safe', () => {
  const combined = safeSetCookieMetadata(`PHPSESSID=${secret}; Expires=Wed, 01 Jan 2020 00:00:00 GMT, UAT=${secret}; Max-Age=10; Expires=Wed, 01 Jan 2020 00:00:00 GMT`, origin, origin);
  assert.equal(combined.length, 2); assert.equal(combined[0].deletionInstruction, true); assert.equal(combined[1].deletionInstruction, false); safe(combined);
  const invalid = safeSetCookieMetadata(`PHPSESSID=${secret}; Max-Age=password; Expires=PRIVATE; SameSite=password; Path=PRIVATE`, origin, origin);
  assert.equal(invalid[0].deletionInstructionKnown, false); assert.equal(invalid[0].sameSite, 'unrecognized'); safe(invalid);
  safe(safeSetCookieMetadata(secret.repeat(2000), origin, origin));
  assert.equal(safeSetCookieMetadata(Array.from({ length: 25 }, () => `UAT=${secret}`).join('\n'), origin, origin).length, 21);
  assert.deepEqual(safeSetCookieMetadata(`UAT=${secret}`, 'https://outside.invalid', origin), []);
});
