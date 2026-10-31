import {sql} from 'drizzle-orm';
import type {AnyDb} from './client.ts';
/** Serialize HR writes, source edits and booking; never shares Sapo or money locks. */
export async function payrollLock(db:AnyDb){await db.execute(sql`select pg_advisory_xact_lock(170332,3101)`);}
