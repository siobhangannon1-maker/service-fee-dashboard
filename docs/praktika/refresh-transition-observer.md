# Temporary passive refresh observer V2

Default OFF: `PRAKTIKA_REFRESH_OBSERVER` must equal `true` exactly. With it unset/false the runtime installs no observer registry/listeners and performs no observer cookie sampling. No migration or production configuration change is part of this patch.

## Lifecycle and authentication signal

The existing context-launch hook registers the observer and emits `installed` with `state=awaiting_authentication`. Before authentication it retains only a context-close listener: no network listeners, cookie sampling, or pre-trigger timer. Credential/MFA detection during initial login cannot consume its useful observation window.

The existing `stopRefreshObservation(context, 'authenticated')` hook now also signals post-auth arming. That hook is reached only after `probePraktikaAuthentication` returns `verified=true` and HTTP 200, the existing owned `authenticate` write succeeds, and the existing context/ownership checks pass. It creates no request and grants no authentication. Plain observed HTTP 200, browser readiness and successful cookie snapshots cannot arm it.

The first such signal arms a five-minute window and captures one private authentication cookie baseline. Repeated healthy write fences do not restart the timer or resample the baseline. A confirmed authentication during capture terminates that capture. Login/MFA after arming terminates observation and invalidates the baseline. A later strict authentication can permit the remaining fallback, but does not replenish the per-context budgets or invent a new baseline.

## Delayed refresh transition

The existing GST probe callback forwards the already-received response. An exact same-origin HTTPS 307 redirect to `/php/security/db_refreshToken.php` with Set-Cookie triggers capture. It does not follow the redirect. If the earlier window/capture ended, this explicit callback may start **one fallback capture** for that authenticated context. Browser events cannot activate fallback themselves. Missing/failed cookie baseline does not prevent capture but is reported as unknown.

Bounds per context/generation:

- One post-auth armed window: at most five minutes.
- One initial capture plus at most one fallback capture; repeated installation cannot reset this budget.
- Each capture: at most 15 seconds and 200 recorded events, including buffered entries.
- Pre-trigger ring: at most 30 sanitized entries.
- Cookie baseline: at most 100 entries. Oversized jars are unavailable, never silently truncated into an unchanged comparison.
- In-flight cookie samples are not duplicated. A baseline still in flight when the transition arrives is discarded rather than mislabeled as pre-transition evidence.
- On window expiry, network/page listeners detach. Only the dormant registry, bounded private baseline and context-close listener remain available for fallback. There is no recurring observer timer, scan, polling or rearming loop.
- Ownership loss, context replacement, shutdown and context close permanently terminate the context's observer and erase its private baseline/key. An inert WeakMap entry prevents reinstalling the same fenced context; garbage collection releases it with the context.

`installed`, `armed`, `installation_failed`, and `terminated` make lifecycle visible. `terminated` includes reason, triggered boolean, duration, recorded-event count and capture/fallback counts, even if capture never triggered. Installation failures expose only a fixed category, never the exception. Logging failures never affect execution.

## Evidence and privacy

Capture events: `start`, `request`, `response`, `navigation`, `set_cookie`, `cookie_baseline`, `cookie_state`, `cookie_observation_unavailable`, plus the lifecycle events above. All use `[Praktika refresh observer]`. Correlation uses an ephemeral random observation identifier, not raw generation/session IDs or keyed hashes.

Only allowlisted static paths are printed. Other same-origin paths become `[other_same_origin]`; external paths, query strings, fragments, bodies, header values, arbitrary cookie names, credentials and patient content are never emitted. Set-Cookie diagnostics expose only allowlisted cookie names and boolean attributes.

The baseline holds keyed hashes of cookie identity (name/domain/path), value and attributes privately. Output contains counts and booleans: baselineKnown, requiredCookieCount, requiredIdentityChanged, requiredValueChanged, additionalStateChanged and attributesChanged. Values, domains, paths, expiry timestamps and hashes are never printed. Value comparison requires the same cookie identity; identity changes are reported separately. Attribute comparisons cover Secure, HttpOnly, SameSite and expiry. No available baseline means change booleans must not be interpreted as proof of no change.

Unchanged cookies never prove server authentication. This observer does not inspect localStorage, sessionStorage, browser-memory tokens or server session state. Cookie sampling is asynchronous and does not prove that a particular response caused a change.

BrowserContext request/response events are labelled `page`: browser-origin traffic is not proof of human activity. The GST APIRequestContext response is explicitly labelled `helper_probe`; other APIRequestContext requests are not intercepted. Observer code initiates no HTTP requests, navigation, redirects, cookie writes, retries, jobs or database operations, and changes no authentication/cooldown/job decisions.

Activation/deployment remains a separately approved operation. This patch does not reconnect, restart, redeploy, enable/disable the flag, or inspect/repair the current production browser.

## Existing keepalive summaries

When the same flag is exactly `true`, the existing `performRealBrowserActivity()` GET `/v2/` reports `keepalive_summary` through the observer registry. No new keepalive, request, navigation or redirect is introduced. `redirect: "error"`, cadence, warnings and job/authentication decisions are unchanged. Flag OFF adds no observer cookie reads or logging to this path.

The fetch caller exposes a success/HTTP response or a generic fetch failure. With `redirect: "error"`, it does **not** expose the rejected redirect's status or Location. Accordingly the summary never guesses `redirected`, `refresh_token`, login or another destination: `destinationCategory` is `unavailable`. A failure can also be a transport failure. No second request or additional network listener attempts to discover its cause.

Fields: `event`, random per-context `observation` correlation ID (not a keyed hash), `sequence`, `tMs`, `elapsedMs`, `outcome` (`success`, `http_error`, `fetch_failure`), `httpStatus` only when available, `destinationCategory`, `cookieObservationAvailable`, and, when observed, `requiredCookieCount`. A known private authenticated baseline additionally permits `requiredIdentityChanged`, `requiredValueChanged`, `requiredAttributesChanged`, and `additionalCookieChangeCount` (at most 200 identities across two jars of at most 100 cookies each). No cookie hashes, values, URLs, headers, bodies or exceptions are included.

The asynchronous post-keepalive cookie sample compares with the original authenticated baseline, not an immediate pre-request sample. It can show that cookies differ by this observation; it cannot attribute that change to this keepalive. Missing baseline/read failure/oversized jar reports unavailable. There is no auth-proof inference.

At most 24 summaries and 24 additional cookie reads per context/generation cover an ordinary 90-minute lifetime at the existing approximately five-minute cadence. No budget resets on authentication or duplicate installation. Summaries survive armed-window expiry without retaining network history and share the V2 capture correlation ID/timing. Final context/ownership termination stops them. Each sample has a two-second diagnostic deadline without delaying the keepalive caller. A hung cookie read stays single-flight; subsequent summaries report unavailable without initiating more reads. V2's existing fallback capture budget is unchanged.
