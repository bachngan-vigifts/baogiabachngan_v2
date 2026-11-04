import { z } from 'zod';
import { AppError } from '../../../core/errors.ts';

export const canEditWebAccounting = (member: {
  role: string;
  positionId?: string | null;
}): boolean =>
  member.role === 'manager' ||
  (member.role === 'employee' && member.positionId !== 'warehouse');

const text = (max: number) => z.string().trim().max(max);
const invoiceSchema = z.object({
  status: z.enum(['requested', 'issued']),
  invoiceNo: text(200).default(''),
  invoiceDate: text(10).default(''),
  email: text(500).default(''),
  mode: z.enum(['draft', 'issue']).default('issue'),
  note: text(1000).default(''),
  requestedAt: z.string().optional(),
  requestedBy: z.string().nullable().optional(),
  issuedAt: z.string().optional(),
  issuedBy: z.string().optional(),
  issuedByName: z.string().optional(),
  requestedByName: z.string().optional(),
});
const billingSchema = z.object({
  name: text(500),
  taxCode: text(100),
  address: text(2000),
  email: text(500),
});
const accountingSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  invoice: invoiceSchema.optional(),
  billing: billingSchema.optional(),
});
export type WebAccounting = z.infer<typeof accountingSchema>;

export function readWebAccounting(snapshot: string): WebAccounting {
  let value: unknown;
  try {
    value = JSON.parse(snapshot || '{}');
  } catch {
    throw new AppError(
      409,
      'Dữ liệu đơn cần đối soát trước khi chỉnh sửa hoá đơn.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError(409, 'Dữ liệu đơn không hợp lệ.');
  const accounting =
    value && typeof value === 'object' && 'accounting' in value
      ? value.accounting
      : undefined;
  if (accounting == null) return { revision: 0 };
  const result = accountingSchema.safeParse(accounting);
  if (!result.success)
    throw new AppError(
      409,
      'Thông tin hoá đơn cần đối soát trước khi chỉnh sửa.',
    );
  return result.data;
}

export function parseWebBilling(
  input: Record<string, unknown>,
): NonNullable<WebAccounting['billing']> {
  const result = billingSchema.safeParse(input);
  if (!result.success)
    throw new AppError(
      400,
      'Thông tin xuất hoá đơn không hợp lệ hoặc quá dài.',
    );
  const billing = result.data;
  if (billing.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email))
    throw new AppError(400, 'Email nhận hoá đơn không hợp lệ.');
  return billing;
}

export function parseWebInvoice(
  input: Record<string, unknown>,
  today: string,
): { invoiceNo: string; invoiceDate: string } {
  const result = z
    .object({ invoiceNo: text(200).min(1), invoiceDate: text(10).optional() })
    .safeParse(input);
  if (!result.success)
    throw new AppError(400, 'Nhập số hoá đơn hợp lệ (tối đa 200 ký tự).');
  const invoiceDate = result.data.invoiceDate || today;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    ? new Date(invoiceDate + 'T00:00:00Z')
    : null;
  if (
    !date ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== invoiceDate
  )
    throw new AppError(400, 'Ngày hoá đơn không hợp lệ.');
  return { invoiceNo: result.data.invoiceNo, invoiceDate };
}

export function parseWebInvoiceRequest(input: Record<string, unknown>): {
  email: string;
  note: string;
  mode: 'draft' | 'issue';
} {
  const result = z
    .object({
      email: text(500).default(''),
      note: text(1000).default(''),
      mode: z.enum(['draft', 'issue']).default('issue'),
    })
    .safeParse(input);
  if (!result.success)
    throw new AppError(400, 'Yêu cầu xuất hoá đơn không hợp lệ.');
  const emails = result.data.email.split(/[,;\s]+/).filter(Boolean);
  if (
    emails.length > 5 ||
    emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new AppError(400, 'Email nhận hoá đơn không hợp lệ.');
  return { ...result.data, email: emails.join(', ') };
}
