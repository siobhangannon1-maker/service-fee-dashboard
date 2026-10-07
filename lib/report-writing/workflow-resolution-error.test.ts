import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveResolution} from './workflow-resolution';
test('technical snapshot failure is distinct from a successful ineligible preview',()=>{
 const route=readFileSync('app/api/report-writing/resolve-workflow/route.ts','utf8');
 assert.match(route,/The workflow check failed because of a technical error/);
 assert.match(route,/status:error instanceof ApiAuthorizationError \? error.status : 503/);
 assert.match(route,/if\(!confirm \|\| input.review===true\) return NextResponse.json\(\{success:true/);
 const blocked=deriveResolution({draft:{id:'synthetic',status:'uploaded_to_praktika'},events:[],fingerprint:'unchanged',letterFingerprint:'unchanged',executionSafe:false,evidence:{uploads:[],icons:[],mediref:[],livePraktikaActors:new Set<string>(),liveMediref:false}});
 assert.equal(blocked.eligible,false);assert.equal(blocked.action,null);
 assert.equal(blocked.reason,'Historical requirements could not be established. Further review is required.');
});
