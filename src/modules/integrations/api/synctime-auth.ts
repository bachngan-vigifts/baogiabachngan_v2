import { eq } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { AppError } from '../../../core/errors.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { countAttempt } from '../../staff/repo/auth-repo.ts';
import { synctimeConnections } from '../schema.ts';

export async function authorizeSynctime(req: Request, db: AnyDb): Promise<void> {
  const token = /^Bearer (stwh_[a-f0-9]{64})$/.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) throw new AppError(401, 'Mã webhook không hợp lệ.');
  const [config] = await db.select().from(synctimeConnections).where(eq(synctimeConnections.id, 'synctime')).limit(1);
  const got = sha256Hex(token), want = config?.tokenHash || '0'.repeat(64);
  let diff = 0; for (let i = 0; i < 64; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  if (!config || diff) throw new AppError(401, 'Mã webhook không hợp lệ.');
  const now = Math.floor(Date.now() / 1000);
  if (await countAttempt(db, 'synctime-webhook:' + Math.floor(now / 60), now) > 120)
    throw new AppError(429, 'Nhận quá nhiều gói webhook. Vui lòng gửi lại sau một phút.');
}
