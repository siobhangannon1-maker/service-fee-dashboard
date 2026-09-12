import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {PraktikaOwnershipRejected} from './helper-lease';
const helper='scripts/refresh-praktika-session.ts';
function extract(names:string[]) {
 const source=readFileSync(helper,'utf8');
 const ast=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true);
 return ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text||'')).map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
for(const ready of [false,true])test(`browser startup ready=${ready} controls the sole Connected promotion`,async()=>{
 const writes:unknown[]=[]; let checks=0;
 const scope={browserReady:false,operationalThisGeneration:false,loginTransition:true,verificationRequested:true,shuttingDown:false,
 checkBrowserAvailability:async()=>ready,assertOwned:async()=>{checks++;},safePageUrl:async()=>'/fixture',nowIso:()=> 'fixture-time',
 ownedWrite:async(action:string,values:unknown)=>writes.push({action,values})};
 const mark=runInNewContext(extract(['markBrowserReady'])+'\nmarkBrowserReady',scope);
 assert.equal(await mark({isClosed:()=>false}),ready);
 assert.equal(scope.browserReady,ready);assert.equal(writes.length,ready?1:0);assert.equal(checks,ready?1:0);
 assert.doesNotMatch(JSON.stringify(writes),/authenticated_at|experimental_auth/);
});
test('superseded owner cannot mark browser connected',async()=>{
 const mark=runInNewContext(extract(['markBrowserReady'])+'\nmarkBrowserReady',{
 browserReady:false,shuttingDown:false,checkBrowserAvailability:async()=>true,
 assertOwned:async()=>{throw new PraktikaOwnershipRejected();},ownedWrite:async()=>assert.fail('must not promote'),
 });
 await assert.rejects(mark({isClosed:()=>false}),PraktikaOwnershipRejected);
});
for(const kind of ['mfa','password','unknown'])test(kind+' browser state clears operational readiness',async()=>{
 let written:any;
 const scope={browserReady:true,shuttingDown:false,isBrowserUiLoggedIn:async()=>false,
 pageHasMfaInput:async()=>kind==='mfa',pageHasVisiblePasswordInput:async()=>kind==='password',pageIsLoginUrl:()=>false,pageIsLogoutUrl:()=>false,
 looksLikeLoggedOutText:()=>false,safePageUrl:async()=>'/fixture',updateSession:async(v:unknown)=>{written=v;}};
 const check=runInNewContext(extract(['checkBrowserAvailability'])+'\ncheckBrowserAvailability',scope);
 assert.equal(await check({isClosed:()=>false,locator:()=>({innerText:async()=>''})}),false);
 assert.equal(scope.browserReady,false);
 assert.equal(written.status,kind==='mfa'?'waiting_for_mfa':kind==='password'?'waiting_for_credentials':'refreshing');
});
for(const ready of [false,true])test(`cookie save/capture never promotes connected (ready=${ready})`,async()=>{
 const writes:unknown[]=[];let captures=0;
 const save=runInNewContext(extract(['saveCookies'])+'\nsaveCookies',{
 buildCookieHeader:async()=>({cookieHeader:'synthetic',hasPhpSession:true,hasUat:true}),getSession:async()=>({status:'refreshing',scope:'user'}),
 nowIso:()=> 'fixture-time',clearTemporaryCredentialsAfterSuccess:async(v:unknown)=>writes.push(v),safePageUrl:async()=>'/fixture',
 KEEP_BROWSER_OPEN:true,browserReady:ready,cookieSnapshots:{capture(){captures++;}},shuttingDown:false,
 assertOwned:async()=>{},PRAKTIKA_BASE_URL:'https://fixture.invalid',helperInstanceId:'owner',
 });
 await save({cookies:async()=>[]},{});
 assert.equal(captures,ready?1:0);assert.doesNotMatch(JSON.stringify(writes),/"status"|authenticated_at/);
});
test('production runtime has no GST/scheduler state machine, and background fetch cannot follow redirects',()=>{
 const source=readFileSync(helper,'utf8');
 assert.doesNotMatch(source,/authentication-probe|pollSchedulerDiagnostic|startPraktikaAuthenticationRenewal|record_praktika_experimental_auth|ensureAuthenticated/);
 assert.equal((source.match(/status: "connected"/g)||[]).length,1);
 assert.match(extract(['performRealBrowserActivity']),/redirect: "error"/);
 for(const file of ['scripts/praktika-helper-job-processor.ts','lib/praktika/hybrid-session-store.ts','lib/praktika/praktika-request.ts'])
  assert.doesNotMatch(readFileSync(file,'utf8'),/status: "connected"/);
});
for(const ready of [false,true])test(`snapshot injection still requires browser readiness=${ready}`,async()=>{
 const source=readFileSync(helper,'utf8');const a=source.indexOf('    if (isWarmRestoration && !snapshotRestoreAttempted');const b=source.indexOf('    await updateSession({',a);
 const code=ts.transpileModule('async function restore(){'+source.slice(a,b)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let injected=0, checked=0, saved=0;
 const query={select(){return this;},eq(){return this;},abortSignal(){return this;},maybeSingle:async()=>({data:{source_instance_id:'old'},error:null})};
 const scope={isWarmRestoration:true,snapshotRestoreAttempted:false,pageHasMfaInput:async()=>false,pageIsLoginUrl:()=>true,pageHasVisiblePasswordInput:async()=>false,
 context:{cookies:async()=>[],addCookies:async()=>{injected++;}},assertOwned:async()=>{},supabase:{from:()=>query},session:{id:'session'},helperInstanceId:'new',AbortSignal,
 cookieSnapshots:{load:(owner:string)=>{assert.equal(owner,'old');return {cookies:[]};}},console:{log(){}},shuttingDown:false,page:{goto:async()=>{}},PRAKTIKA_BASE_URL:'https://fixture.invalid',
 markBrowserReady:async()=>{assert.equal(injected,1);checked++;return ready;},saveCookies:async()=>{saved++;},KEEP_BROWSER_OPEN:true,keepBrowserOpenForever:async()=>{}};
 const restore=runInNewContext(code+'\nrestore',scope);await restore();await restore();
 assert.equal(injected,1);assert.equal(checked,1);assert.equal(saved,ready?1:0);
});
