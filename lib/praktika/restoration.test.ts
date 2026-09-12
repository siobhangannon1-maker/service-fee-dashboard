import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const file='scripts/refresh-praktika-session.ts';
const source=readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
const names=['praktikaPagePath','pageIsLoginUrl','pageIsLogoutUrl','looksLikeLoggedOutText','pageHasVisiblePasswordInput','pageHasMfaInput','isBrowserUiLoggedIn'];
const code=ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text||'')).map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const api=runInNewContext(code+'\n({isBrowserUiLoggedIn,pageHasMfaInput,pageHasVisiblePasswordInput})',{URL,PRAKTIKA_BASE_URL:'https://praktika.praktika.net.au',dismissBlockingDialogs:async()=>{}});
function page(path:string,text:string,visible=false,exists=false){return {url:()=>`https://praktika.praktika.net.au${path}`,locator:()=>({innerText:async()=>text,count:async()=>exists?1:0,nth:()=>({isVisible:async()=>visible})})};}
test('Logout control does not reject plausible restored application; exact login does',async()=>{
 assert.equal(await api.isBrowserUiLoggedIn(page('/v2/scheduler','Logout')),true);
 assert.equal(await api.isBrowserUiLoggedIn(page('/v2/login','')),false);
 assert.equal(await api.isBrowserUiLoggedIn(page('/v2/scheduler?next=/v2/login','Logout')),true);
 assert.equal(await api.isBrowserUiLoggedIn(page('/intermediate','')),false);
});
test('hidden controls do not count as login or MFA; visible challenges do',async()=>{
 assert.equal(await api.isBrowserUiLoggedIn(page('/v2/scheduler','Logout',false,true)),true);
 assert.equal(await api.pageHasVisiblePasswordInput(page('/v2/login','',true,true)),true);
 assert.equal(await api.pageHasMfaInput(page('/v2/login','',true,true)),true);
 assert.equal(await api.pageHasMfaInput(page('/v2/login','Verification code')),true);
 assert.equal(await api.pageHasMfaInput(page('/v2/login','',false,true)),false);
});
test('startup preserves challenges at deadline and only probes through the existing verifier',()=>{
 assert.match(source,/if \(await hasExistingBrowserSession\(page\)\)[\s\S]*await markBrowserReady\(page\)/);
 assert.match(source,/if \(\["waiting_for_credentials", "waiting_for_mfa"\]\.includes\(finalSession.status\)\) return;/);
 assert.match(source,/throw new Error\("Timed out waiting for Praktika login\/MFA completion\."\)/);
 assert.match(source,/`user_\$\{session.app_user_id \|\| session.id\}`/);
 assert.match(source,/launchPersistentContext\(\s*path.join\(PROFILE_ROOT, profileName\)/);
 assert.match(source,/context.addCookies\(snapshot.cookies\)/);
 assert.match(source,/isWarmRestoration && !snapshotRestoreAttempted/);
});
