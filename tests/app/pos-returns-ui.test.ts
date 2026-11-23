import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore DOM injected by browser
import { openPosReturns } from '../../trial-ui/pos-returns.js';
// @ts-ignore DOM-only print
import { buildPosPrint } from '../../trial-ui/pos-print.js';
class El {
  children: El[] = [];
  text = '';
  value: any = '';
  checked = false;
  disabled = false;
  open = false;
  dataset: any = {};
  onclick: any;
  oninput: any;
  tag: string;
  className = '';
  constructor(tag: string) {
    this.tag = tag;
  }
  set textContent(s: string) {
    this.text = String(s);
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  append(...xs: El[]) {
    this.children.push(...xs);
  }
  replaceChildren(...xs: El[]) {
    this.children = xs;
    this.text = '';
  }
  setAttribute() {}
  addEventListener() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  remove() {}
  focus() {}
  querySelectorAll(s: string): El[] {
    const xs = this.children.flatMap((c) => [c, ...c.querySelectorAll('*')]);
    return s === '*' ? xs : xs.filter((c) => s.split(',').includes(c.tag));
  }
}
const doc = {
  body: new El('body'),
  createElement: (tag: string) => new El(tag),
};
const button = (root: El, text: string) =>
  root.querySelectorAll('button').find((b) => b.textContent === text)!;
const input = (root: El, label: string) =>
  root
    .querySelectorAll('label')
    .find((b) => b.children[0]?.textContent === label)!.children[1]!;
test('UI trả hàng: chỉ gửi yêu cầu, phí mặc định 0, không tự nhập kho/hoàn; nội dung độc hại in là chữ', async () => {
  const old = (globalThis as any).document;
  (globalThis as any).document = doc;
  doc.body = new El('body');
  try {
    const calls: any[] = [],
      errors: string[] = [];
    const d = {
      order: {
        id: 'o',
        orderNo: 'POS_1',
        customerName: '<img src=x onerror=1>',
        total: 108000,
      },
      registerId: 'r',
      lines: [{ id: 'l', name: 'Ly sứ', deliveredQty: 1 }],
      returns: [],
      account: {
        credit: 0,
        refunded: 0,
        exchanged: 0,
        balance: 0,
        available: 0,
      },
      viewerId: 'emp',
    };
    await openPosReturns({
      api: async (path: string, method: string, body: any) => {
        calls.push({ path, method, body });
        return method === 'POST' ? {} : d;
      },
      toast: (s: string) => errors.push(s),
      orderId: 'o',
      shift: { id: 's', registerId: 'r' },
      register: { id: 'r' },
    });
    const dialog = doc.body.children[0]!;
    assert.ok(dialog.textContent.includes(d.order.customerName));
    assert.equal(dialog.querySelectorAll('img').length, 0);
    input(dialog, 'Ly sứ · Còn được trả 1').value = '1';
    input(dialog, 'Lý do đổi/trả (bắt buộc)').value = 'Không vừa';
    await button(dialog, 'Gửi yêu cầu duyệt').onclick();
    const post = calls.find((x) => x.method === 'POST');
    assert.equal(post.path, '/pos/returns');
    assert.equal(post.body.serviceFee, 0);
    assert.equal(post.body.shippingFee, 0);
    assert.equal(post.body.lines[0].qty, '1');
    assert.equal(calls.filter((x) => x.method === 'POST').length, 1);
    const print = buildPosPrint(
      doc,
      {
        order: d.order,
        return: {
          returnNo: 'TH_1',
          reason: '<script>alert(1)</script>',
          lines: [{ name: 'Ly sứ', requestedQty: 1, total: 108000 }],
          approvedServiceFee: 0,
          approvedShippingFee: 0,
          total: 108000,
          refunds: [],
        },
      },
      'return',
    );
    assert.ok(print.textContent.includes('<script>alert(1)</script>'));
    assert.equal(print.querySelectorAll('script').length, 0);
    assert.ok(print.textContent.includes('không đồng nghĩa đã hoàn tiền'));
  } finally {
    (globalThis as any).document = old;
  }
});
test('UI hoàn tiền: cần xác nhận thực trả, giữ cùng key để retry, không tự gửi khi mở phiếu', async () => {
  const old = (globalThis as any).document;
  (globalThis as any).document = doc;
  doc.body = new El('body');
  try {
    const posts: any[] = [];
    let show = 0;
    const d = {
      order: { id: 'o', orderNo: 'POS_1', total: 100000 },
      registerId: 'r',
      lines: [],
      returns: [
        {
          id: 'ret',
          returnNo: 'TH_1',
          status: 'processing',
          reason: 'Trả',
          createdBy: 'emp',
          receivedAt: 'now',
          lines: [],
          refunds: [],
          allocations: [],
          total: 100000,
        },
      ],
      account: {
        credit: 100000,
        refunded: 0,
        exchanged: 0,
        balance: -100000,
        available: 100000,
      },
      viewerId: 'emp',
    };
    await openPosReturns({
      api: async (path: string, method: string, body: any) => {
        if (method === 'POST') {
          posts.push({ path, body });
          throw Error('Mạng chập chờn');
        }
        show++;
        return d;
      },
      toast: () => {},
      orderId: 'o',
      shift: { id: 's', registerId: 'r' },
      register: { id: 'r' },
    });
    const dialog = doc.body.children[0]!;
    assert.equal(posts.length, 0);
    const b = button(dialog, 'Xác nhận đã hoàn tiền');
    await b.onclick();
    assert.equal(posts[0].body.confirmed, false);
    input(dialog, 'Tôi xác nhận đã thực trả số tiền này cho khách').checked =
      true;
    await b.onclick();
    await b.onclick();
    assert.equal(posts[1].body.confirmed, true);
    assert.equal(posts[1].body.key, posts[2].body.key);
    assert.equal(show, 1);
  } finally {
    (globalThis as any).document = old;
  }
});
test('UI trả hàng: mở từ trang đơn (ca của quầy khác) vẫn lập được yêu cầu mới sau khi yêu cầu cũ bị từ chối', async () => {
  const old = (globalThis as any).document;
  (globalThis as any).document = doc;
  try {
    const d = (current: any) => ({
      order: { id: 'o', orderNo: 'POS_1', customerName: 'Anh Khánh', total: 100000 },
      registerId: 'r', registerName: 'Quầy 1',
      lines: [{ id: 'l', name: 'Ly sứ', deliveredQty: 1 }],
      returns: [{ id: 'old', returnNo: 'TH_1', status: 'rejected', reason: 'Nhập sai tiền', createdBy: 'emp', lines: [{ orderLineId: 'l', requestedQty: 1 }], refunds: [], allocations: [] }],
      account: { credit: 0, refunded: 0, exchanged: 0, balance: 100000, available: 0 },
      viewerId: 'emp', current,
    });
    const open = async (current: any) => {
      doc.body = new El('body');
      const asked: string[] = [];
      await openPosReturns({
        api: async (path: string) => {
          asked.push(path);
          if (path.startsWith('/pos/options')) return { current };
          return d(current);
        },
        toast: () => {}, orderId: 'o',
        shift: { id: 'other', registerId: 'r2' }, register: { id: 'r2' },
      });
      return { dialog: doc.body.children[0]!, asked };
    };
    const ok = await open({ id: 's', registerId: 'r' });
    assert.ok(ok.asked.includes('/pos/options?registerId=r'), 'hỏi ca theo quầy của bill');
    assert.ok(button(ok.dialog, 'Gửi yêu cầu duyệt'), 'yêu cầu bị từ chối không chặn lập yêu cầu mới');
    assert.ok(input(ok.dialog, 'Ly sứ · Còn được trả 1'), 'số lượng của yêu cầu bị từ chối được trả lại');
    const none = await open(null);
    assert.equal(button(none.dialog, 'Gửi yêu cầu duyệt'), undefined);
    assert.match(none.dialog.textContent, /Chưa có ca đang mở ở quầy của bill này \(Quầy 1\)/);
  } finally {
    (globalThis as any).document = old;
  }
});

async function approvalFeeFixture(manager: boolean, fees: boolean) {
  doc.body = new El('body');
  const calls: any[] = [], confirmations: any[] = [], errors: string[] = [];
  let accept = false;
  const r: any = {id:'fee-review',returnNo:'TH-FEE',status:'pending',createdBy:'emp',reason:'Trả hàng',requestContext:'after_delivery',lines:[],refunds:[],allocations:[],requestedServiceFee:fees?10800:0,requestedShippingFee:fees?20000:0,approvedServiceFee:0,approvedShippingFee:0,total:108000};
  const d: any = {order:{id:'fee-order',orderNo:'POS-FEE',customerName:'Khách kiểm thử',total:138800,posSnapshot:'{}'},registerId:'r',lines:[],returns:[r],account:{credit:0,refunded:0,exchanged:0,balance:0,available:0},viewerId:manager?'mgr':'delegated',canApprove:true,manager};
  await openPosReturns({api:async(path:string,method='GET',body?:any)=>{if(method==='POST'){calls.push({path,body});r.status='approved';r.approvedServiceFee=Number(body.serviceFee);r.approvedShippingFee=Number(body.shippingFee);}return d;},toast:(s:string)=>errors.push(s),orderId:'fee-order',shift:{id:'s',registerId:'r'},register:{id:'r'},confirmBox:async(message:string,options:any)=>{confirmations.push({message,options});return accept;}});
  return {dialog:doc.body.children[0]!,calls,confirmations,errors,accept:()=>{accept=true;}};
}

test('delegated fee approval warns once, cancellation sends nothing and confirmation explicitly approves zero fees',async()=>{
 const old=(globalThis as any).document;(globalThis as any).document=doc;
 try{
  const f=await approvalFeeFixture(false,true),text=f.dialog.textContent;
  assert.equal((text.match(/Chỉ Manager được hoàn phí dịch vụ\/ship/g)||[]).length,1);
  assert.doesNotMatch(text,/đang chờ quyết định của Manager/);
  await button(f.dialog,'Duyệt yêu cầu').onclick();
  assert.equal(f.confirmations.length,1);assert.equal(f.calls.length,0,'cancellation must not send an approval');
  assert.match(f.confirmations[0].message,/phí hoàn = 0 đ/);assert.match(f.confirmations[0].message,/không duyệt lại được/);
  assert.match(f.confirmations[0].message,/10.800 đ/);assert.match(f.confirmations[0].message,/20.000 đ/);
  assert.equal(f.confirmations[0].options.ok,'Duyệt, không hoàn phí');
  f.accept();await button(f.dialog,'Duyệt yêu cầu').onclick();
  assert.equal(f.calls.length,1);assert.equal(Number(f.calls[0].body.serviceFee),0);assert.equal(Number(f.calls[0].body.shippingFee),0);assert.deepEqual(f.errors,[]);
 }finally{(globalThis as any).document=old;}
});

test('no-fee delegated approval has no Manager fee note or extra confirmation',async()=>{
 const old=(globalThis as any).document;(globalThis as any).document=doc;
 try{const f=await approvalFeeFixture(false,false);assert.doesNotMatch(f.dialog.textContent,/Chỉ Manager được hoàn phí|chờ quyết định của Manager/);assert.match(f.dialog.textContent,/Không đề nghị hoàn phí/);await button(f.dialog,'Duyệt yêu cầu').onclick();assert.equal(f.confirmations.length,0);assert.equal(f.calls.length,1);assert.deepEqual(f.errors,[]);}finally{(globalThis as any).document=old;}
});

test('Manager keeps proposal defaults and max limits without the delegated fee warning',async()=>{
 const old=(globalThis as any).document;(globalThis as any).document=doc;
 try{const f=await approvalFeeFixture(true,true);assert.doesNotMatch(f.dialog.textContent,/Chỉ Manager được hoàn phí dịch vụ\/ship|đang chờ quyết định của Manager/);assert.equal(input(f.dialog,'Phí dịch vụ được hoàn').value,10800);assert.equal(input(f.dialog,'Phí ship được hoàn').value,20000);await button(f.dialog,'Duyệt yêu cầu').onclick();assert.equal(f.confirmations.length,0);assert.equal(f.calls[0].body.shippingFee,20000);assert.deepEqual(f.errors,[]);}finally{(globalThis as any).document=old;}
});
