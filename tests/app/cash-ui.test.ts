import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore browser module renders only through the injected DOM.
import { initCash } from '../../trial-ui/cash.js';
class E {
  children: E[] = [];
  className = '';
  text = '';
  value: any = '';
  type = '';
  attributes: Record<string,string> = {};
  setAttribute(k:string,v:string) { this.attributes[k]=v; }
  disabled = false;
  listeners = new Map<string, Function[]>();
  constructor(public tag: string) {}
  set textContent(v: string) {
    this.text = String(v);
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((e) => e.textContent).join('');
  }
  append(...nodes: E[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: E[]) {
    this.children = nodes;
    this.text = '';
  }
  addEventListener(event: string, fn: Function) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), fn]);
  }
  querySelector(s: string): E | undefined {
    return this.all().find((e) => (s.startsWith('.') ? e.className.split(' ').includes(s.slice(1)) : e.tag === s));
  }
  all(): E[] {
    return this.children.flatMap((e) => [e, ...e.all()]);
  }
  showModal() {}
  close() {}
  remove() {}
}
test('Cash UI: dữ liệu phiếu chỉ là chữ, phiếu huỷ gạch ngang và Excel dùng đúng bảng đang xem', async () => {
  const previous = globalThis.document;
  const doc = { createElement: (tag: string) => new E(tag), body: new E('body') };
  Object.assign(globalThis, { document: doc });
  try {
    const root = new E('section'),
      hostile = '<img src=x onerror=alert(1)>',
      calls: string[] = [];
    const ui = initCash({
      root,
      user: () => ({ id: 'emp' }),
      toast: () => {},
      go: () => {},
      api: async (path: string) => {
        calls.push(path);
        if (path === '/cash')
          return {
            drawer: { openingSetAt: '2026-10-18', approvalThreshold: 1000000 },
            balance: 500000,
            activeShift: null,
            ownShift: null,
            canManage: false,
            canVoid: false,
            openReconciliations: 0,
            updatedAt: '2026-10-18T01:00:00Z',
          };
        return {
          entries: [
            {
              id: '1',
              entryNo: 'PT-1',
              at: '2026-10-18T01:00:00Z',
              kind: 'other_income',
              direction: 'in',
              amount: 100,
              reason: hostile,
              by: 'NV',
              status: 'voided',
              voidReason: 'Nhập trùng',
            },
          ],
          nextBefore: null,
        };
      },
    });
    await ui.load();
    assert.match(root.textContent, /<img src=x/);
    assert.ok(!root.all().some((e) => e.tag === 'img' || e.tag === 'script'));
    assert.ok(root.all().some((e) => e.className === 'cash-voided'));
    assert.ok(root.all().some((e) => e.textContent === 'Xuất Excel bảng đang xem'));
    // Chưa có ca của mình: nút không khoá im lặng mà đánh dấu khoá + có dòng giải thích (bấm thì báo lý do).
    const actions = root.all().filter((e) => ['+ Thu tiền', '+ Chi tiền', 'Kết ca'].includes(e.textContent));
    assert.equal(actions.length, 3);
    assert.ok(actions.every((e) => e.className.includes('cash-action-blocked')));
    assert.match(root.textContent, /Mở ca tại Bán hàng nhanh|Chỉ người mở ca/);
    assert.match(calls[1]!, /from=.*&to=/);
  } finally {
    Object.assign(globalThis, { document: previous });
  }
  const source = readFileSync('trial-ui/cash.js', 'utf8');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage/);
  assert.match(source, /downloadExcel/);
  assert.match(source, /reasonCode/);
  assert.match(source, /pendingEntries/);
});

