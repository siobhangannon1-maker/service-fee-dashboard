import assert from 'node:assert/strict';
import {test} from 'node:test';
import {derivePraktikaConnection} from './authentication';
import {connectionExpiry, currentStatus} from './use-status-expiry';
const now = Date.now();
const live = {status:'connected', helper_instance_id:'owner', helper_heartbeat_at:new Date(now).toISOString()};
function client(row = live) {
  return {...derivePraktikaConnection(row, now), storedStatus:row.status, helperHeartbeatAt:row.helper_heartbeat_at};
}
test('no session is not connected; genuinely unresolved request is loading',()=>{
 assert.equal(currentStatus(null,now),'loading');
 assert.equal(currentStatus({status:'not_started',connected:false,helperAlive:false},now),'not_started');
});
test('cached browser availability expires solely at heartbeat deadline',()=>{
 const row = {...client(),authenticatedAt:new Date(0).toISOString(),authenticationExpiresAt:new Date(0).toISOString(),experimentalEligible:true,experimentalEligibilityExpiresAt:new Date(0).toISOString()};
 assert.equal(connectionExpiry(row,now),now+90000);
 assert.equal(currentStatus(row,now),'connected');
 assert.equal(currentStatus(row,now+90000),'not_started');
});
test('startup stays connecting and expires if heartbeats stop',()=>{
 const row=client({...live,status:'refreshing'});
 assert.equal(currentStatus(row,now),'refreshing');
 assert.equal(row.connected,false);
 assert.equal(currentStatus(row,now+90000),'not_started');
});
for(const status of ['waiting_for_credentials','waiting_for_mfa'])test(status+' stays actionable',()=>{
 assert.equal(currentStatus(client({...live,status}),now),status);
});
test('old proof-driven API states cannot manufacture connected',()=>{
 for(const status of ['checking_connection','rechecking_connection','idle','error'])
  assert.equal(currentStatus({...client(),status},now),'not_started');
 assert.equal(currentStatus({...client(),storedStatus:'refreshing'},now),'not_started');
});

test("popup uses browser startup/heartbeat and preserves credential and MFA controls", async () => {
  const { chromium } = await import("playwright"); const { build } = await import("esbuild");
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Popup from './components/report-writing/PraktikaToolsPopup'; createRoot(document.getElementById('root')).render(<Popup open={true}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.clock.install();
    let status = "refreshing";
    let helperAlive = true;
    await page.route("**/*", async route => {
      if (new URL(route.request().url()).pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      assert.equal(new URL(route.request().url()).search, "?scope=user");
      const now = await page.evaluate(() => Date.now());
      return route.fulfill({ json: { status, storedStatus: status === "checking_connection" ? "connected" : status, connected: status === "connected", helperAlive, helperHeartbeatAt: new Date(now).toISOString(), authenticatedAt: null } });
    });
    await page.goto("http://praktika-ui.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Praktika: Connecting", { exact: true }).waitFor();
    status = "connected";
    for (let n = 0; n < 7; n++) { await page.clock.runFor(5000); await page.waitForTimeout(20); }
    await page.getByText("Praktika: Connected", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).count(), 0);
    helperAlive = false;
    await page.clock.runFor(5000); await page.waitForTimeout(20);
    await page.getByText("Praktika: Not connected", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
    helperAlive = true;
    for (const state of ["not_started", "error", "waiting_for_credentials", "waiting_for_mfa", "connected"]) {
      status = state; await page.clock.runFor(5000); await page.waitForTimeout(20);
      if (state === "connected") await page.getByText("Praktika: Connected", { exact: true }).waitFor();
      else if (state === "waiting_for_credentials") assert.equal(await page.locator('input[type="password"]').isVisible(), true);
      else if (state === "waiting_for_mfa") await page.getByText("Praktika: MFA required", { exact: true }).waitFor();
      else assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
    }
  } finally { await browser.close(); }
});
