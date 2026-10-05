// Sinh docs/NCC-ACTIONS.md từ máy trạng thái thật. Chạy: npm run docs:ncc
import { writeFileSync } from 'node:fs';
import { nextActions, orderStage, DEFAULT_RULES, type OrderFacts, type OrderAction, type WorkflowActor } from '../src/modules/suppliers/domain/workflow.ts';

const LABEL: Record<OrderAction, string> = {
  approve: 'Duyệt đơn', set_internal_number: 'Nhập số phiếu NCC', upload_signature: 'Tải bản ký', delete_signature: 'Xoá bản ký', confirm: 'Xác nhận đơn',
  request_deposit: 'Yêu cầu cọc', pay_deposit: 'Ghi nhận cọc', mark_delivery_ready: 'Báo sẵn sàng giao', unmark_delivery_ready: 'Bỏ báo sẵn sàng giao', receive: 'Nhập kho',
};
const base: OrderFacts = { source: 'supplier-order', approvalStatus: 'approved', supplierId: 'S1', confirmed: false, hasSignatureStep: false, hasSignatureFile: false, depositRequested: false, depositPaid: false, deliveryReady: false, received: false };
const states: [string, Partial<OrderFacts>][] = [
  ['Chờ Manager duyệt', { approvalStatus: 'pending' }],
  ['Đã duyệt, NCC chưa làm gì', {}],
  ['Đã tải bản ký, chưa xác nhận', { hasSignatureStep: true, hasSignatureFile: true }],
  ['Đã xác nhận', { confirmed: true, hasSignatureStep: true, hasSignatureFile: true }],
  ['Đã xác nhận + đã yêu cầu cọc', { confirmed: true, hasSignatureStep: true, hasSignatureFile: true, depositRequested: true }],
  ['Đã xác nhận + đã nhận cọc', { confirmed: true, hasSignatureStep: true, hasSignatureFile: true, depositRequested: true, depositPaid: true }],
  ['Đã xác nhận + báo sẵn sàng giao', { confirmed: true, hasSignatureStep: true, hasSignatureFile: true, deliveryReady: true }],
  ['Đã nhập kho', { confirmed: true, hasSignatureStep: true, hasSignatureFile: true, depositRequested: true, received: true }],
];
const actors: [string, WorkflowActor][] = [
  ['Manager', { id: 'm', role: 'manager', active: true, positionId: 'manager' }],
  ['Nhân viên', { id: 'e', role: 'employee', active: true, positionId: 'sale' }],
  ['NCC của đơn', { id: 'n1', role: 'supplier', active: true, positionId: 'supplier', supplierId: 'S1' }],
  ['NCC khác', { id: 'n2', role: 'supplier', active: true, positionId: 'supplier', supplierId: 'S2' }],
];
const stageName = { pending_approval: 'chờ duyệt', awaiting_confirmation: 'chờ NCC xác nhận', confirmed: 'đã xác nhận', received: 'đã nhập kho' } as const;
let md = `# Ai bấm được nút nào trên đơn NCC\n\n> File này được **sinh tự động** từ \`src/modules/suppliers/domain/workflow.ts\` (\`npm run docs:ncc\`). Đừng sửa tay.\n> Luật mặc định: ${Object.entries(DEFAULT_RULES).map(([k, v]) => `\`${k}\`=${v}`).join(', ')}.\n\n`;
md += `| Trạng thái đơn | Giai đoạn | ${actors.map(a => a[0]).join(' | ')} |\n|---|---|${actors.map(() => '---').join('|')}|\n`;
for (const [name, o] of states) {
  const f = { ...base, ...o };
  md += `| ${name} | ${stageName[orderStage(f)]} | ${actors.map(([, a]) => nextActions(a, f).map(x => LABEL[x]).join(', ') || '—').join(' | ')} |\n`;
}
writeFileSync(new URL('../docs/NCC-ACTIONS.md', import.meta.url), md);
console.log('docs/NCC-ACTIONS.md');
