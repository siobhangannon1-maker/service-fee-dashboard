import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=readFileSync("components/report-writing/ResumeMedirefButton.tsx","utf8");

test("eligibility is checked automatically",()=>{
  assert.match(source,/useEffect\(\(\)=>\{/);
  assert.match(source,/\/api\/report-writing\/resume-mediref\?draftId=/);
  assert.match(source,/cache:"no-store"/);
});

test("ineligible or uncertain drafts render nothing",()=>{
  assert.match(source,/setEligible\(response\.ok&&result\.eligible===true\)/);
  assert.match(source,/if\(!loaded\|\|!eligible\)return null/);
});

test("confirmation promises no Praktika replay",()=>{
  assert.match(source,/This will not upload the letter to Praktika or update the Praktika icon again\./);
});
