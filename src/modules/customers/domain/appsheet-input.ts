import { z } from 'zod';
import { AppError } from '../../../core/errors.ts';
import { isCalendarDate, vietnamToday } from './anniversary.ts';

const key = z.string().trim().min(1).max(200).refine(v => v !== '_RowNumber', 'Cần khóa AppSheet ổn định.');
const timestamp = z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString());
const text = (max: number) => z.string().trim().max(max);
const email = text(500).refine(v => !v || /^\S+@\S+\.\S+$/.test(v));
const date = z.string().refine(v => isCalendarDate(v) && v <= vietnamToday()).nullable();
const customerFields = z.object({
  name: text(500).min(1), contact: text(500).optional(), phone: text(40).optional(),
  email: email.optional(), address: text(2000).optional(), taxCode: text(500).optional(),
  customerCode: text(500).optional(), customerType: text(500).nullable().optional(),
  establishedDate: date.optional(),
  approvalStatus: z.enum(['Đã duyệt', 'Đợi duyệt', 'Chờ duyệt', 'Từ chối', 'approved', 'pending', 'rejected']),
}).strict();
const contactFields = z.object({
  name: text(200).min(1), title: text(120).optional(), phone: text(40).optional(), email: email.optional(),
  note: text(1000).optional(), isPrimary: z.boolean().optional(),
}).strict();
export const appsheetInputSchema = z.object({
  format: z.literal('appsheet-customers-v1'), appId: key, customersTable: key, contactsTable: key,
  customers: z.array(z.object({ rowId: key, updatedAt: timestamp, createdAt: timestamp.optional(), fields: customerFields }).strict()).max(200),
  contacts: z.array(z.object({ rowId: key, customerRowId: key, updatedAt: timestamp, fields: contactFields }).strict()).max(200),
  resolutions: z.object({ customers: z.record(key).default({}), contacts: z.record(key).default({}) }).strict().default({}),
}).strict();
export type AppsheetInput = z.infer<typeof appsheetInputSchema>;
export function parseAppsheetInput(value: unknown): AppsheetInput {
  const parsed = appsheetInputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new AppError(400, `Dữ liệu AppSheet không hợp lệ tại ${issue.path.join('.') || 'file'}. Kiểm tra định dạng, giới hạn và ngày giờ có múi giờ.`, 'APPSHEET_INPUT');
  }
  const input = parsed.data;
  if (input.customersTable === input.contactsTable || !input.customers.length && !input.contacts.length)
    throw new AppError(400, 'Cần hai tên bảng khác nhau và ít nhất một bản ghi.');
  for (const rows of [input.customers, input.contacts])
    if (new Set(rows.map(r => r.rowId)).size !== rows.length) throw new AppError(400, 'Trùng khóa AppSheet trong cùng bảng.');
  for (const kind of ['customers', 'contacts'] as const)
    if (Object.keys(input.resolutions[kind]).some(id => !input[kind].some(r => r.rowId === id))) throw new AppError(400, 'Đối soát chứa khóa không có trong lô.');
  return input;
}
export const sourceApproval = (value: string) => ['Đã duyệt', 'approved'].includes(value) ? 'approved' as const
  : ['Từ chối', 'rejected'].includes(value) ? 'rejected' as const : 'pending' as const;
