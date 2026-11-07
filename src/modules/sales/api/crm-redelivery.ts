import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { AnyDb } from "../../../core/db/client.ts";
import { posReturnLines, posReturns } from "../return-schema.ts";
import { redeliveryOffsets } from "../domain/crm-return-purpose.ts";
export async function redeliveryByLine(db: AnyDb, orderIds: readonly string[]) {
  const result = new Map<
    string,
    { qty: number; packed: number; issued: number }
  >();
  if (!orderIds.length) return result;
  const rows = await db
    .select({
      lineId: posReturnLines.orderLineId,
      qty: posReturnLines.receivedQty,
      snapshot: posReturns.sourceSnapshot,
    })
    .from(posReturnLines)
    .innerJoin(posReturns, eq(posReturns.id, posReturnLines.returnId))
    .where(
      and(
        inArray(posReturns.orderId, [...orderIds]),
        eq(posReturns.source, "crm"),
        isNotNull(posReturns.receivedAt),
        sql`${posReturns.sourceSnapshot}::jsonb->>'returnPurpose' = 'redelivery'`,
      ),
    );
  for (const row of rows) {
    const prior = result.get(row.lineId) ?? { qty: 0, packed: 0, issued: 0 },
      offsets = redeliveryOffsets(row.snapshot, row.lineId);
    prior.qty += row.qty;
    prior.packed += Math.min(row.qty, offsets.packed);
    prior.issued += Math.min(row.qty, offsets.issued);
    result.set(row.lineId, prior);
  }
  return result;
}
