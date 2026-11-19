import {chatMembers,chatMessages} from '../modules/chat/schema.ts';
import {canViewSepayDebits} from '../modules/sales/domain/sepay-page.ts';
import {warehouseWorkParts} from '../modules/warehouse-workspace/schema.ts';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { employees, positions, positionPermissions } from '../modules/staff/schema.ts';
import { can, canApprove, scopeOf } from '../modules/staff/domain/permissions.ts';
import { salesOrders, salesContracts, packingSlips, deliveries } from '../modules/sales/schema.ts';
import { quotations } from '../modules/quotes/schema.ts';
import { incomingShipments } from '../modules/suppliers/schema.ts';
import { stockTransfers, warehouseSellers } from '../modules/inventory/schema.ts';
import { tasks } from '../modules/tasks/schema.ts';
import { isTeam, TEAM_PERMISSION, TEAM_PERMISSION_EXCLUDED } from '../modules/tasks/domain/task-config.ts';
import { posOrderStoreScope, posWebOrderStoreScope, posStoreScopeFor } from '../modules/sales/api/pos-access.ts';
import { webStoreOrders, posShifts, posRegisters } from '../modules/sales/pos-schema.ts';
import { warehouses } from '../modules/catalog/schema.ts';
import { loadTransferApprovalDirectory } from '../modules/inventory/api/transfer-approvers.ts';

import type { NotificationRef } from '../modules/notifications/api/recipient-scope.ts';
type Person = typeof employees.$inferSelect & { positionName: string | null; departmentId: string | null; dataScope: string | null; perms: string[]; approver: boolean };
type Ref = { kind: string; id: string };
const refOf = (n: NotificationRef): Ref | null => {
  const match = /#\/(orders|contracts|quotes|packing|deliveries|transfers|purchases|tasks|chat)\/([^/?#]+)/.exec(n.url ?? '');
  if (match) {
    try { return { kind: match[1]!, id: decodeURIComponent(match[2]!) }; }
    catch { return { kind: 'invalid', id: '' }; }
  }
  const hash = (n.url ?? '').split('#')[1] ?? '';
  if (hash.startsWith('/cash?')) {
    const params = new URLSearchParams(hash.split('?')[1]);
    if (params.get('drawerId')) return { kind: 'cash', id: params.get('drawerId')! };
    if (params.get('returnOrderId')) return { kind: 'cash-order', id: params.get('returnOrderId')! };
  }
  return null;
};

