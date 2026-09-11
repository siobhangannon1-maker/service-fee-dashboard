import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowStartError, workflowStartAlert, workflowStartUnconfirmed } from './workflow-start-error';
for(const [status,error] of [[409,'Praktika connection required. Please connect to Praktika and try again.'],[403,'An active login is required.'],[503,'Workflow continuation is not configured.'],[400,'Invalid workflow options.']] as const) {
  test(`safe ${status} prerequisite message reaches alert`,()=>assert.equal(workflowStartAlert(new WorkflowStartError({error,reconnectRequired:status===409})),error));
}
test('unknown server text and native timeout never reach alert',()=>{
  for(const error of [new Error('signal timed out SECRET'),new WorkflowStartError({error:'raw database SECRET'}),new DOMException('SECRET','AbortError')])assert.equal(workflowStartAlert(error),workflowStartUnconfirmed);
});
test('reservation ambiguity retains reconciliation message',()=>assert.equal(workflowStartAlert(new WorkflowStartError({stage:'workflow_reservation',error:'Workflow start could not be confirmed. Please try Complete Workflow again; any existing intent will be reconciled.'})),workflowStartUnconfirmed));
