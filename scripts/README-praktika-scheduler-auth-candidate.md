# Scheduler authentication-candidate diagnostic

Local implementation only; review and explicitly deploy before using these instructions.
This is an ACTIVE retrieval using the existing Render helper's Playwright context.
It is not authentication proof and cannot release queued writes. Do not log out,
restart, reconnect or challenge the shared session to test it.

## Confirmed request

The operator supplied a successful manual Scheduler capture: POST to
`https://praktika.praktika.net.au/php/forms/db_getFormData.php`, JSON serialization:

```json
[{"parameters":{"practice_id":1181,"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"},"fields":["practice_schedule"]}]
```

Use the same current date from `praktikaPracticeDate` for both parameters and the
Referer `https://praktika.praktika.net.au/v2/scheduler/YYYY-MM-DD`.
Headers: Content-Type `application/json`, Origin `https://praktika.praktika.net.au`,
Accept `application/json, text/plain, */*`. X-Requested-With is absent.
Playwright context supplies cookies; code never reads or constructs Cookie headers.
Redirect limit zero; request and overall evidence deadline 10 seconds. Responses
above 2 MiB are rejected (post-download limit when Content-Length is unavailable).
Response disposal releases Playwright's retained response. Raw data is never stored
in the job or logged. Context transport may naturally process server Set-Cookie;
there is no manual cookie or snapshot manipulation.

This exact request was observed during manual Scheduler retrieval. It contains
only retrieval fields and no commit/update action. Repository inspection cannot
prove the remote implementation has zero incidental effects (logs/session activity).
A positive diagnostic proves only this response contract, not every write permission.

## One-shot operator SQL (Supabase SQL editor)

Do not run until the implementation is reviewed/deployed. Select the intended
app user from your authorized account records; never use draft creator/provider IDs.
First inspect its existing live generation (replace the placeholder):

```sql
select app_user_id, helper_instance_id, status,
       helper_heartbeat_at > clock_timestamp() - interval '90 seconds' as heartbeat_fresh
from public.praktika_sessions
where scope = 'user' and app_user_id = '<APP_USER_UUID>'::uuid;
```

Choose one new diagnostic UUID and retain it. Paste the observed generation below.
Reusing the same diagnostic UUID makes repeated submission a no-op, even after
completion. This inserts at most one new diagnostic row, never edits a workflow.

```sql
insert into public.praktika_helper_jobs
  (id, app_user_id, job_type, status, priority, request)
select '<DIAGNOSTIC_UUID>'::uuid, s.app_user_id,
       'praktika_scheduler_auth_candidate_probe', 'diagnostic_requested', 1000,
       jsonb_build_object('helperInstanceId', s.helper_instance_id)
from public.praktika_sessions s
where s.scope = 'user' and s.app_user_id = '<APP_USER_UUID>'::uuid
  and s.helper_instance_id = '<OBSERVED_GENERATION_UUID>'::uuid
  and s.helper_heartbeat_at > clock_timestamp() - interval '90 seconds'
  and s.helper_heartbeat_at <= clock_timestamp()
  and s.status in ('connected', 'refreshing')
on conflict (id) do nothing;
```

No Cookie, credentials or request payload is supplied by the operator. The helper
constructs the fixed contract. Its poll matches the app user AND generation, with
ownership checks before claiming/requesting and reporting. A request older than
60 seconds is ignored. Polling skips login transitions and active normal jobs.
It does not block the normal job drain or change its attempts/eligibility.

Ordinary watcher/worker scans use pending status; diagnostic_requested is invisible
to them and cannot wake a stopped helper. Expected status progression:
`diagnostic_requested` -> `diagnostic_processing` -> `diagnostic_completed`.
Completion means the observation finished, including negative results. Interruption
or loss of ownership can leave processing; it is never automatically replayed.

Read only:

```sql
select id, status, attempts, created_at, completed_at, response
from public.praktika_helper_jobs
where id = '<DIAGNOSTIC_UUID>'::uuid
  and job_type = 'praktika_scheduler_auth_candidate_probe'
  and app_user_id = '<APP_USER_UUID>'::uuid;
```

Retain the row for audit; no cleanup is required. If cleanup is later authorized,
identify only this exact diagnostic UUID/type/user, never historical workflow rows.

## Evidence and correlation

One event: `[Praktika auth candidate] scheduler_probe` with only helperToken,
httpStatus, redirected, expectedPath, jsonParsed, topLevelObject,
practiceScheduleIsArray, authErrorDetected, errorEnvelope, classification.
The same sanitized object is the job response. Unknown top-level keys fail closed;
no schedule entry is inspected. Negative fixtures do not prove all live challenge
formats are known; this must not be promoted into authentication based on fixtures.

After approved deployment, request one observation during normal GST 200 operation.
During a naturally occurring GST 307 period request a separate one-shot observation.
Compare ONLY identical helperToken values and nearby timestamps. Do not force
failure or restart/reconnect. If Scheduler also redirects, stop and report it.
A 200 candidate during GST 307 is useful evidence, not permission to replace GST.