/** Request-local directory: never cache permissions across requests or permission changes. */
export async function createNotificationScope(db: StaffEnv['db']) {
  const [rows, grants, sellers] = await Promise.all([
    db.select({ member: employees, position: positions }).from(employees).leftJoin(positions, eq(positions.id, employees.positionId))
      .where(and(eq(employees.active, true), isNull(employees.deletedAt))),
    db.select().from(positionPermissions), db.select().from(warehouseSellers),
  ]);
  const people: Person[] = rows.map(({ member: m, position: p }) => ({ ...m, positionName: p?.name ?? null,
    departmentId: p?.departmentId ?? null, dataScope: p?.dataScope ?? null,
    perms: grants.filter(g => g.positionId === m.positionId).map(g => g.permission), approver: m.canApprove }));
  const byId = new Map(people.map(m => [m.id, m]));
  const cache = new Map<string, Promise<Set<string>>>();
  const storeScopes = new Map<string, ReturnType<typeof posStoreScopeFor>>();
  const related = (m: Person, owners: readonly (string | null)[]) => m.role === 'manager' || owners.includes(m.id) || owners.some(id => {
    const owner = id ? byId.get(id) : null;
    if (!owner || m.role !== 'employee') return false;
    const scope = scopeOf(m);
    return scope === 'all' || scope === 'position' && !!m.positionId && m.positionId === owner.positionId
      || scope === 'department' && !!m.departmentId && m.departmentId === owner.departmentId;
  });
  // Read-all is not an operational assignment. Once configured, use the document warehouse,
  // including for the standard Warehouse role. Before configuration only the Warehouse team is global.
  const warehouseMember = (m: Person, ids: readonly (string | null)[]) => m.role === 'manager' || (!sellers.length && m.positionId === 'warehouse')
    || ids.some(id => !!id && sellers.some(s => s.warehouseId === id && s.positionId === m.positionId));
  const page = (m: Person, ...keys: string[]) => keys.some(k => can(m, k));
  const matching = async (kind: string, id: string, event: string): Promise<Set<string>> => {
    const key = `${kind}:${id}:${event}`;
    if (!cache.has(key)) cache.set(key, resolve(kind, id, event));
    return cache.get(key)!;
  };
  async function resolve(kind: string, id: string, event: string): Promise<Set<string>> {
    if (kind === 'invalid') return new Set();
    if (kind === 'chat') {
      const messageId=event.startsWith('chat_message:')?event.slice('chat_message:'.length):'';
      if(!messageId)return new Set();
      const members=await db.select({id:chatMembers.memberId}).from(chatMembers).innerJoin(chatMessages,and(eq(chatMessages.conversationId,chatMembers.conversationId),eq(chatMessages.id,messageId),isNull(chatMessages.recalledAt))).where(eq(chatMembers.conversationId,id));
      return new Set(members.filter(r=>{const m=byId.get(r.id);return !!m && ['manager','employee'].includes(m.role);}).map(r=>r.id));
    }
    if (kind === 'tasks') {
      const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      if (!t) return new Set();
      let members = people.filter(m => {
        if (m.role === 'manager' || t.assigneeId === m.id || t.createdBy === m.id) return true;
        if (m.role !== 'employee' || t.assigneeId || !t.assigneePosition) return false;
        const team = t.assigneePosition;
        return m.positionId === team || isTeam(team) && !!TEAM_PERMISSION[team] && can(m, TEAM_PERMISSION[team]!)
          && !TEAM_PERMISSION_EXCLUDED[team]?.includes(m.positionId ?? '');
      });
      // An automatic task must not bypass the source document's recipients/store boundary.
      const [part]=t.autoKey?[]:await db.select({parent:warehouseWorkParts.assignmentId}).from(warehouseWorkParts).where(eq(warehouseWorkParts.taskId,t.id)).limit(1);
      const [sourceTask]=part?await db.select().from(tasks).where(eq(tasks.id,part.parent)):[];
      const sourceKey=sourceTask?.autoKey??t.autoKey;
      const warehouseAssigned=t.assigneePosition==='warehouse'||!!t.assigneeId&&byId.get(t.assigneeId)?.positionId==='warehouse';
      const linked = refOf({ eventType: event, url: t.link });
      const fallback = t.sourceId && ['order', 'contract', 'delivery', 'receivable'].includes(t.source) ? { kind: 'orders', id: t.sourceId } : null;
      const ref = linked ?? fallback;
      if (ref?.kind === 'tasks') return new Set(); // task links cannot recursively grant document access
      if (ref) {
        const sourceEvent = sourceKey?.startsWith('transfer-approve:') ? 'transfer_pending'
          : sourceKey?.startsWith('transfer-receive:') ? 'transfer_shipped'
          : sourceKey?.startsWith('transfer-move:') ? 'transfer_move'
          : warehouseAssigned ? 'warehouse_task' : event;
        const allowed = await matching(ref.kind, ref.id, sourceEvent);
        members = members.filter(m => allowed.has(m.id));
      }
      return new Set(members.map(m => m.id));
    }
    if (kind === 'cash-order') {
      const members = people.filter(m => page(m, 'page.cash', 'pos.sell') && canApprove(m));
      if (!members.length) return new Set();
      const allowed = await db.select({ id: employees.id }).from(employees).innerJoin(salesOrders, eq(salesOrders.id, id))
        .where(or(...members.map(m => and(eq(employees.id, m.id), posOrderStoreScope(m)))));
      return new Set(allowed.map(m => m.id));
    }
    if (kind === 'cash') {
      const allowed = await Promise.all(people.filter(m => page(m, 'page.cash', 'pos.sell') && (!/^(cash_entry_pending|pos_return_pending|pos_opening_difference|pos_shift_difference)$/.test(event) || canApprove(m))).map(async m => {
        const key = m.role + ':' + (m.positionId ?? '');
        if (!storeScopes.has(key)) storeScopes.set(key, posStoreScopeFor(db, m));
        const scope = await storeScopes.get(key)!;
        return !scope || scope.scope.drawers.includes(id) ? m.id : null;
      }));
      return new Set(allowed.filter((id): id is string => id !== null));
    }
    if (kind === 'packing') {
      const [s] = await db.select().from(packingSlips).where(eq(packingSlips.id, id)).limit(1);
      return s ? matching('orders', s.orderId, event === 'packing_done' ? event : 'warehouse_task') : new Set();
    }
    if (kind === 'deliveries') {
      const [d] = await db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
      return d ? matching('orders', d.orderId, event) : new Set();
    }
    if (kind === 'orders' || kind === 'contracts') {
      if (id.startsWith('web:')) {
        const members = people.filter(m => page(m, 'page.orders', 'page.contracts', 'page.receivables') &&
          (m.role === 'manager' || m.positionId === 'accounting' || scopeOf(m) === 'all' || m.positionId === 'sales-lock' || m.positionId === 'sales-ml'));
        if (!members.length) return new Set();
        const allowed = await db.select({ id: employees.id }).from(employees).innerJoin(webStoreOrders, eq(webStoreOrders.id, id.slice(4)))
          .where(or(...members.map(m => and(eq(employees.id, m.id), posWebOrderStoreScope(m)))));
        return new Set(allowed.map(m => m.id));
      }
      let [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
      if (!o && kind === 'contracts') {
        const [k] = await db.select().from(salesContracts).where(eq(salesContracts.id, id)).limit(1);
        if (k) [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, k.orderId)).limit(1);
      }
      if (!o) return new Set();
      let warehouseId = o.warehouseId;
      if (!warehouseId && o.channel === 'pos' && o.shiftId) {
        const [counter] = await db.select({ warehouseId: posRegisters.warehouseId }).from(posShifts)
          .innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId)).where(eq(posShifts.id, o.shiftId)).limit(1);
        warehouseId = counter?.warehouseId ?? null;
      }
      const warehouse = event === 'warehouse_task';
      const approval = /^(order_pending|contract_pending|contract_liquidation_requested|crm_return_pending)$/.test(event);
      const members = people.filter(m => m.role === 'manager' || m.role === 'employee' && (warehouse
        ? page(m, 'page.packing') && warehouseMember(m, [warehouseId])
        : page(m, 'page.orders', 'page.contracts', 'page.receivables') && (!approval || canApprove(m)) && (m.positionId === 'accounting' || related(m, [o!.ownerId, o!.createdBy, o!.invoiceRequestedBy]))));
      if (!members.length) return new Set();
      // Reuse the hard store boundary used by order reads (including delegated approvers).
      const allowed = await db.select({ id: employees.id }).from(employees).innerJoin(salesOrders, eq(salesOrders.id, o.id))
        .where(or(...members.map(m => and(eq(employees.id, m.id), posOrderStoreScope(m)))));
      return new Set(allowed.map(m => m.id));
    }
    if (kind === 'quotes') {
      const [q] = await db.select().from(quotations).where(eq(quotations.id, id)).limit(1);
      return new Set(q ? people.filter(m => page(m, 'page.quotes') && (event !== 'quote_pending' || canApprove(m)) && related(m, [q.assigneeId, q.creatorId])).map(m => m.id) : []);
    }
    if (kind === 'purchases') {
      const [p] = await db.select().from(incomingShipments).where(eq(incomingShipments.id, id)).limit(1);
      if (!p) return new Set();
      if (event === 'warehouse_task') {
        const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(or(eq(warehouses.id, p.warehouse), eq(warehouses.name, p.warehouse))).limit(1);
        return new Set(people.filter(m => page(m, 'purchases.receive') && warehouseMember(m, [w?.id ?? null])).map(m => m.id));
      }
      return new Set(people.filter(m => page(m, 'page.purchases') && (event !== 'purchase_pending' || canApprove(m)) && related(m, [p.createdBy])).map(m => m.id));
    }
    if (kind === 'transfers') {
      const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id)).limit(1);
      if (!t) return new Set();
      const approvalIds = /pending|reminder/.test(event) ? new Set((await loadTransferApprovalDirectory(db))(t, true)) : null;
      const privateWarehouses = approvalIds ? [] : await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.stockPrivate, true), inArray(warehouses.id, [t.fromWarehouseId, t.toWarehouseId])));
      return new Set(people.filter(m => {
        if (m.role === 'manager') return true;
        if (m.role !== 'employee') return false;
        if (privateWarehouses.some(w => !sellers.some(s => s.warehouseId === w.id && s.positionId === m.positionId))) return false;
        if (approvalIds) return approvalIds.has(m.id);
        if (event === 'transfer_shipped') return sellers.some(s => s.warehouseId === t.toWarehouseId && s.positionId === m.positionId);
        if (m.id === t.requestedBy) return true;
        const assignedSource = sellers.some(s => s.warehouseId === t.fromWarehouseId && s.positionId === m.positionId);
        return (page(m, 'stock.transfer') || assignedSource) && warehouseMember(m, [t.fromWarehouseId]);
      }).map(m => m.id));
    }
    return new Set(people.map(m => m.id));
  }
  return {
    people,
    async recipients(n: NotificationRef, ids: readonly string[]) {
      if(n.eventType === 'sepay_bank_movement')return ids.filter(id=>{const m=byId.get(id);return !!m && canViewSepayDebits(m);});
      const ref = refOf(n);
      if(n.eventType==='chat_message'){
        const messageId=n.data?.messageId;
        if(ref?.kind!=='chat'||typeof messageId!=='string'||!messageId||messageId.length>200||n.data?.conversationId!==ref.id)return [];
        const allowed=await matching('chat',ref.id,'chat_message:'+messageId);
        return ids.filter(id=>byId.has(id)&&allowed.has(id));
      }
      if (!ref) return ids.filter(id => byId.has(id));
      const allowed = await matching(ref.kind, ref.id, n.eventType);
      return ids.filter(id => byId.has(id) && allowed.has(id));
    },
  };
}
