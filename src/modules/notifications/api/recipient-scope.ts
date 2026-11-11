import type { StaffEnv } from '../../staff/api/auth-routes.ts';

export type NotificationRef = { eventType: string; url?: string; data?: Record<string, unknown>; actorId?: string | null };
export interface NotificationScope {
  people: { id: string; role: string; canApprove: boolean }[];
  recipients(n: NotificationRef, ids: readonly string[]): Promise<string[]>;
}
/** App composition supplies document authorization; notifications must not depend on business modules. */
export const notificationRecipientHooks: {
  createScope?: (db: StaffEnv['db']) => Promise<NotificationScope>;
} = {};

export function notificationScope(db: StaffEnv['db']): Promise<NotificationScope> {
  if (!notificationRecipientHooks.createScope) throw new Error('Notification recipient authorization is not configured.');
  return notificationRecipientHooks.createScope(db);
}
