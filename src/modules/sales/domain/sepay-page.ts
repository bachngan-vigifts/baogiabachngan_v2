import {SEPAY_ENTITIES} from './sepay-entities.ts';
import { AppError } from "../../../core/errors.ts";
import { documentDate } from "../../../core/document-number.ts";
import { can, type PermissionMember } from "../../staff/domain/permissions.ts";
import {
  normalizePosReference,
  posQrOrderNumbers,
} from "./pos-qr-reference.ts";
export function sepayPosIntent(content: string): boolean {
  const normalized = normalizePosReference(content);
  return (
    posQrOrderNumbers(normalized).length > 0 ||
    /POS[A-F0-9]{12}/.test(normalized)
  );
}
export const SEPAY_PAGE_STATES = [
  "all",
  "pending",
  "matched",
  "unmatched",
  "review",
  "receipt_issue",
] as const;
export type SepayPageState = (typeof SEPAY_PAGE_STATES)[number];
export const canViewSepay = (member: PermissionMember): boolean => can(member, 'page.sepay');
export const canReconcileSepay=(m:PermissionMember)=>canViewSepay(m)&&can(m,'sepay.reconcile-incoming');
export const canViewSepayDebits=(m:PermissionMember)=>canViewSepay(m)&&(m.role==='manager'||m.role==='employee'&&m.positionId==='accounting');
export function sepayPageFilters(q: URLSearchParams, today: string) {
  const date = (s: string): string => {
    try {
      documentDate(s);
      return s;
    } catch {
      throw new AppError(400, "Ngày lọc không hợp lệ.");
    }
  };
  const from = date(q.get("from") || today.slice(0, 7) + "-01"),
    to = date(q.get("to") || today);
  if (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000)
    throw new AppError(400, "Chọn khoảng ngày hợp lệ, tối đa 366 ngày.");
  const state = q.get("status") || "all";
  if (!SEPAY_PAGE_STATES.includes(state as SepayPageState))
    throw new AppError(400, "Trạng thái SePay không hợp lệ.");
  const entity=q.get('entity')||'';
  if(entity&&!SEPAY_ENTITIES.includes(entity as typeof SEPAY_ENTITIES[number]))throw new AppError(400,'Công ty SePay không hợp lệ.');
  const direction=q.get('direction')||'in';
  if(!['in','out','all'].includes(direction))throw new AppError(400,'Loại giao dịch không hợp lệ.');
  const account = (q.get("account") || "").replace(/\s+/g, "");
  if (account && !/^[A-Za-z0-9]{1,100}$/.test(account))
    throw new AppError(400, "Tài khoản lọc không hợp lệ.");
  const search = (q.get("q") || "").trim();
  if (search.length > 120)
    throw new AppError(400, "Từ khoá tìm tối đa 120 ký tự.");
  const integer = (key: string, fallback: number, max: number) => {
    const raw = q.get(key);
    if (raw === null || raw === "") return fallback;
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) > max
    )
      throw new AppError(400, "Bộ lọc số không hợp lệ.");
    return Number(raw);
  };
  const min = integer("min", 0, 1e12),
    max = integer("max", 1e12, 1e12),
    limit = integer("limit", 25, 100),
    offset = integer("offset", 0, 1000000);
  if (min > max || limit < 1)
    throw new AppError(400, "Khoảng tiền hoặc số dòng không hợp lệ.");
  return {
    from,
    to,
    entity, direction,
    status: state as SepayPageState,
    account,
    q: search,
    min,
    max,
    limit,
    offset,
    start: new Date(from + "T00:00:00+07:00").toISOString(),
    end: new Date(Date.parse(to + "T00:00:00+07:00") + 86400000).toISOString(),
  };
}
export interface SepayManualChoice {
  orderId: string;
  reason: string;
  existingPaymentId?: string;
}
export function sepayManualChoice(
  body: Record<string, unknown>,
): SepayManualChoice {
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "",
    reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (
    !orderId ||
    orderId.length > 100 ||
    body.confirmed !== true ||
    reason.length < 10 ||
    reason.length > 1000
  )
    throw new AppError(
      400,
      "Chọn đơn, ghi lý do 10–1.000 ký tự và xác nhận đã đối chiếu chứng từ.",
    );
  const existingPaymentId = body.existingPaymentId;
  if (
    existingPaymentId !== undefined &&
    (typeof existingPaymentId !== "string" ||
      !existingPaymentId.trim() ||
      existingPaymentId.length > 100)
  )
    throw new AppError(400, "Phiếu thu được chọn không hợp lệ.");
  return {
    orderId,
    reason,
    ...(typeof existingPaymentId === "string"
      ? { existingPaymentId: existingPaymentId.trim() }
      : {}),
  };
}
