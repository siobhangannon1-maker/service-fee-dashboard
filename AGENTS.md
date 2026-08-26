# DocuDental Codex Instructions

## Project Overview

DocuDental is a production-oriented dental practice operations platform built primarily with:

- Next.js App Router
- React
- TypeScript
- Supabase
- Playwright/browser automation
- OpenAI and other AI integrations
- External integrations including Praktika, MediRef, Xero, Connecteam and other practice systems

The application contains real operational workflows.

Changes must prioritise:

1. Safety
2. Preservation of existing behaviour
3. Reuse of existing architecture
4. Small, understandable changes
5. Production reliability

Do not treat this repository as an experimental or disposable prototype.

---

# General Working Rules

Before modifying code:

1. Read the relevant existing files.
2. Trace the existing workflow from frontend to backend.
3. Identify relevant API routes, Supabase tables, helper jobs, utilities and worker scripts.
4. Reuse existing architecture where practical.
5. Avoid creating parallel or duplicate implementations.
6. Prefer the smallest safe change that solves the requested problem.
7. Consider whether the change could affect another existing workflow.

For significant or architectural changes:

- explain the proposed approach before implementing it
- identify the files expected to change
- identify database or external-system implications
- wait for approval if the task involves a risky architectural change

Do not perform unrelated refactoring while implementing a requested feature.

---

# Safety Rules

Do not perform any of the following unless explicitly instructed:

- delete existing functionality
- delete database records
- modify production data manually
- reset or recreate database tables
- change database schemas
- run destructive database migrations
- deploy to production
- push directly to production branches
- modify production environment variables
- expose credentials or secrets
- print API keys, passwords, access tokens or service-role keys
- weaken authentication or authorization
- bypass Row Level Security as a shortcut
- send real patient communications
- send real emails or SMS messages
- automatically send MediRef correspondence
- create or modify real external patient records
- enable production automation
- disable safeguards to make a test pass

If a requested change could affect production data, patient data, an external system, or automated communications, stop and explain the risk before executing the risky operation.

---

# Secrets and Environment Variables

Environment files and secrets must be handled carefully.

Never:

- display secret values
- copy secrets into source code
- expose server secrets to client components
- commit credentials
- convert private environment variables into NEXT_PUBLIC variables
- log credentials

Environment variable names may be discussed when necessary, but their values must remain private.

Supabase service-role credentials must remain server-side.

---

# Next.js Architecture

This project uses the Next.js App Router.

Follow existing project conventions.

Before creating a new page, component, route handler or server utility:

- check whether an equivalent already exists
- inspect nearby feature code for established patterns
- preserve server/client component boundaries
- reuse shared components and utilities where sensible

Do not add "use client" unnecessarily.

Do not move server-side privileged logic into browser code.

API routes should remain responsible for server-side orchestration where that matches the existing architecture.

---

# TypeScript

Maintain the existing TypeScript conventions.

Avoid:

- unnecessary `any`
- disabling TypeScript checks
- `@ts-ignore` as a shortcut
- weakening types merely to make compilation succeed

When modifying an existing interface or type:

- inspect all consumers first
- preserve backwards compatibility where appropriate

---

# Supabase Architecture

Supabase is a central part of DocuDental and is used for:

- authentication
- operational data
- workflow state
- background job queues
- automation status
- storage
- reporting data

The project contains browser, server and privileged/admin Supabase clients.

Use the appropriate existing client for the context.

Never expose the Supabase service-role key to client-side code.

Before writing a Supabase query:

1. inspect existing queries against that table
2. verify column names from existing code/schema information
3. understand relevant status/state values
4. consider Row Level Security and authentication context

Do not assume a database column or table exists.

Do not create a database migration unless explicitly requested.

If a database/schema change appears necessary, explain:

- why it is necessary
- proposed tables/columns
- migration impact
- existing data impact

and wait for approval before implementing it.

---

# Background Jobs and Automation

DocuDental uses Supabase-backed helper jobs and cloud workers for long-running browser automation.

The general architecture is:

Next.js dashboard / API
→ Supabase helper-job or command table
→ Render-hosted cloud watcher/worker
→ Playwright/browser automation
→ external system
→ result/status written back to Supabase

This architecture should generally be preserved.

IMPORTANT:

The active watcher/automation infrastructure is hosted in the cloud using Render.

The Mac Mini is NOT the active watcher or automation machine.

Do not introduce or restore a Mac Mini-based watcher architecture unless explicitly requested.

Do not replace the helper-job architecture with synchronous browser automation from a Next.js request unless explicitly requested and architecturally justified.

---

# Render Cloud Watcher

Render hosts the active DocuDental watcher/automation processes.

Relevant worker/watcher code may include scripts such as:

- Praktika watcher/refresh processors
- MediRef watcher/refresh processors
- cloud automation workers
- helper-job processors

Before changing watcher behaviour:

1. identify the job table involved
2. identify job states/status transitions
3. identify retry behaviour
4. identify concurrency behaviour
5. determine which Render process runs the code
6. determine whether the change can affect live automation

Do not deploy or restart Render services unless explicitly instructed.

---

# Praktika Integration

Praktika automation uses helper jobs, the Render-hosted cloud watcher and browser automation.

General pattern:

Dashboard/API
→ Praktika helper job
→ Render watcher
→ Praktika browser session
→ action
→ Supabase status update

Existing Praktika functionality must be preserved unless explicitly requested otherwise.

Known workflows include operations such as:

- patient/referral imports
- appointment information
- referral queue processing
- document/PDF uploads
- correspondence/general notes
- appointment icon updates

