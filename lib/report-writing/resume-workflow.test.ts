import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync("lib/praktika/helper-jobs.ts", "utf8");
const route = readFileSync("app/api/report-writing/resume-workflow/route.ts", "utf8");
const button = readFileSync("components/report-writing/ResumeWorkflowButton.tsx", "utf8");
const processor = readFileSync("scripts/praktika-helper-job-processor.ts", "utf8");

test("Complete Workflow periodontal reads are deterministic continuation children", () => {
  assert.match(helper, /DURABLE_WORKFLOW_READS/);
  assert.match(helper, /periodontal_chart_patient_perio_exam_ids/);
  assert.match(helper, /periodontal_chart_perio_exams/);
  assert.match(helper, /continuationChildId\(workflow\.intentId, jobType\)/);
  assert.match(helper, /continuationId: workflow\.intentId/);
});

test("failed deterministic reads are never silently rearmed by helper creation", () => {
  assert.match(helper, /Never silently re-arm a failed deterministic child/);

  const start = helper.indexOf(
    'if (error?.code === "23505" && id && workflow)',
  );
  assert.ok(start >= 0);

  const end = helper.indexOf("if (error || !data)", start);
  assert.ok(end > start);

  const duplicateBranch = helper.slice(start, end);

  assert.match(duplicateBranch, /return existing\.data/);
  assert.doesNotMatch(duplicateBranch, /\.update\(/);
});

test("Resume Workflow is limited to exhausted periodontal reads after confirmed Praktika work", () => {
  assert.match(route, /intent\.response\?\.issue !== "periodontal_unavailable"/);
  assert.match(route, /upload\?\.status !== "completed"/);
  assert.match(route, /isConfirmedPraktikaUpload\(upload\.response\)/);
  assert.match(route, /workflow_icon_update_status === "completed"/);
  assert.match(route, /mediref_attempt_exists/);
});

test("Resume Workflow re-arms only exact failed read IDs and keeps the parent at mediref", () => {
  assert.match(route, /\.in\("id", state\.readIds\)/);
  assert.match(route, /\.eq\("status", "failed"\)/);
  assert.match(route, /response: \{ stage: "mediref"/);
  assert.doesNotMatch(route, /upload_report_to_praktika"\)\.update/);
});

test("Resume Workflow UI is fail closed and automatic eligibility is server driven", () => {
  assert.match(button, /useEffect/);
  assert.match(button, /\/api\/report-writing\/resume-workflow\?draftId=/);
  assert.match(button, /response\.ok && result\.eligible === true/);
  assert.match(button, /if \(!loaded \|\| !eligible\) return null/);
  assert.match(button, /does not re-upload the letter to Praktika/);
});


test("pre-dispatch authentication failures are parked with backoff without consuming an attempt", () => {
  assert.match(processor, /attempts: Math\.max\(0, job\.attempts - 1\)/);
  assert.match(processor, /available_at: new Date\(Date\.now\(\) \+ 60_000\)/);
});

test("transient periodontal read failures get extended automatic recovery before becoming terminal", () => {
  assert.match(processor, /\["http_307", "transport_failure"\]/);
  assert.match(processor, /const maxAttempts = transientReadFailure \? 10 : 3/);
});
