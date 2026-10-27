import type { StaffEnv } from '../../staff/api/auth-routes.ts';
/** App wiring keeps inventory independent of the task module. Run after the document transaction commits. */
export const transferTaskHooks: { afterCommit?: (env: StaffEnv, id: string, actorId: string) => Promise<void> } = {};
export async function transferTasksChanged(env: StaffEnv, id: string, actorId: string) {
  const job = Promise.resolve().then(() => transferTaskHooks.afterCommit?.(env, id, actorId)).catch(e => console.error('transfer task sync failed', e instanceof Error ? e.message : e));
  if (env.waitUntil) env.waitUntil(job); else await job;
}