test('Cash UI: người được chỉ định có nút duyệt phiếu người khác, không có nút tự duyệt hoặc quản trị két', async () => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new E(tag), body: new E('body') } });
  try {
    const root = new E('section'), calls: string[] = [];
    const ui = initCash({ root, user: () => ({ id: 'delegate' }), toast: () => {}, go: () => {},
      api: async (path: string) => {
        calls.push(path);
        if (path.endsWith('/approve')) return { ok: true };
        if (path === '/cash') return {
          drawer: { openingSetAt: '2026-10-18', approvalThreshold: 1000000 }, balance: 500000,
          activeShift: null, ownShift: null, canManage: false, canApprove: true, canVoid: false,
          openReconciliations: 0, updatedAt: '2026-10-18T01:00:00Z',
        };
        return { entries: ['other', 'delegate'].map((createdBy, i) => ({
          id: String(i), entryNo: 'PT-' + i, at: '2026-10-18T01:00:00Z', kind: 'other_income',
          direction: 'in', amount: 1000000, reason: 'Thu tiền', createdBy, by: createdBy, status: 'pending',
        })), nextBefore: null };
      },
    });
    await ui.load();
    const buttons = root.all().filter(e => e.tag === 'button' && e.textContent === 'Duyệt');
    assert.equal(buttons.length, 1);
    assert.ok(!root.all().some(e => e.tag === 'button' && e.textContent === 'Cấu hình két'));
    await buttons[0]!.listeners.get('click')![0]!();
    assert.ok(calls.includes('/cash/entries/0/approve'));
  } finally { Object.assign(globalThis, { document: previous }); }
});

test('Cash UI: Manager có nút Duyệt cho phiếu mình tạo theo cờ server', async () => {
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new E(tag), body: new E('body') } });
  try {
    const root = new E('section'), calls: string[] = [];
    const ui = initCash({ root, user: () => ({ id: 'mgr' }), toast: () => {}, go: () => {},
      api: async (path: string) => {
        calls.push(path);
        if (path.endsWith('/approve')) return { ok: true };
        if (path === '/cash') return {
          drawer: { openingSetAt: '2026-10-19', approvalThreshold: 1000000 }, balance: 0,
          activeShift: null, ownShift: null, canManage: true, canApprove: true, canSelfApprove: true, canVoid: true,
          openReconciliations: 0, updatedAt: '2026-10-19T01:00:00Z',
        };
        return { entries: [{ id: 'own', entryNo: 'PT-1', at: '2026-10-19T01:00:00Z', kind: 'adjustment',
          direction: 'in', amount: 1000000, reason: 'Điều chỉnh', createdBy: 'mgr', by: 'Manager', status: 'pending' }], nextBefore: null };
      },
    });
    await ui.load();
    const approve = root.all().find(e => e.tag === 'button' && e.textContent === 'Duyệt');
    assert.ok(approve);
    await approve.listeners.get('click')![0]!();
    assert.ok(calls.includes('/cash/entries/own/approve'));
  } finally { Object.assign(globalThis, { document: previous }); }
});


test('Cash UI accepts a custom name and opens a notified entry in its exact drawer',async()=>{
 const previous=globalThis.document, prevLocation=globalThis.location;
 const doc={createElement:(tag:string)=>new E(tag),body:new E('body')};
 Object.assign(globalThis,{document:doc,location:{hash:'#/cash'}});
 try {
  const root=new E('section'), writes:any[]=[],calls:string[]=[];
  const receipt={id:'entry-a',entryNo:'PC-1',direction:'out',kind:'petty_expense',amount:1500000,reason:'Tên phiếu: Chi sửa xe\n\nBảo trì xe',createdBy:'creator',at:'2026-10-20T01:00:00Z',status:'pending'};
  const api=async(path:string,method?:string,body?:any)=>{
   calls.push(path);
   if(method==='POST'){writes.push({path,body});return receipt;}
   if(path.startsWith('/cash/entries/entry-a'))return {entry:receipt};
   if(path.startsWith('/cash/entries'))return {entries:[],nextBefore:null};
   return {drawer:{id:'drawer-a',openingSetAt:'2026-10-18',approvalThreshold:1000000},balance:500000,activeShift:{id:'s',mine:true},ownShift:{id:'s'},canSell:true,canApprove:true,canManage:false,canSelfApprove:false};
  };
  const ui=initCash({root,api,user:()=>({id:'emp'}),toast(){},go(){}});await ui.load();
  root.all().find(e=>e.tag==='button'&&e.textContent==='+ Chi tiền')!.listeners.get('click')![0]!();
  let modal=doc.body.children.at(-1)!;
  const name=modal.all().find(e=>e.tag==='label'&&e.textContent==='Tên phiếu')!.querySelector('input')!;
  assert.equal(name.type,'text');name.value='Chi sửa xe';
  modal.all().find(e=>e.tag==='input'&&e.type==='number')!.value='1500000';modal.querySelector('textarea')!.value='Bảo trì xe';
  modal.querySelector('form')!.listeners.get('submit')![0]!({preventDefault(){}});await new Promise(r=>setTimeout(r,0));
  assert.equal(writes[0].body.entryName,'Chi sửa xe');assert.equal(writes[0].body.kind,'petty_expense');
  Object.assign(globalThis,{location:{hash:'#/cash?drawerId=drawer-a&entryId=entry-a'}});await ui.load();
  assert.ok(calls.includes('/cash/entries/entry-a?drawerId=drawer-a'));
  modal=doc.body.children.at(-1)!;assert.match(modal.textContent,/Chi sửa xe/);
  const approve=modal.all().find(e=>e.tag==='button'&&e.textContent==='Duyệt phiếu')!;assert.ok(approve);
  await approve.listeners.get('click')![0]!();await new Promise(r=>setTimeout(r,0));
  assert.ok(writes.some(x=>x.path==='/cash/entries/entry-a/approve?drawerId=drawer-a'));
 } finally {Object.assign(globalThis,{document:previous,location:prevLocation});}
});

