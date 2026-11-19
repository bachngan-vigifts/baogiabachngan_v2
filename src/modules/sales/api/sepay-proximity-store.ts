import {webOrderPayment} from '../domain/web-order-payment.ts';
import {webSepayPaidAt} from './web-sepay-evidence.ts';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { AppError } from "../../../core/errors.ts";
import { sepayTransactions as bank } from "../../integrations/schema.ts";
import {
  sepayPaidDate,
  type SepayPayment,
} from "../../integrations/domain/sepay-payment.ts";
import {
  customerPayments as receipts,
  salesOrders as orders,
} from "../schema.ts";
import {
  posRegisters as registers,
  posShifts as shifts,
  webStoreOrders as web,
} from "../pos-schema.ts";
import { debtCounts } from "../domain/sales.ts";
import { webOrderPaymentBlocked } from "../domain/web-order-outcome.ts";
import {
  chooseNearbySepay,
  isBankWebMethod,
  SEPAY_MATCH_LIMIT,
  sepayWindow,
} from "../domain/sepay-proximity.ts";
import {
  normalizePosReference,
  posQrOrderNumbers,
} from "../domain/pos-qr-reference.ts";
import {
  sepayPosIntent,
  type SepayManualChoice,
} from "../domain/sepay-page.ts";
import { webQrReferences } from "./sepay-web-store.ts";
import { cashAudit, cashLock, type CashDb } from "./cash-store.ts";
import { netReceivables } from "./pos-return-credit.ts";

type Event = typeof bank.$inferSelect;
export type NearTarget = {
  id: string;
  kind: "pos" | "web";
  at: string;
  amount: number;
  total: number;
  orderAt: string;
  orderNo: string;
  customerName: string;
  ghnOrderCode?: string;
  receiptId?: string;
  accountApproved: boolean;
  blocked: string;
};
const stampIsUtc = (s: string) =>
  /^\d{4}-\d{2}-\d{2}T.*Z$/.test(s) && Number.isFinite(Date.parse(s));
const cleanAccount = (s: string | null) => (s || "").replace(/\s+/g, "");
const docIntent = (s: string) =>
  /(?:DH|HDKT|HKT|BG|POS|CRM|WEB)[A-Z0-9]*\d/.test(normalizePosReference(s));

