# Typist edit-learning worker: candidate setup

This release candidate has not been deployed or activated. The reviewed migration
is already installed in production as version `20261003100806`, name
`typist_edit_learning_queue`. Worker service creation and activation still require
explicit approval; no worker has been created by this reconstruction.

## Later Render setup

- Create one dedicated background worker, initially one instance.
- Use the approved application commit and the existing Node/tsx toolchain.
- Build/install with the repository's existing dependency installation process.
- Start command: `npm run worker:typist-edit-learning`.
- Supply server-only `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and
  `NEXT_PUBLIC_SUPABASE_URL` through the approved environment configuration.
- Keep this process separate from Praktika and MediRef; it uses no browser.
- No Redis, public HTTP endpoint, new package, automation flag or observer flag
  is required.

Do not apply or reapply `20261003000000_typist_edit_learning_queue.sql` to
production. Its exact 9,935 bytes have SHA-256
`4fe7be636a34f1cba5351ea1cd5263106438ea6bbee076382ddbb4ac60cd700e`.
The application returns an approved partial-success response if enqueue fails;
learning is then not guaranteed queued. Enqueue failure does not roll back
approval. Disposable local database tests apply this same SQL only to a fresh
synthetic cluster.

## Processing and recovery

The poller claims one saved example at a time, sleeping five seconds when empty
or polling fails. Only examples explicitly enrolled through `next_attempt_at`
and one of the three Typist sources are eligible. Existing records are not
backfilled.

Each claim has a fresh token, a 45-minute lease and increments the existing
attempt count. Transient errors retry after one minute, then five minutes; the
third claim is final. Permanent input/API rejection errors and missing AI
configuration are terminal for the claimed example. Missing database
configuration stops the worker before it can claim. An
expired third claim becomes failed when the worker next polls.

SIGTERM/SIGINT stop further claims. The current analysis may finish, but a
platform kill before it finishes relies on lease recovery. The worker has one
20-minute overall analysis deadline, including requests, response parsing,
retry delays and normalization. It passes an AbortSignal to each request and
disables SDK-managed retries because SDK 6.36 retry sleeps do not observe that
signal. A worker-only wrapper preserves two retries with cancellable waits.
The deadline aborts the active request or wait, clears its timer and enters the
existing transient failure policy. The 45-minute lease leaves 25 minutes for
completion/failure handling and ordinary scheduling delays. The ten-minute
per-request timeout remains unchanged. Provider Approval and Clinical Scribe
retain their SDK defaults. Do not assume Render's shutdown grace will cover the
analysis duration.

The completion RPC validates the current token and lease, applies the complete
normalized analysis and marks the example processed in one transaction.
Invalid/stale completions do nothing. A transaction failure rolls back all
reinforcement. A lost acknowledgement after a successful commit cannot
reinforce again. AI execution may repeat after a crash; database effects cannot
repeat for the completed example.

Logs contain IDs, attempts, status, timing and controlled failure categories.
Never print saved input, prompts, model output or SDK exceptions. For debugging,
inspect analysis status/attempts/error and scheduling fields through authorized
admin tooling; do not expose the service key or patient-bearing rows in logs.

## Preserved limitations

- Approval, queue, audit and enqueue remain separate writes. An invocation ending
  before enqueue can leave an approved draft without a learning request.
- Enqueue failure returns `success: true`, the approved draft and
  `learningQueued: false`; never automatically re-approve or re-create the draft.
- The UI prevents ordinary repeat clicks while submission is pending. New draft
  IDs remain server-generated. Retrying a brand-new save after an ambiguous
  response can create a second draft and learning example. Generic draft-create
  idempotency is outside this release.
- Updates to an existing draft reuse its ID and fingerprint. Conflicts never
  rewrite learning input, reset attempts or reopen terminal examples.
- Original/final text missing or unchanged remains ignored, with no work item.
- Provider and Clinical Scribe retain synchronous learning. Their existing
  read/update concurrency limitations are not changed by this worker.
- Hard draft/provider deletion cascades to learning examples. Training-example
  deletion removes pending work. A worker cannot recreate a deleted example.
  Existing draft text retention cleanup does not erase examples; that policy is
  unchanged.
- A queued example uses the saved approved input even if the draft is later
  edited or unapproved. No content-revision or cancellation subsystem is added.
- Complete Workflow uses approved/workflow state and never waits for learning.

## Validation before release

Run `npx tsx --test lib/report-writing/*.test.ts` and
`python3 scripts/typist-edit-learning-db.test.py`, plus TypeScript and an isolated
production build. The database test creates a new local PostgreSQL cluster with
synthetic data and a private Unix socket; it never uses a database URL or an
existing production/test cluster. It requires local PostgreSQL 17 tools; an
alternative local binary directory can be supplied with `LOCAL_PG_BIN`.

After separately approved deployment, check Typist approval latency, saved text,
queue/audit continuity, the three Typist sources, synchronous Provider/Scribe
approval, Complete Workflow independence and terminal-error visibility. Do not
send real correspondence or perform external patient writes solely to test this
worker.
