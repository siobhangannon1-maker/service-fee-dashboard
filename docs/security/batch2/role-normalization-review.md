# Role authorization review — Batch 2 PAUSED

Latest operator-provided status results: 35 auth users, 35 with exactly one status
row, zero missing/duplicate/null statuses. Billing eligibility from either role
source includes 3 inactive users; canonical eligibility includes 2. No account
has been reactivated or modified. No SQL executed by this agent.

Role disagreements remain 16, with no duplicate/multiple canonical assignments:

| profiles.role | user_roles.role | Count |
|---|---|---|
| admin | super_admin | 1 |
| provider_readonly | typist | 1 |
| staff | admin | 7 |
| staff | billing_staff | 2 |
| staff | practice_manager | 1 |
| staff | provider_readonly | 3 |
| staff | typist | 1 |

The four profile-only Billing cases are the last two rows. Each requires an
individual administrator decision about legitimate Billing duties. Do not infer
that profiles wins or promote anyone automatically. The role sources represent
different generations/granularity; identical values are NOT required.

## Deployment prerequisites

- All intended Billing users have an approved canonical user_roles role.
- Each of the four profile-only Billing cases has been individually reviewed.
- No user who legitimately requires Billing would lose intended access.
- RLS requires exactly one user_status row with is_active IS TRUE. Missing,
  duplicate, NULL and inactive status deny. Roles never override inactive status.
- Existing external review, isolated testing and explicit deployment approval
  remain required. Batch 2 stays paused pending the individual role decisions.

Neither sources_disagree=0 nor billing_permission_only_in_profile=0 is a gate.
Reviewed differences can remain intentionally. No automatic copying between
profiles and user_roles, no profile mirroring requirement, no automatic status
creation/reactivation and no changes to the three canonical-only accounts.

## Read-only review tools

role-normalization-aggregates.sql remains descriptive: counts need not reach zero.
status-role-population-preflight.sql counts both eligibility sources to avoid
omitting profile-only cases. admin-role-review.sql is private operator review
(UUIDs and roles only); keep individual results private. No identities are in
this document. Any later targeted role update needs separate approval and
expected-old-value checks, not bulk normalization.

The proposed migration now uses strict status checks. Application Batch 1 and
its compatibility behavior are untouched. The existing review API's profile-role
union remains a separate server-side authorization issue, not silently changed
by this design.
