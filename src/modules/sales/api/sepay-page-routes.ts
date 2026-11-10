import {sepayManualAccountApproved} from './sepay-manual-account.ts';
import {validWebSepay} from './web-sepay-evidence.ts';
import {previewNearbySepay} from './sepay-proximity-store.ts';
import { customers } from '../../customers/schema.ts';
import {WEB_PAYMENT_BLOCKED_STATUSES} from '../domain/web-order-outcome.ts';
import {isLockWebQrPayment} from './sepay-web-store.ts';
import {webStoreOrders as web,posRegisters as webRegisters} from '../pos-schema.ts';
import {webDocumentStatus} from './web-order-documents.ts';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  lt,
  lte,
  ne,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import {
  json,
  readJson,
  type Router,
  type RouteContext,
} from "../../../core/http/router.ts";
import { foldSql, matchAllWords, searchRank } from "../../../core/text/fold.ts";
import { auditLogs } from "../../../core/db/schema.ts";
import type { StaffEnv, SessionState } from "../../staff/api/auth-routes.ts";
import { employees } from "../../staff/schema.ts";
import { sepayTransactions as bank } from "../../integrations/schema.ts";
import {
  parseSepayPayment,
  sepayPaidDate,
} from "../../integrations/domain/sepay-payment.ts";
import {
  salesOrders as orders,
  salesContracts as contracts,
  customerPayments as payments,
} from "../schema.ts";
import {
  canViewSepay,
  sepayPageFilters,
  sepayManualChoice,
  sepayPosIntent,
} from "../domain/sepay-page.ts";
import { debtCounts, vietnamDate } from "../domain/sales.ts";
import { netReceivables } from "./pos-return-credit.ts";
import { heldCashForOrder } from "./cash-collections.ts";
import { ingestPayment, assertSepayCrmSource } from "./sepay-payment-store.ts";

type Ctx = RouteContext<StaffEnv>;
const member = (c: Ctx) => (c.state.session as SessionState).member;
function readAccess(c: Ctx): void {
  if (!canViewSepay(member(c)))
    throw new AppError(403, "Chức vụ của bạn chưa được cấp quyền Thanh toán SePay.");
}
const validWeb = validWebSepay();
const state = sql<string>`case when ${bank.status}='matched' and
 (case when ${bank.webOrderId} is not null then not (${validWeb}) else
 ((${bank.matchMethod}='amount_time' and ${orders.createdAt} is distinct from ${bank.matchedOrderAt}) or ${payments.id} is null or ${payments.voidedAt} is not null or ${payments.orderId} is distinct from ${bank.orderId} or ${payments.amount}<>${bank.amount} or ${payments.method}<>'transfer') end)
 then 'receipt_issue' else ${bank.status} end`;
const columns = {
  id: bank.id,
  providerId: bank.providerId,
  amount: bank.amount,
  accountNumber: bank.accountNumber,
  transactionAt: bank.transactionAt,
  receivedAt: bank.receivedAt,
  content: bank.content,
  status: state,
  rawStatus: bank.status,
  matchMethod:bank.matchMethod,
  matchedOrderAt:bank.matchedOrderAt,
  reason: sql<string>`case when ${bank.webOrderId} is not null and ${bank.status}='matched' and not (${validWeb}) then 'Đơn web hoặc xác nhận thanh toán đã thay đổi; cần kiểm tra chứng từ nguồn.' else ${bank.reason} end`,
  orderId: bank.orderId,
  orderNo: sql<string>`coalesce(nullif(${web.crmOrderNo},''),${web.orderNo},${orders.orderNo})`,
  webOrderId: bank.webOrderId,
  webOrderNo: web.orderNo,
  webPaidAt: sql<string|null>`${web.financialSnapshot}::jsonb->'payment'->>'paidAt'`,
  contractNo: contracts.contractNo,
  customerName: sql<string>`coalesce(${web.customerName},${orders.customerName})`,
  orderStatus: orders.status,
  orderChannel: orders.channel,
  paymentId: bank.paymentId,
  paymentAmount: payments.amount,
  paymentDate: payments.paidAt,
  paymentReference: payments.reference,
  paymentVoidedAt: payments.voidedAt,
};

