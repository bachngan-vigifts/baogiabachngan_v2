import { z } from 'zod';
import { AppError } from '../../../core/errors.ts';
import { isCalendarDate } from './anniversary.ts';
import { parseAppsheetInput, type AppsheetInput } from './appsheet-input.ts';

const column = z.string().trim().min(1).max(200).refine(v => v.toLowerCase() !== '_rownumber');
const mappingSchema = z.object({
  appId: column, customersTable: column, contactsTable: column,
  /** Local timestamps must explicitly declare their source offset and date order. */
  localOffset: z.string().regex(/^[+-](?:0\d|1[0-4]):[0-5]\d$/),
  dateOrder: z.enum(['ISO', 'DMY']),
  customer: z.object({ keyConfirmed: z.literal(true), rowId: column, updatedAt: column, createdAt: column.optional(), fields: z.record(column) }).strict(),
  contact: z.object({ keyConfirmed: z.literal(true), rowId: column, customerRowId: column, updatedAt: column, fields: z.record(column) }).strict(),
}).strict();
export type AppsheetExportMapping = z.infer<typeof mappingSchema>;
const invalid = () => new AppError(400, 'Bản xuất hoặc cấu hình ánh xạ không hợp lệ. Kiểm tra khóa nguồn, cột, kiểu và ngày giờ; không tự đoán dữ liệu.');

export function prepareAppsheetBatches(config: unknown, customerRows: unknown, contactRows: unknown): AppsheetInput[] {
  const parsed = mappingSchema.safeParse(config);if (!parsed.success) throw invalid();
  const mapping = parsed.data;
  const records = (rows: unknown): Record<string,unknown>[] => {
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw invalid();
    return rows;
  };
  const calendar = (value: string) => {
    let date = value;
    if (mapping.dateOrder === 'DMY' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
      const [d,m,y] = value.split('/'); date = `${y}-${m!.padStart(2,'0')}-${d!.padStart(2,'0')}`;
    }
    if (!isCalendarDate(date)) throw invalid();return date;
  };
  const timestamp = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw invalid();
    const raw = value.trim();
    // Validate calendar before Date.parse can silently normalize 30 February.
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      calendar(raw.slice(0,10));
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return raw;
    }
    const local = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(raw);
    if (!local) throw invalid();
    return `${calendar(local[1]!)}T${local[2] ? local[2].length === 5 ? local[2]+':00' : local[2] : '00:00:00'}${mapping.localOffset}`;
  };
  const stringKey = (value: unknown) => {if(typeof value!=='string'||!value.trim())throw invalid();return value.trim();};
  const fields = (row: Record<string,unknown>, columns: Record<string,string>) => Object.fromEntries(Object.entries(columns).flatMap<[string,string|boolean|null]>(([field,name]) => {
    if (!Object.hasOwn(row,name)) return []; // Missing source column must not clear a CRM value.
    const value = row[name];
    if (field === 'establishedDate') return [[field, value === '' || value === null ? null : calendar(stringKey(value))]];
    if (field === 'isPrimary') {
      if (![true,false,'TRUE','FALSE','true','false'].includes(value as boolean|string)) throw invalid();
      return [[field,value===true||value==='TRUE'||value==='true']];
    }
    // Phones/codes must remain text: numeric source cells may already have lost leading zeroes.
    if (value !== null && typeof value !== 'string') throw invalid();
    return [[field,field==='customerType'&&value===null?null:value??'']];
  }));
  const customers = records(customerRows).map(row=>({rowId:stringKey(row[mapping.customer.rowId]),updatedAt:timestamp(row[mapping.customer.updatedAt]),
    ...(mapping.customer.createdAt && row[mapping.customer.createdAt] ? {createdAt:timestamp(row[mapping.customer.createdAt])}:{}),fields:fields(row,mapping.customer.fields)}));
  const contacts = records(contactRows).map(row=>({rowId:stringKey(row[mapping.contact.rowId]),customerRowId:stringKey(row[mapping.contact.customerRowId]),
    updatedAt:timestamp(row[mapping.contact.updatedAt]),fields:fields(row,mapping.contact.fields)}));
  // Detect cross-batch duplicate source keys before producing any output files.
  for (const rows of [customers,contacts]) if (new Set(rows.map(r=>r.rowId)).size!==rows.length) throw invalid();
  const batches: AppsheetInput[]=[];
  const base={format:'appsheet-customers-v1',appId:mapping.appId,customersTable:mapping.customersTable,contactsTable:mapping.contactsTable};
  for(let i=0;i<customers.length;i+=200)batches.push(parseAppsheetInput({...base,customers:customers.slice(i,i+200),contacts:[]}));
  for(let i=0;i<contacts.length;i+=200)batches.push(parseAppsheetInput({...base,customers:[],contacts:contacts.slice(i,i+200)}));
  if(!batches.length)throw invalid();return batches;
}