test('Cash ledger employee/payment filters reset cursor, keep scoped options and display server totals', async () => {
  const previous = globalThis.document, doc = { createElement: (tag: string) => new E(tag), body: new E('body') };
  Object.assign(globalThis, { document: doc });
  try {
    const root = new E('main'), calls: string[] = [];
    const ui = initCash({ root, user: () => ({ id: 'emp' }), toast(message: string) { throw Error(message); }, go() {}, api: async (path: string) => {
      calls.push(path);
      if (path === '/cash') return { drawer: { id: 'store', openingSetAt: '2026-01-01' }, balance: 100, openReconciliations: 0 };
      const query = new URL('https://test' + path).searchParams;
      return { employees: [{ id: 'emp', name: 'Nguyễn A' }, { id: 'other', name: '<img src=x>' }],
        entries: [{ id: 'e1', entryNo: 'PT-1', at: '2026-10-21T01:00:00Z', kind: 'sale', direction: 'in', amount: 20, createdBy: 'emp', by: 'Nguyễn A', status: 'posted', method: query.get('method') === 'transfer' ? 'transfer' : 'cash' }],
        nextBefore: query.has('before') ? null : '2026-10-21T00:00:00Z|e1', totals: { in: query.get('method') === 'transfer' ? 700 : 1000, out: 0, net: 1000 } };
    } });
    const settle = () => new Promise(r => setImmediate(r));
    const change = async (label: string, value: string) => { const control = root.all().find(e => e.tag === 'label' && e.children[0]?.textContent === label)!.children[1]!; control.value = value; control.listeners.get('change')![0]!(); await settle(); };
    await ui.load(); assert.match(calls.at(-1)!, /method=cash/);
    root.all().find(e => e.tag === 'button' && e.textContent === 'Xem thêm')!.listeners.get('click')![0]!(); await settle(); assert.match(calls.at(-1)!, /before=/);
    await change('Nhân viên', 'other'); assert.match(calls.at(-1)!, /createdBy=other/); assert.doesNotMatch(calls.at(-1)!, /before=/);
    await change('Hình thức thanh toán', 'transfer'); assert.match(calls.at(-1)!, /method=transfer/); assert.match(root.textContent, /700 đ/);
    root.all().find(e => e.tag === 'button' && e.textContent === 'Phiếu chi')!.listeners.get('click')![0]!(); await settle(); assert.match(calls.at(-1)!, /direction=out/);
    const tools = root.all().find(e => e.className === 'cash-tools cash-ledger-tools')!;
    assert.ok(tools.children.some(e => e.tag === 'button' && e.textContent === 'Xuất Excel bảng đang xem'));
    assert.ok(root.all().some(e => e.tag === 'option' && e.textContent === '<img src=x>'));
    assert.ok(!root.all().some(e => e.tag === 'img'));
  } finally { Object.assign(globalThis, { document: previous }); }
});