export function registerSepayPageRoutes(router: Router<StaffEnv>): void {
  router.get(
    "/sepay/transactions",
    async (c) => {
      readAccess(c);
      const f = sepayPageFilters(c.url.searchParams, vietnamDate().iso);
      const status =
        f.status === "all"
          ? undefined
          : f.status === "pending"
            ? inArray(state, ["review", "unmatched"])
            : eq(state, f.status);
      const where = and(
        gte(bank.transactionAt, f.start),
        lt(bank.transactionAt, f.end),
        gte(bank.amount, f.min),
        lte(bank.amount, f.max),
        f.account ? eq(bank.accountNumber, f.account) : undefined,
        status,
        f.q
          ? matchAllWords(
              foldSql(
                bank.providerId,
                web.orderNo,web.crmOrderNo,web.customerName,
                bank.content,
                orders.orderNo,
                contracts.contractNo,
                orders.customerName,
              ),
              f.q,
            )
          : undefined,
      );
      const result = await c.env.db.transaction(
        async (tx) => {
          const [summary] = await tx
            .select({
              count: sql<number>`count(*)::int`,
              amount: sql<number>`coalesce(sum(${bank.amount}),0)::float8`,
              postedCount: sql<number>`count(*) filter(where ${state}='matched')::int`,
              postedAmount: sql<number>`coalesce(sum(${bank.amount}) filter(where ${state}='matched'),0)::float8`,
              pendingCount: sql<number>`count(*) filter(where ${state} in ('review','unmatched'))::int`,
              pendingAmount: sql<number>`coalesce(sum(${bank.amount}) filter(where ${state} in ('review','unmatched')),0)::float8`,
              issueCount: sql<number>`count(*) filter(where ${state}='receipt_issue')::int`,
              issueAmount: sql<number>`coalesce(sum(${bank.amount}) filter(where ${state}='receipt_issue'),0)::float8`,
            })
            .from(bank)
            .leftJoin(web,eq(web.id,bank.webOrderId))
            .leftJoin(webRegisters,eq(webRegisters.id,web.registerId))
            .leftJoin(orders, eq(orders.id, bank.orderId))
            .leftJoin(contracts, eq(contracts.orderId, orders.id))
            .leftJoin(payments, eq(payments.id, bank.paymentId))
            .where(where);
          const rows = await tx
            .select(columns)
            .from(bank)
            .leftJoin(web,eq(web.id,bank.webOrderId))
            .leftJoin(webRegisters,eq(webRegisters.id,web.registerId))
            .leftJoin(orders, eq(orders.id, bank.orderId))
            .leftJoin(contracts, eq(contracts.orderId, orders.id))
            .leftJoin(payments, eq(payments.id, bank.paymentId))
            .where(where)
            .orderBy(desc(bank.transactionAt), desc(bank.id))
            .limit(f.limit)
            .offset(f.offset);
          return { summary: summary!, transactions: rows };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      return json({
        ...result,
        filters: {
          from: f.from,
          to: f.to,
          status: f.status,
          account: f.account,
          q: f.q,
          min: f.min,
          max: f.max,
        },
        pagination: {
          limit: f.limit,
          offset: f.offset,
          total: result.summary.count,
          hasMore: f.offset + result.transactions.length < result.summary.count,
        },
        capabilities: { canConfirm: member(c).role === "manager", canPull: !!c.env.sepayApiToken },
        automationConfigured: !!c.env.sepayReceiptAccounts?.length,
      });
    },
    "business",
  );

  router.get(
    "/sepay/transactions/:id",
    async (c) => {
      readAccess(c);
      const [row] = await c.env.db
        .select(columns)
        .from(bank)
            .leftJoin(web,eq(web.id,bank.webOrderId))
            .leftJoin(webRegisters,eq(webRegisters.id,web.registerId))
        .leftJoin(orders, eq(orders.id, bank.orderId))
        .leftJoin(contracts, eq(contracts.orderId, orders.id))
        .leftJoin(payments, eq(payments.id, bank.paymentId))
        .where(eq(bank.id, c.params.id!))
        .limit(1);
      if (!row) throw new AppError(404, "Không tìm thấy giao dịch SePay.");
      const history = await c.env.db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          createdAt: auditLogs.createdAt,
          actorName: employees.name,
          data: auditLogs.data,
        })
        .from(auditLogs)
        .leftJoin(employees, eq(employees.id, auditLogs.actorId))
        .where(
          and(
            eq(auditLogs.module, "cash"),
            eq(auditLogs.entityType, "sepay_transaction"),
            eq(auditLogs.entityId, row.id),
          ),
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(20);
      const webPayment=!!row.webOrderId||await isLockWebQrPayment(c.env.db,row);
      const accountApproved = await sepayManualAccountApproved(c.env.db,c.env,row.accountNumber);
      return json({
        transaction: row,
        history: history.map((h) => {
          let reason = "";
          try {
            const d = JSON.parse(h.data);
            reason =
              typeof d.reason === "string" ? d.reason.slice(0, 1000) : "";
          } catch {
            /* old audit without JSON */
          }
          return {
            id: h.id,
            action: h.action,
            createdAt: h.createdAt,
            actorName: h.actorName,
            reason,
          };
        }),
        capabilities: {
          canConfirm:
            member(c).role === "manager" &&
            ["review", "unmatched"].includes(row.status),
        },
        blockReason:
          webPayment ? row.reason || "Giao dịch thuộc đơn web; xem trạng thái thanh toán trên đúng đơn web." :
          sepayPosIntent(row.content) || row.orderChannel === "pos"
            ? "Giao dịch thuộc luồng QR/POS; không gắn vào đơn CRM khác."
            : "",
        accountApproved,
      });
    },
    "business",
  );

  router.get(
    "/sepay/orders",
    async (c) => {
      const p = c.url.searchParams, q = (p.get('q') || '').trim();
      const kind = p.get('kind'), source = p.get('source') || (kind === 'order' ? 'crm' : kind === 'contract' ? 'contract' : kind === 'all' ? 'crm-all' : 'all');
      const eligibility = p.get('eligibility') || 'active';
      if (q.length > 120 || (p.has('source') && !['all','crm','contract','pos','web'].includes(source)) ||
          (kind !== null && !['all','order','contract'].includes(kind)) ||
          !['active','eligible','draft','cancelled','all'].includes(eligibility))
        throw new AppError(400,'Bộ lọc đơn không hợp lệ.');
      const integer = (key: string, fallback: number, max: number) => {
        const raw = p.get(key); if (!raw) return fallback;
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max)
          throw new AppError(400,'Bộ lọc số không hợp lệ.');
        return Number(raw);
      };
      const min = integer('min',0,1e12), max = integer('max',1e12,1e12), offset = integer('offset',0,1000000), limit = 20;
      if (min > max) throw new AppError(400,'Khoảng tiền không hợp lệ.');
      const fromDay = p.get('from') || '', toDay = p.get('to') || '';
      const day = vietnamDate().iso;
      // No implicit "today" restriction: a correct search must still find older contracts.
      const dates = sepayPageFilters(new URLSearchParams({from:fromDay || toDay || day,to:toDay || fromDay || day}),day);
      const from = fromDay ? dates.start : undefined, to = toDay ? dates.end : undefined;
      const crmEnd = toDay ? new Date(Date.parse(toDay)+86400000).toISOString().slice(0,10) : undefined;
      const eligible = and(ne(orders.status,'cancelled'),or(eq(orders.channel,'crm'),ne(orders.status,'draft'),inArray(contracts.status,['signed','completed'])));
      const name = sql<string>`coalesce(nullif(${customers.name},''),${orders.customerName})`;
      const webStatus = webDocumentStatus(), webEligible = ne(webStatus,'cancelled');
      const statusFilter = (status: typeof orders.status | typeof webStatus, canSelect: typeof eligible) =>
        eligibility === 'active' ? ne(sql`${status}`,'cancelled') : eligibility === 'eligible' ? canSelect :
        eligibility === 'draft' ? eq(sql`${status}`,'draft') :
        eligibility === 'cancelled' ? eq(sql`${status}`,'cancelled') : undefined;
      const rows = await c.env.db.select({
        id:orders.id, orderNo:orders.orderNo, contractNo:contracts.contractNo, customerName:name, total:orders.total,
        status:sql<string>`${orders.status}`.as('status'), createdAt:orders.createdAt,
        kind:sql<string>`case when ${orders.channel}='pos' then 'pos' when ${contracts.id} is not null then 'contract' else 'crm' end`.as('kind'),
        contractStatus:contracts.status, orderDate:orders.orderDate, selectable:sql<boolean>`coalesce(${eligible},false)`,
        searchRank:(searchRank([orders.orderNo,contracts.contractNo],name,q) || sql`0`).as('search_rank'),
      }).from(orders).leftJoin(contracts,eq(contracts.orderId,orders.id))
        .leftJoin(customers,eq(customers.id,sql`coalesce(${contracts.customerId},${orders.customerId})`))
        .where(and(
          source === 'web' ? sql`false` : source === 'pos' ? eq(orders.channel,'pos') :
          source === 'crm' ? and(eq(orders.channel,'crm'),isNull(contracts.id)) :
          source === 'contract' ? and(eq(orders.channel,'crm'),sql`${contracts.id} is not null`) :
          source === 'crm-all' ? eq(orders.channel,'crm') : inArray(orders.channel,['crm','pos']),
          statusFilter(orders.status,eligible),gte(orders.total,min),lte(orders.total,max),
          fromDay ? or(and(eq(orders.channel,'crm'),gte(orders.orderDate,fromDay)),and(eq(orders.channel,'pos'),gte(orders.createdAt,from!))) : undefined,
          crmEnd ? or(and(eq(orders.channel,'crm'),lt(orders.orderDate,crmEnd)),and(eq(orders.channel,'pos'),lt(orders.createdAt,to!))) : undefined,
          q ? matchAllWords(foldSql(orders.orderNo,contracts.contractNo,orders.quoteNo,orders.customerName,orders.phone,
            customers.name,customers.contact,customers.phone,customers.customerCode),q) : undefined,
        ))
        .unionAll(c.env.db.select({
          id:sql<string>`'web:'||${web.id}`.as('id'),orderNo:sql<string>`coalesce(nullif(${web.crmOrderNo},''),${web.orderNo})`.as('order_no'),
          contractNo:sql<string|null>`null`.as('contract_no'),customerName:web.customerName,total:web.total,status:webStatus.as('status'),
          createdAt:web.orderedAt,kind:sql<string>`'web'`.as('kind'),contractStatus:sql<null>`null`.as('contract_status'),
          orderDate:web.orderedAt,selectable:sql<boolean>`coalesce(${webEligible},false)`,
          searchRank:(searchRank([web.orderNo,web.crmOrderNo],web.customerName,q) || sql`0`).as('search_rank'),
        }).from(web).where(and(
          ['all','web'].includes(source) ? inArray(web.source,['lock','minhlong']) : sql`false`,
          statusFilter(webStatus,webEligible),gte(web.total,min),lte(web.total,max),
          from ? gte(web.orderedAt,from) : undefined,to ? lt(web.orderedAt,to) : undefined,
          q ? matchAllWords(foldSql(web.orderNo,web.crmOrderNo,web.customerName,web.phone),q) : undefined,
        )))
        .orderBy(asc(sql`search_rank`),desc(sql`created_at`),desc(sql`id`)).limit(limit+1).offset(offset);
      return json({orders:rows.slice(0,limit).map(({searchRank: _rank,...row}) => row),hasMore:rows.length>limit,offset,limit});
    },
    "admin",
  );

  router.get(
    "/sepay/orders/:id",
    async (c) => {
      const transactionId = c.url.searchParams.get("transactionId") || "";
      const result = await c.env.db.transaction(
        async (tx) => {
          const [event] = await tx
            .select()
            .from(bank)
            .where(eq(bank.id, transactionId))
            .limit(1);
          if(event && (event.status==='matched'||event.paymentId))throw new AppError(409,'Giao dịch đã được xử lý. Tải lại để kiểm tra.');
          if(event) {
            const [selected]=c.params.id!.startsWith('web:')?[]:await tx.select({channel:orders.channel}).from(orders).where(eq(orders.id,c.params.id!)).limit(1);
            if(c.params.id!.startsWith('web:')||selected?.channel==='pos')return previewNearbySepay(tx,parseSepayPayment(JSON.parse(event.payload)),c.params.id!);
          }
          const [row] = await tx
            .select({
              order: orders,
              contractNo: contracts.contractNo,
              contractStatus: contracts.status,
            })
            .from(orders)
            .leftJoin(contracts, eq(contracts.orderId, orders.id))
            .where(eq(orders.id, c.params.id!))
            .limit(1);
          if (!event || !row)
            throw new AppError(
              404,
              "Không tìm thấy giao dịch hoặc đơn được chọn.",
            );
          await assertSepayCrmSource(tx, event);
          if (event.status === "matched" || event.paymentId)
            throw new AppError(
              409,
              "Giao dịch đã được xử lý. Tải lại giao dịch để kiểm tra phiếu thu.",
            );
          if (
            row.order.channel !== "crm" ||
            row.order.status === "cancelled"
          )
            throw new AppError(
              409,
              "Chỉ chọn đơn CRM/HĐKT chưa hủy.",
            );
          const debt = (
              await netReceivables(tx, [row.order.id], vietnamDate().iso)
            ).get(row.order.id)!,
            held = await heldCashForOrder(tx, row.order.id),
            available = Math.max(0, debt.balance - held);
          const receiptRows = await tx
            .select({
              id: payments.id,
              amount: payments.amount,
              paidAt: payments.paidAt,
              reference: payments.reference,
              source: payments.paymentSource,
            })
            .from(payments)
            .where(
              and(
                eq(payments.orderId, row.order.id),
                eq(payments.method, "transfer"),
                isNull(payments.voidedAt),
                inArray(payments.paymentSource, ["manual", "sepay_auto"]),
                eq(payments.amount, event.amount),
                eq(payments.paidAt, sepayPaidDate(event.transactionAt)),
                sql`not exists(select 1 from ${bank} where ${bank.paymentId}=${payments.id} and ${bank.id}<>${event.id})`,
              ),
            )
            .orderBy(asc(payments.createdAt), asc(payments.id))
            .limit(51);
          const [manualConflict] = await tx
            .select({ id: payments.id })
            .from(payments)
            .where(
              and(
                eq(payments.orderId, row.order.id),
                eq(payments.method, "transfer"),
                isNull(payments.voidedAt),
                ne(payments.paymentSource, "sepay_auto"),
                ne(payments.paymentSource, "pos_exchange_credit"),
                or(
                  eq(payments.reference, "SEPAY:" + event.providerId),
                  and(
                    eq(payments.amount, event.amount),
                    eq(payments.paidAt, sepayPaidDate(event.transactionAt)),
                  ),
                ),
              ),
            )
            .limit(1);
          const accountApproved = await sepayManualAccountApproved(tx,c.env,event.accountNumber);
          return {
            order: {
              id: row.order.id,
              orderNo: row.order.orderNo,
              contractNo: row.contractNo,
              customerName: row.order.customerName,
              total: row.order.total,
            },
            debt: {
              due: debt.due,
              paid: debt.paid,
              balance: debt.balance,
              held,
              available,
            },
            canCreate:
              accountApproved &&
              debt.status !== "none" &&
              event.amount <= available &&
              !manualConflict,
            accountApproved,
            warning: row.order.status === "draft" && !debtCounts(row.order.status,row.contractStatus)
              ? "Đơn/HĐKT còn nháp: khoản thu được ghi nhận trước khi duyệt, trạng thái chứng từ giữ nguyên. Khoản này chưa đưa đơn vào công nợ đang có hiệu lực."
              : "",
            manualConflict: !!manualConflict,
            existingReceipts: receiptRows.slice(0, 50),
            moreReceipts: receiptRows.length > 50,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      return json(result);
    },
    "admin",
  );

  router.post(
    "/sepay/transactions/:id/confirm",
    async (c) => {
      const choice = sepayManualChoice(await readJson(c.req, 4000));
      const [event] = await c.env.db
        .select()
        .from(bank)
        .where(eq(bank.id, c.params.id!))
        .limit(1);
      if (!event) throw new AppError(404, "Không tìm thấy giao dịch SePay.");
      let payment;
      try {
        payment = parseSepayPayment(JSON.parse(event.payload));
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          409,
          "Chứng từ SePay không hợp lệ; cần đối soát dữ liệu gốc.",
        );
      }
      return json({
        success: true,
        ...(await ingestPayment(c.env, payment, member(c).id, choice)),
      });
    },
    "admin",
  );
}
