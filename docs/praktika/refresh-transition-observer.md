# Temporary passive refresh observer

Default OFF: `PRAKTIKA_REFRESH_OBSERVER` must equal `true` exactly. No observer listeners or cookie sampling are installed when off.

This is diagnostic instrumentation, not refresh recovery. It never calls request, navigation, cookie mutation, job or database APIs. The enabled observer reads the cookie jar once on installation and after observed responses during capture. That causes small diagnostic CPU/browser-protocol overhead; it does not insert sleeps or await diagnostics in dispatch.

The owning helper arms one observation for at most five minutes. Exact same-origin HTTPS refresh-token 307 plus Set-Cookie starts one 15-second capture, with up to 30 sanitized pre-trigger entries and 200 capture entries. No rearming. Closing, shutdown, ownership loss, replaced context, or existing positive authentication/challenge detection stops and detaches it. A plain HTTP 200 does not establish authentication.

Only known static paths are printed; other same-origin paths are `[other_same_origin]`. Queries, fragments, bodies and arbitrary header values are never emitted. Cookie names are limited to UAT/PHPSESSID; others are `[other_cookie]`. Cookie attributes are boolean/enum only. Jar value comparisons use an ephemeral keyed digest retained only in memory; output contains changed/baselineKnown booleans, never digests. First sample cannot establish change. Async cookie samples are observations, not causal proof that a particular response changed the jar.

BrowserContext request/response events are labelled `page`: they are browser-origin traffic, NOT proof of human intent or natural frontend behavior (page.evaluate automation can also produce them). Explicit GST probe observations are labelled `helper_probe`. Other APIRequestContext automation is not intercepted or monkey-patched and may be absent. Do not infer that a missing request did not occur. Browser navigation paths are observed; existing password/MFA checks supply challenge observations without extra DOM polling.

Controlled activation (separate deployment approval required): deploy only the reviewed observer patch to the existing Render helper, then set PRAKTIKA_REFRESH_OBSERVER=true for a supervised diagnostic window. This task does not perform either action. Prefer a session/window without patient writes; the observer does not disable or control normal jobs. Do not expire a session, trigger a write, force a 307 or invoke a refresh endpoint for observation.

Look for `[Praktika refresh observer]` JSON `start`, same observation identifier events, and `end`. A useful trace shows page refresh-target activity (if any), cookie changes, and `end.reason=authenticated` from the existing strict fence; 200 alone is insufficient. Compare multiple traces before proposing recovery. Authentication success before a transition leaves the bounded observer armed. After capture ends, a fresh helper lifecycle is needed for another deliberately approved observation.

Disable by removing the flag or setting it false; restart only through an approved deployment/operations step. Existing one-shot observers detach automatically within their bounds. No migrations or cleanup RPCs are needed. Do not export raw HAR or cookie values.
