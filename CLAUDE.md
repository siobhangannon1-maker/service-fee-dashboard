@AGENTS.md

# Claude Code notes

AGENTS.md (imported above) is the main rulebook and applies to Claude as well. Where it says "Codex", read "Claude".
This section only adds what is specific to working with Claude Code.

## Keep it simple (most important)

- Make the smallest change that fixes the actual problem. Don't redesign while fixing a bug.
- Before adding a new table, column, status value, flag, guard, fence, version or abstraction, check whether an existing one, or a simpler approach, would do. If you still think it's needed, say why in one sentence.
- Every new safeguard must name the specific failure it prevents. No "just in case" checks.
- Prefer working something out in one place over keeping several copies in sync. Prefer one SQL query or function over many Supabase round-trips from Next.js.
- If a fix for one problem starts touching unrelated workflows, or grows past about 5 files or needs a migration, stop and present a plan first (plan mode).
- When a fix can be simpler than the existing code around it, say so rather than matching the complexity.

## How to work with me

- I'm not a software engineer. Explain in plain English and keep it short.
- Non-trivial work goes plan -> my approval -> implement -> validate -> completion report (the format is in AGENTS.md).
- Work on a branch, not `main`. Don't create new git worktrees unless I ask. There are already many stale ones.
- The `main` working tree has unrelated uncommitted changes. Don't touch, stage or revert files you weren't asked to change.

## Commands

- Dev server: `npm run dev`
- Build: `npm run build`
- Type check: `npx tsc --noEmit`
- Lint: `npx eslint <paths>`
- Unit tests (node:test): `npx tsx --test <file>.test.ts`, e.g. `npx tsx --test lib/report-writing/*.test.ts`
- `*-db.test.py` files need a disposable local Postgres. Never point them at production.

## Infrastructure (identifiers, not secrets)

| Resource | Identifier |
| --- | --- |
| Supabase project | `laolaeigxhgkotchrefj` |
| Vercel project | `service-fee-dashboard` (`prj_lhGgnI5tOZIAlY1XDTKRslZsYncn`) |
| Render Praktika watcher | `docudental-praktika-refresh` (`srv-d8nlpb3bc2fs73f6dnl0`) |
| Render MediRef watcher | `docudental-mediref-worker` (`srv-d8nlqlsvikkc73d1t7kg`) |
| GitHub | `siobhangannon1-maker/service-fee-dashboard` |

Pushing to `main` deploys the web app on Vercel. Render auto-deploy was off at last check.

## MCP servers (see .mcp.json)

- **supabase**: read-only and limited to the project above. Use it for schema, indexes, functions, RLS and `EXPLAIN ANALYZE`. Use counts and aggregates, and avoid selecting names, DOBs, contact details or letter text.
- **vercel**: read deployments, build logs and runtime logs only. Never deploy, promote, roll back, or change env vars, domains or project settings.
- **render**: read service status, logs and metrics only. Never deploy, restart, suspend, scale, or change env vars or start commands.
- Any write action through an MCP server needs my explicit instruction in the current conversation.

## Letters (report writing) module map

- Typist UI: `app/(protected)/report-writing/typist/TypistPage.tsx`
- Provider UI: `app/(protected)/report-writing/provider/ProviderReportClient.tsx`
- APIs: `app/api/report-writing/`
- Logic and tests: `lib/report-writing/` (list loading: `draft-list-reader.ts`; history evidence: `historical-workflow-*.ts`)
- Praktika / MediRef logic: `lib/praktika/`, `lib/mediref/`. Watchers: `scripts/watch-*-refresh.ts`
- Key tables: `report_drafts`, `praktika_helper_jobs`, `mediref_helper_jobs`, `report_writing_audit_events`

## Reference material

`PROJECT_RULES_AND_CONTEXT.md` is a dated handover (15 Oct 2026). Read it for history and context. Its runbooks and production observations are not current instructions or standing permission.