Before modifying a Praktika workflow:

- trace the existing helper-job type
- inspect the watcher/processor that handles it
- understand success/failure status handling
- check whether the operation could modify real Praktika data

Do not execute real Praktika actions merely to test code unless explicitly authorised.

---

# MediRef Integration

MediRef automation uses:

Dashboard/API
→ MediRef helper job
→ Render-hosted cloud watcher
→ MediRef browser session
→ action
→ Supabase status update

MediRef communications may involve real patients and referrers.

Treat MediRef sending as production-sensitive.

Do not enable automatic sending without explicit approval.

If `MEDIREF_AUTO_SEND` or an equivalent safety flag exists:

- preserve its current safe behaviour
- do not change it to enable sending unless explicitly instructed

Testing should prefer stopping before final send/submit whenever the existing workflow supports that.

---

# Patient Data

This application may process identifiable patient information.

Treat patient data as sensitive.

Do not:

- log patient data unnecessarily
- create test patient information in production systems
- copy patient data into comments or documentation
- send patient information to a new external service without explicit approval

When debugging, minimise patient information shown in logs.

---

# Authentication and Authorization

Do not weaken existing authentication or authorization.

Before modifying protected routes:

- inspect existing auth helpers
- preserve role checks
- preserve account/status checks
- preserve server-side authentication where currently used

Do not bypass an authorization issue simply to make a page load.

---

# Supabase MCP Access

Codex has read-only access to the live Supabase project through MCP.

Use Supabase MCP primarily to inspect:

- tables
- columns
- constraints
- foreign keys
- indexes
- RLS configuration and policies
- functions
- schema structure

Default behaviour must remain read-only.

Do not query identifiable patient data unless it is genuinely required for the task.

Do not:

- insert records
- update records
- delete records
- modify schema
- apply migrations
- change RLS policies
- alter functions
- deploy database changes

unless explicitly instructed.

If a schema or data change appears necessary:

1. inspect the current schema first
2. propose the exact change
3. explain the impact and risks
4. wait for approval before executing anything

MCP access does not imply permission to modify production.

# Existing Integrations

The repository contains multiple external integrations.

Before modifying an integration:

1. locate the existing implementation
2. understand how credentials are provided
3. understand whether calls are synchronous, queued or browser-automated
4. understand whether the integration touches production data
5. reuse existing helpers and patterns

Do not create a second integration pathway if an existing pathway can be extended.

---

# UI Changes

For UI changes:

- preserve existing functionality
- maintain the existing visual language
- reuse components where practical
- avoid large redesigns unless explicitly requested
- ensure loading/error states remain understandable
- do not remove controls merely to simplify implementation

When modifying complex pages, inspect the complete component before editing.

---

# Refactoring

Refactoring should be conservative.

Do not perform broad refactors while implementing an unrelated feature.

A requested feature should not result in:

- renaming many unrelated files
- changing APIs unnecessarily
- restructuring entire modules
- replacing established architecture without approval

If significant refactoring would genuinely improve safety or maintainability, propose it separately.

---

# Dependencies

Avoid adding new npm packages unless necessary.

Before adding a dependency:

- determine whether existing dependencies already solve the problem
- explain why the new package is needed
- consider maintenance/security impact

Do not remove dependencies unless you have confirmed they are unused.

---

# Git Safety

Treat Git as the recovery mechanism for AI-generated changes.

Before a large change, recommend that the working tree is committed or otherwise safely checkpointed if it is not already.

Do not:

- force push
- rewrite Git history
- delete branches
- run destructive Git reset commands
- automatically push changes

unless explicitly requested.

Local commits may only be created when explicitly requested.

---

# Validation After Changes

After implementing a code change:

1. review the generated diff
2. check all modified files for unintended changes
3. run relevant existing validation commands
4. run TypeScript checks where available
5. run linting where appropriate
6. run build checks when appropriate
7. distinguish pre-existing errors from errors introduced by the change

Do not change unrelated code merely to make validation pass.

Do not hide failures.

If validation cannot be completed, clearly explain why.

---

# Testing External Automation

Tests involving Praktika, MediRef or another external production system require additional caution.

Prefer:

- static analysis
- TypeScript validation
- unit/local logic tests
- queue creation without execution where safe
- dry-run behaviour
- stopping before irreversible actions

Do not submit/send/write to an external production system purely for testing unless explicitly instructed.

---

# When Unsure

If there is uncertainty about:

- database schema
- production impact
- external-system behaviour
- patient communication
- authentication
- secrets
- destructive actions
- architectural direction

stop and ask before performing the risky action.

Do not guess.

---

# Completion Report

After completing an implementation task, provide a concise report containing:

## What changed

Describe the implementation.

## Files changed

List the files modified or created.

## Why

Explain the reason for the changes.

## Validation

State exactly what was run, for example:

- TypeScript check
- lint
- build
- targeted tests

Include results.

## Manual testing

Explain what I should test in the browser or external workflow.

## Risks / follow-up

Identify anything that still requires verification.

---

# Preferred Agent Behaviour

The user is not primarily a software engineer.

When explaining changes:

- use clear language
- avoid unnecessary jargon
- explain important technical decisions
- provide practical testing instructions
- identify which actions are safe versus production-sensitive

However, do not simplify the underlying implementation at the expense of good architecture.

The goal is production-quality code with clear explanations.

---

# Core Principle

Understand the existing system before changing it.

Reuse before rebuilding.

Make the smallest safe change.

Protect production data and external systems.

Validate your work.

Ask before performing risky or irreversible actions.