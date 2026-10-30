import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
class Element {
  children: Element[] = []; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; own = ''; className = ''; href = ''; events: Record<string, Function> = {};
  constructor(readonly tagName: string) {}
  set innerHTML(_: string) { throw new Error('Server data must never use innerHTML'); }
  set textContent(value: string) { this.own = String(value); this.children = []; }
  get textContent(): string { return this.own + this.children.map(e => e.textContent).join(' '); }
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(k: string, f: Function) { this.events[k] = f; }
}
function fixture() {
  const ctx: any = { document: { createElement: (tag: string) => new Element(tag) }, Intl, Date, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../../trial-ui/web-order-financials.js', import.meta.url), 'utf8').replace(/export /g, ''), ctx);
  vm.runInContext(readFileSync(new URL('../../trial-ui/accounting-tasks.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), ctx);
  return ctx;
}
const nodes = (e: Element): Element[] => [e, ...e.children.flatMap(nodes)];
test('Kế toán UI: KPI lấy số API và banner ẩn khi rỗng, hiện số còn tồn và link đúng nguồn', () => {
  const c = fixture();
  const box: Element = c.accountingKpis({ kpis: { invoices: { count: 7, overdue: 2 }, purchases: { count: 3, amount: 1234567, overdue: 1 }, debts: { count: 4, amount: 9876543 }, unclaimed: 5 } });
  assert.equal(box.children.length, 4); assert.match(box.textContent, /1\.234\.567 đ/); assert.match(box.textContent, /9\.876\.543 đ/); assert.match(box.textContent, /3 kỳ/);
  assert.equal(c.accountingWarning([]), null);
  const alert: Element = c.accountingWarning([{ title: '<img onerror=alert(1)>', source: { kind: 'debt', docNo: 'ĐƠN-TEST', overdue: 1234, link: '#/orders/id-test', linkLabel: 'Mở đơn' } }]);
  assert.match(alert.textContent, /1 việc đã đóng tay/); assert.match(alert.textContent, /1\.234 đ/); assert.equal(nodes(alert).find(e => e.tagName === 'a')!.href, '#/orders/id-test');
});
test('Kế toán UI: đơn web không có link hiển thị nhãn/mã GHN, tên từ server chỉ là text; mobile giữ bảng 7 cột', () => {
  const c = fixture(), data = { today: '2026-10-20', tasks: [{ id: 'web', title: '<img src=x onerror=alert(1)>', due: 'today', dueDate: '2026-10-20', status: 'todo', priority: 'high', viewOnly: true, canClaim: false, sourceData: { kind: 'web', available: true, amount: 98765, docNo: 'WEB-TEST', ghnCode: 'GHN-TEST', link: 'javascript:alert(1)' } }] };
  const box: Element = c.accountingTable(data, () => {}, () => {});
  assert.match(box.textContent, /Không có link đơn/); assert.match(box.textContent, /GHN-TEST/); assert.match(box.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(nodes(box).some(e => e.tagName === 'img' || e.tagName === 'a'), false); assert.equal(nodes(box).some(e => e.tagName === 'button' && e.textContent === 'Nhận việc'), false);
  const mobile: Element = c.accountingTable(data, () => {}, () => {}, true);
  assert.equal(nodes(mobile).filter(e => e.tagName === 'thead')[0]!.children[0]!.children.length, 7);
});

test('cảnh báo dữ liệu nguồn: số thật, link NCC, trạng thái web, giờ Việt Nam; toàn bộ nội dung chỉ dùng DOM text', () => {
  const c = fixture();
  assert.equal(c.accountingSourceWarnings(), null);
  assert.equal(c.accountingSourceWarnings({ purchases: { count: 0 }, web: { count: 0 } }), null);
  const box: Element = c.accountingSourceWarnings({ purchases: { count: 2, orderCount: 1, orders: [{ docNo: '<img onerror=x>', missingPeriods: 2, link: '#/purchases/BUY', linkLabel: 'Bổ sung hạn trả' }] }, web: { count: 3, missingCode: 1, missingStatus: 1, delivered: 1, orders: [
    { docNo: 'WEB-1', source: 'lock', issue: 'missing_code', updatedAt: '2026-10-20T06:52:01' },
    { docNo: 'WEB-2', source: 'minhlong', issue: 'missing_status', ghnCode: '<script>x</script>', updatedAt: 'invalid' },
    { docNo: 'WEB-3', source: 'lock', issue: 'delivered', ghnCode: 'GHN-3', ghnStatus: 'delivered', updatedAt: '2026-10-20T06:52:01Z' },
  ] } });
  assert.match(box.textContent, /2 kỳ · 1 đơn mua/); assert.match(box.textContent, /Chưa có mã vận đơn/); assert.match(box.textContent, /Chưa nhận trạng thái GHN/); assert.match(box.textContent, /Đã giao thành công/);
  assert.match(box.textContent, /13:52/); assert.match(box.textContent, /Chưa có mốc cập nhật/); assert.match(box.textContent, /không phải thời điểm kiểm tra GHN/);
  assert.equal(nodes(box).filter(e => e.tagName === 'a').length, 1);
  assert.equal(nodes(box).find(e => e.tagName === 'a')!.href, '#/purchases/BUY');
  assert.equal(nodes(box).filter(e => e.tagName === 'details').length, 2);
  assert.equal(nodes(box).some(e => ['img', 'script'].includes(e.tagName)), false); assert.match(box.textContent, /<script>x<\/script>/);
});

test('làm ngay trên dòng việc: Ghi thu / Ghi số HĐ / Ghi trả NCC mở hộp nhỏ điền sẵn, gửi đúng API với mã chống lặp; việc chỉ xem / đã xong không có nút', async () => {
  const c = fixture();
  const debt = { id: 't1', title: 'Thu nợ', due: 'overdue', dueDate: '2026-10-20', status: 'todo', priority: 'high', revision: 1, canClaim: false,
    sourceData: { kind: 'debt', available: true, targetId: 'order-1', docNo: 'DH_001', overdue: 300000, balance: 500000, link: '#/orders/order-1', linkLabel: 'Mở đơn' } };
  assert.equal(c.quickActionFor(debt), 'Ghi thu');
  assert.equal(c.quickActionFor({ ...debt, sourceData: { ...debt.sourceData, kind: 'invoice' } }), 'Ghi số HĐ');
  assert.equal(c.quickActionFor({ ...debt, sourceData: { ...debt.sourceData, kind: 'purchase' } }), 'Ghi trả NCC');
  assert.equal(c.quickActionFor({ ...debt, viewOnly: true }), null, 'việc đồng nghiệp chỉ xem');
  assert.equal(c.quickActionFor({ ...debt, status: 'done' }), null);
  assert.equal(c.quickActionFor({ ...debt, sourceData: { ...debt.sourceData, kind: 'web' } }), null, 'đơn web chưa có thao tác');
  // Dựng trang thật với DOM giả: bấm "Ghi thu" → hộp điền sẵn số quá hạn → Lưu gửi /payments kèm mã.
  const body = new Element('body'); Object.assign(c.document, { body, activeElement: null });
  for (const k of ['showModal', 'close', 'remove', 'focus']) (Element.prototype as any)[k] ||= function (this: any) { if (k === 'close') this.events.close?.(); };
  (Element.prototype as any).replaceChildren ||= function (this: any, ...n: Element[]) { this.children = n; };
  const calls: any[] = [], root = new Element('div');
  const api = async (path: string, method?: string, b?: any) => { calls.push({ path, method, b }); return path.startsWith('/tasks/accounting') ? { today: '2026-10-29', tasks: [debt], tabs: { team: 1, mine: 0, colleagues: 0, closed_today: 0 }, kpis: { invoices: { count: 0, overdue: 0 }, purchases: { count: 0, amount: 0, overdue: 0 }, debts: { count: 1, amount: 300000 }, unclaimed: 0 }, warnings: [] } : { id: 'p1' }; };
  const board = c.initAccountingTasks({ root, api, toast() {}, userId: () => 'kt', back() {}, sendOnce: (_s: string, content: any, send: Function) => send('key-' + content.amount) });
  await board.load();
  const go = nodes(root).find(e => e.tagName === 'button' && e.textContent === 'Ghi thu')!; assert.ok(go, 'dòng nợ có nút Ghi thu');
  go.events.click!({ stopPropagation() {} });
  const dlg = body.children.find(e => e.tagName === 'dialog')!; assert.ok(dlg);
  const field = (name: string) => nodes(dlg).find(e => (e as any).name === name) as any;
  assert.equal(String(field('amount').value), '300000', 'điền sẵn số quá hạn');
  await nodes(dlg).find(e => e.tagName === 'form')!.events.submit!({ preventDefault() {} });
  const pay = calls.find(x => x.path === '/payments')!; assert.equal(pay.method, 'POST');
  assert.deepEqual([pay.b.key, pay.b.orderId, pay.b.amount, pay.b.method], ['key-300000', 'order-1', 300000, 'transfer']);
});

test('kiểm tra trước khi xuất HĐ và khung "Cần kiểm tra": cảnh báo đúng, chỉ dùng text, link chỉ tới chứng từ / sổ quỹ', () => {
  const c = fixture();
  assert.equal(c.invoiceChecks({ taxCode: '0312345678', orderStatus: 'delivered', invoiceMode: 'issue' }).length, 0);
  assert.equal(c.invoiceChecks({ taxCode: '0312345678-001', orderStatus: 'delivered' }).length, 0, 'MST chi nhánh hợp lệ');
  const w = c.invoiceChecks({ taxCode: '12AB', orderStatus: 'confirmed', invoiceMode: 'draft' }).join(' | ');
  assert.match(w, /không đúng dạng/); assert.match(w, /chưa giao xong/); assert.match(w, /bản nháp/);
  assert.match(c.invoiceChecks({ taxCode: '', orderStatus: 'delivered' })[0], /Chưa có MST/);
  assert.equal(c.accountingChecksBox({ duplicatePayments: [], staleInvoices: [], cashWithoutPhoto: null }), null, 'không có gì thì ẩn');
  const box: Element = c.accountingChecksBox({ duplicatePayments: [{ docNo: 'DH_1', customerName: '<b>x</b>', count: 2, amount: 1000, paidAt: '2026-10-28', link: '#/orders/o1' }],
    staleInvoices: [{ docNo: 'HĐKT_1', customerName: 'A', days: 9, link: 'javascript:alert(1)' }], cashWithoutPhoto: [{ entryNo: 'PC1', amount: 2000000, reason: 'Sửa xe' }] });
  assert.match(box.textContent, /Thu trùng/); assert.match(box.textContent, /9 ngày/); assert.match(box.textContent, /chưa có ảnh/); assert.match(box.textContent, /<b>x<\/b>/);
  assert.equal(nodes(box).filter(e => e.tagName === 'a').map(e => e.href).join(','), '#/orders/o1,#/cash', 'link lạ không được gắn');
});

test('comment confirmation appends canonical text without refetching detail or losing newer typing',async()=>{
 const c=fixture(),body=new Element('body'),root=new Element('main'),calls:any[]=[];
 Object.assign(c.document,{body,activeElement:null});
 const task={id:'comment-task',title:'Trao đổi',status:'in_progress',priority:'normal',due:'none',canComment:true,viewOnly:false,sourceData:{available:false}};
 let finish!:Function;
 const api=async(path:string,method?:string,b?:any)=>{
  calls.push({path,method,b});
  if(method==='POST'){await new Promise(resolve=>{finish=resolve;});return{id:'c1',comment:{id:'c1',name:'Tên kế toán',body:'<img src=x onerror=alert(1)>',createdAt:'2026-10-30T01:00:00Z'}};}
  if(path==='/tasks/accounting/comment-task')return{task,today:'2026-10-30'};
  if(path.endsWith('/comments'))return{comments:[]};
  return{tasks:[task],tabs:{},kpis:{invoices:{count:0,overdue:0},purchases:{count:0,overdue:0,amount:0},debts:{count:0,amount:0},unclaimed:0},warnings:[]};
 };
 const errors:string[]=[];const board=c.initAccountingTasks({root,api,toast:(s:string)=>errors.push(s),userId:()=> 'kt',back(){}});await board.load(task.id);assert.deepEqual(errors,[]);
 const input:any=nodes(body).find(n=>n.tagName==='textarea'),comments:any=nodes(body).find(n=>n.className==='acct-comments');comments.isConnected=true;
 input.value='<img src=x onerror=alert(1)>';
 const start=calls.length;nodes(body).find(n=>n.tagName==='button'&&n.textContent==='Gửi trao đổi')!.events.click!({stopPropagation(){}});
 await Promise.resolve();input.value='Nội dung gõ tiếp';finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,start+1);assert.equal(calls[start].method,'POST');assert.equal(comments.children.length,1);assert.match(comments.textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(nodes(comments).some(n=>n.tagName==='img'),false);assert.equal(input.value,'Nội dung gõ tiếp');
});
