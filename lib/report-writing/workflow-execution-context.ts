import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditActor } from './audit';
// Only the service-authenticated continuation route enters this context.
// No browser-supplied header or draft attribution can set an actor here.
export type WorkflowExecution = { intentId: string; actor: AuditActor };
const execution = new AsyncLocalStorage<WorkflowExecution>();
export const currentWorkflowExecution = () => execution.getStore();
export const withWorkflowExecution = <T>(value: WorkflowExecution, run: () => Promise<T>) => execution.run(value, run);