/** At most 50 orders per source; no per-order receivable query or unbounded history scan. */
export async function nearbySepayTargets(
  db: CashDb,
  p: SepayPayment,
  targetId?: string,
  manual = false,
) {
  const window = sepayWindow(p.transactionAt),
    refs = webQrReferences(p.content),
    posIntent = sepayPosIntent(p.content);
  const webId = targetId?.startsWith("web:") ? targetId.slice(4) : undefined;
  const posId = targetId && !webId ? targetId : undefined;
  const posNos = posQrOrderNumbers(normalizePosReference(p.content));
  const [posRows, webRows] = await Promise.all([
    webId ||
    (!targetId && (refs.length || (docIntent(p.content) && !posIntent)))
      ? []
      : db
          .select({
            order: orders,
            account: registers.bankAccount,
            active: registers.active,
          })
          .from(orders)
          .innerJoin(shifts, eq(shifts.id, orders.shiftId))
          .innerJoin(registers, eq(registers.id, shifts.registerId))
          .where(
            and(
              eq(orders.channel, "pos"),
              posId
                ? eq(orders.id, posId)
                : and(
                    gte(orders.createdAt, window.from),
                    lte(orders.createdAt, window.to),
                    eq(
                      sql`regexp_replace(${registers.bankAccount},'[[:space:]]','','g')`,
                      p.accountNumber,
                    ),
                  ),
            ),
          )
          .orderBy(asc(orders.createdAt), asc(orders.id))
          .limit(SEPAY_MATCH_LIMIT + 1),
    posId ||
    (!targetId && (posIntent || (docIntent(p.content) && !refs.length)))
      ? []
      : db
          .select({
            order: web,
            account: registers.bankAccount,
            active: registers.active,
          })
          .from(web)
          .innerJoin(registers, eq(registers.id, web.registerId))
          .where(
            and(
              inArray(web.source, ["lock", "minhlong"]),
              webId
                ? eq(web.id, webId)
                : and(
                    gte(web.orderedAt, window.from),
                    lte(web.orderedAt, window.to),
                    eq(
                      sql`regexp_replace(${registers.bankAccount},'[[:space:]]','','g')`,
                      p.accountNumber,
                    ),
                  ),
              !targetId && refs.length
                ? inArray(
                    web.externalId,
                    refs.map((ref) => ref.slice(2)),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(web.orderedAt), asc(web.id))
          .limit(SEPAY_MATCH_LIMIT + 1),
  ]);
  const ids = posRows.map((row) => row.order.id);
  const paidRows = ids.length
    ? await db
        .select()
        .from(receipts)
        .where(
          and(
            inArray(receipts.orderId, ids),
            eq(receipts.method, "transfer"),
            isNull(receipts.voidedAt),
            eq(receipts.amount, p.amount),
            or(
              eq(receipts.paidAt, sepayPaidDate(p.transactionAt)),
              and(
                gte(receipts.createdAt, window.from),
                lte(receipts.createdAt, window.to),
              ),
            ),
            ne(receipts.paymentSource, "pos_exchange_credit"),
          ),
        )
        .limit(2 * SEPAY_MATCH_LIMIT + 1)
    : [];
  const receiptIds = paidRows.map((row) => row.id),
    webIds = webRows.map((row) => row.order.id);
  const bindings =
    receiptIds.length || webIds.length
      ? await db
          .select({ paymentId: bank.paymentId, webOrderId: bank.webOrderId })
          .from(bank)
          .where(
            and(
              ne(bank.providerId, p.providerId),
              sql`(${receiptIds.length ? inArray(bank.paymentId, receiptIds) : sql`false`} or (${webIds.length ? inArray(bank.webOrderId, webIds) : sql`false`} and ${bank.status}='matched'))`,
            ),
          )
      : [];
  const targets: NearTarget[] = [];
  for (const row of posRows.slice(0, SEPAY_MATCH_LIMIT)) {
    const o = row.order,
      normalized = normalizePosReference(p.content);
    let blocked = !debtCounts(o.status)
      ? "Đơn POS đã huỷ hoặc chưa có hiệu lực."
      : "";
    if (
      refs.length ||
      (!manual &&
        posIntent &&
        !(
          posNos.includes(o.orderNo) ||
          (o.posPaymentRequestId &&
            normalized.includes(
              "POS" +
                o.posPaymentRequestId
                  .replace(/-/g, "")
                  .slice(0, 12)
                  .toUpperCase(),
            ))
        ))
    )
      blocked = "Mã QR trong giao dịch không thuộc đơn POS này.";
    const approved =
      row.active && cleanAccount(row.account) === p.accountNumber;
    if (!approved)
      blocked = "Tài khoản nhận không khớp quầy đang hoạt động của đơn POS.";
    const matches = paidRows.filter((receipt) => receipt.orderId === o.id);
    const base = {
      id: o.id,
      kind: "pos" as const,
      at: o.createdAt,
      orderAt: o.createdAt,
      total: o.total,
      orderNo: o.orderNo,
      customerName: o.customerName,
      accountApproved: approved,
    };
    if (!matches.length)
      targets.push({
        ...base,
        amount: o.total,
        blocked:
          blocked ||
          "Chưa có phiếu chuyển khoản POS khớp số tiền/ngày. Xác nhận thu trong POS trước; không tự đổi COD hoặc ghi thêm tiền vào ca.",
      });
    for (const receipt of matches)
      targets.push({
        ...base,
        amount: receipt.amount,
        at: receipt.createdAt,
        receiptId: receipt.id,
        blocked:
          blocked ||
          (bindings.some((binding) => binding.paymentId === receipt.id)
            ? "Phiếu thu đã gắn giao dịch SePay khác."
            : ""),
      });
  }
  for (const row of webRows.slice(0, SEPAY_MATCH_LIMIT)) {
    const o = row.order;
    let blocked =
      !manual && !o.orderedAtVerified
        ? "Đơn web chưa có thời điểm tạo được xác minh; cần đối soát thủ công."
        : "";
    if (
      posIntent ||
      (!manual && refs.length && !refs.includes((o.source === "minhlong" ? "ML" : "DH") + o.externalId))
    )
      blocked = "Mã QR trong giao dịch không thuộc đơn web này.";
    if (!manual && o.ghnOrderCode)
      blocked =
        "Đơn web đã có vận đơn GHN; Manager cần kiểm tra khoản COD trước khi đối soát thủ công.";
    if (o.currency !== "VND" || webOrderPaymentBlocked(o.status, o.ghnStatus))
      blocked = "Đơn web đã huỷ/hoàn hoặc không dùng VND.";
    if (!isBankWebMethod(o.paymentMethod))
      blocked =
        "Đơn web không dùng chuyển khoản/QR; không tự đổi phương thức COD hoặc tiền mặt.";
    try {
      const edit = JSON.parse(o.crmEditSnapshot || "{}");
      if (
        !edit ||
        typeof edit !== "object" ||
        Array.isArray(edit) ||
        edit.sourceConflict ||
        Number(edit.revision || 0) > 0
      )
        blocked = "Đơn web đã sửa hoặc xung đột nguồn; cần đối chiếu trước.";
    } catch {
      blocked = "Dữ liệu nguồn đơn web không hợp lệ.";
    }
    const approved =
      row.active && cleanAccount(row.account) === p.accountNumber;
    if (!approved)
      blocked = "Tài khoản nhận không khớp quầy đang hoạt động của đơn web.";
    if (bindings.some((binding) => binding.webOrderId === o.id))
      blocked = "Đơn web đã đối soát với giao dịch SePay khác.";
    if (!Number.isSafeInteger(o.total) || o.total <= 0 || o.total !== p.amount)
      blocked =
        "Số tiền không bằng toàn bộ tổng đơn web; cần kiểm tra, không tự ghi thiếu/thừa.";
    targets.push({
      id: "web:" + o.id,
      kind: "web",
      at: o.orderedAt,
      orderAt: o.orderedAt,
      amount: o.total,
      total: o.total,
      orderNo: o.crmOrderNo || o.orderNo,
      customerName: o.customerName,
      ghnOrderCode: o.ghnOrderCode,
      accountApproved: approved,
      blocked,
    });
  }
  return {
    targets,
    overflow:
      refs.length > 1 ||
      (refs.length > 0 && posIntent) ||
      posRows.length > SEPAY_MATCH_LIMIT ||
      webRows.length > SEPAY_MATCH_LIMIT ||
      paidRows.length > 2 * SEPAY_MATCH_LIMIT,
  };
}

/** Provider lock is owned by the caller. Every writer also takes the shared money lock. */
export async function applyNearbySepay(
  db: CashDb,
  p: SepayPayment,
  old: Event | undefined,
  now: string,
  actorId = "integration:sepay-nearby",
  manual?: SepayManualChoice,
  targetHint?: string,
) {
  const waiting =
    !manual && Date.parse(now) < Date.parse(sepayWindow(p.transactionAt).to);
  if (!waiting) {
    await cashLock(db);
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext('sepay:web-qr'))`,
    );
  }
  const { targets, overflow } = waiting
    ? { targets: [] as NearTarget[], overflow: false }
    : await nearbySepayTargets(db, p, manual?.orderId || targetHint, !!manual);
  let target: NearTarget | undefined,
    status: "matched" | "review" | "unmatched",
    reason: string;
  if (manual) {
    const options = targets.filter(
      (row) =>
        row.id === manual.orderId &&
        (!manual.existingPaymentId ||
          row.receiptId === manual.existingPaymentId),
    );
    if (options.length !== 1)
      throw new AppError(
        409,
        "Chọn đúng đơn và phiếu thu khớp; có nhiều phiếu thì phải chọn cụ thể.",
      );
    target = options[0]!;
    if (target.blocked) throw new AppError(409, target.blocked);
    status = "matched";
    reason = manual.reason;
  } else {
    // Legacy timestamp strings without timezone are deliberately not guessed for money matching.
    const decision = chooseNearbySepay(
      targets.filter((row) => stampIsUtc(row.at)),
      p.amount,
      p.transactionAt,
      now,
      overflow,
    );
    status = decision.status;
    reason = decision.reason;
    if (decision.status === "matched") {
      target = decision.target;
      if (target.blocked) {
        status = "review";
        reason = target.blocked;
      }
    }
    if (targetHint && !targets.length) {
      status = "review";
      reason =
        "Đã có mã/đích POS hoặc web nhưng chưa đủ chứng từ khớp; cần kiểm tra đúng luồng nguồn.";
    }
  }
  const id = old?.id || crypto.randomUUID();
  if (status === "matched" && target) {
    // Website writes are not all under cashLock: lock the chosen source row and validate again.
    if (target.kind === "web")
      await db
        .select({ id: web.id })
        .from(web)
        .where(eq(web.id, target.id.slice(4)))
        .for("update");
    else
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, target.id))
        .for("update");
    const fresh = (
      await nearbySepayTargets(db, p, target.id, !!manual)
    ).targets.find(
      (row) => row.id === target!.id && row.receiptId === target!.receiptId,
    );
    if (!fresh || fresh.blocked || fresh.amount !== p.amount) {
      if (manual)
        throw new AppError(
          409,
          fresh?.blocked ||
            "Chứng từ vừa thay đổi; tải lại trước khi đối soát.",
        );
      status = "review";
      reason =
        fresh?.blocked || "Chứng từ vừa thay đổi; cần tải lại để đối soát.";
    }
  }
  const fields = {
    status,
    reason,
    ...(status === "matched"
      ? {
          matchMethod: manual ? ("manual" as const) : ("amount_time" as const),
          matchedOrderAt: target!.orderAt,
        }
      : {}),
    orderId:
      status === "matched"
        ? target?.kind === "pos"
          ? target.id
          : null
        : targetHint && !targetHint.startsWith("web:")
          ? targetHint
          : old?.orderId || null,
    paymentId:
      status === "matched" && target?.kind === "pos" ? target.receiptId! : null,
    webOrderId:
      status === "matched"
        ? target?.kind === "web"
          ? target.id.slice(4)
          : null
        : old?.webOrderId || null,
  };
  if (old) await db.update(bank).set(fields).where(eq(bank.id, old.id));
  else
    await db.insert(bank).values({
      id,
      providerId: p.providerId,
      transferType: p.transferType,
      amount: p.amount,
      accountNumber: p.accountNumber,
      transactionAt: p.transactionAt,
      content: p.content,
      payload: p.payload,
      receivedAt: now,
      ...fields,
    });
  if (
    !old ||
    fields.status !== old.status ||
    fields.reason !== old.reason ||
    fields.paymentId !== old.paymentId ||
    fields.webOrderId !== old.webOrderId
  )
    await cashAudit(
      db,
      actorId,
      manual ? "sepay.confirm" : "sepay.nearby-match",
      "sepay_transaction",
      id,
      {
        ...fields,
        providerId: p.providerId,
        method: manual ? "manual" : "amount-time",
        windowMinutes: 5,
        reason: manual?.reason || reason,
        receiptLinked: !!fields.paymentId,
        previousOrderId: old?.orderId || null,
        previousWebOrderId: old?.webOrderId || null,
      },
    );
  return { duplicate: manual ? false : !!old, ...fields };
}

export async function previewNearbySepay(
  db: CashDb,
  p: SepayPayment,
  targetId: string,
) {
  const { targets, overflow } = await nearbySepayTargets(db, p, targetId, true);
  const first = targets[0];
  if (!first) throw new AppError(404, "Không tìm thấy đơn POS/web.");
  const valid = targets.filter((row) => !row.blocked),
    receiptIds = valid.flatMap((row) => (row.receiptId ? [row.receiptId] : []));
  const existing = receiptIds.length
    ? await db
        .select({
          id: receipts.id,
          amount: receipts.amount,
          paidAt: receipts.paidAt,
          reference: receipts.reference,
          source: receipts.paymentSource,
        })
        .from(receipts)
        .where(inArray(receipts.id, receiptIds))
        .limit(50)
    : [];
  let debt: {
    due: number | null;
    paid: number | null;
    balance: number | null;
    held: number;
    available: number;
  };
  if (first.kind === "pos") {
    const row = (
      await netReceivables(db, [first.id], sepayPaidDate(p.transactionAt))
    ).get(first.id)!;
    debt = {
      due: row.due,
      paid: row.paid,
      balance: row.balance,
      held: 0,
      available: 0,
    };
  } else {
    const [source] = await db
      .select({financialSnapshot:web.financialSnapshot,crmEditSnapshot:web.crmEditSnapshot,total:web.total,bankPaidAt:webSepayPaidAt()})
      .from(web)
      .where(eq(web.id, first.id.slice(4)));
    const paid = source?webOrderPayment(source,source.bankPaidAt).paid:null;
    debt = {
      due: first.total,
      paid,
      balance: paid === null ? null : first.total - paid,
      held: 0,
      available: 0,
    };
  }
  return {
    order: {
      id: first.id,
      orderNo: first.orderNo,
      customerName: first.customerName,
      total: first.total,
      ...(first.kind === "web"
        ? { webOrderId: first.id.slice(4), webOrderNo: first.orderNo }
        : {}),
    },
    debt,
    recordMode: first.kind === "web" ? "web-link" : "pos-link",
    warning: first.ghnOrderCode
      ? "Đã có vận đơn GHN " +
        first.ghnOrderCode +
        ". Kiểm tra và xử lý tiền COD trên GHN trước khi xác nhận; đối soát SePay không sửa vận đơn."
      : "",
    canCreate: first.kind === "web" && valid.length === 1,
    accountApproved: first.accountApproved,
    manualConflict: false,
    existingReceipts: existing,
    moreReceipts: overflow,
    blockReason: valid.length ? "" : first.blocked,
  };
}
