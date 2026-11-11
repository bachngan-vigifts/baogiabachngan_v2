import { orderNotesFromQuote, orderDeliveryAddress, syncOrderDeliveryNotes, orderRecipient } from './order-notes.js';
/** Open the business form first. Sapo is contacted only after submitting with its creation option enabled. */
export function initOrderCreate({ api, $, todayIso, chooseSapo, confirmBox, createSourcing, createProductionFiles }) {
  const dialog = $('#order-create-dialog'), form = $('#order-create-form'), submit = $('#order-create-submit');
  const status = $('#order-create-status'), error = $('#order-create-error');
  let current = null;
  dialog.addEventListener('close', () => { const c = current; current = null; c?.resolve(null); });
  async function choose(ref, run) {
    current?.resolve(null);
    const me = current = { ref, run, busy: false, ready: false, resolve: () => {} };
    const result = new Promise(resolve => { me.resolve = resolve; });
    form.reset(); form.elements.orderDate.value = todayIso(); form.elements.orderNo.dataset.auto = ''; error.textContent = '';
    $('#order-create-quote').textContent = ref.quoteNo || 'báo giá'; status.textContent = 'Đang lấy thông tin báo giá…'; submit.disabled = true;
    if (!dialog.open) dialog.showModal();
    try {
      const [q, config] = await Promise.all([
        api('/quotes/' + encodeURIComponent(ref.quoteId)),
        api('/orders/create-config').catch(e => { throw new Error(e.status === 404 ? 'API sinh đơn đang cập nhật. Vui lòng mở lại form sau.' : e.message); }),
      ]);
      if (current !== me) return result;
      if (config.version !== 2 || config.noteMaxLength !== 20000 || config.recipientFields !== true) throw new Error('API chưa hỗ trợ form sinh đơn mới. Vui lòng tải lại sau.');
      $('#order-create-quote').textContent = [q.data.quoteNo || ref.quoteNo, q.data.customer].filter(Boolean).join(' · ');
      form.elements.customerName.value = q.data.customer || ref.customer || '';
      const recipient = orderRecipient(q.data);
      form.elements.receiverName.value = recipient.receiverName;
      form.elements.receiverPhone.value = recipient.receiverPhone;
      form.elements.deliveryDate.value = q.data.deliveryDate || '';
      form.elements.deliveryAddress.value = orderDeliveryAddress(q.data);
      form.elements.note.value = orderNotesFromQuote(q.data);
      me.source = q.data;
      // Nguồn hàng và số đơn tải song song (trước đây nối tiếp: thêm một lượt chờ mới bấm được Sinh đơn hàng).
      const [sourcing,production] = await Promise.all([createSourcing ? createSourcing({host:$('#order-create-sourcing'),quoteId:ref.quoteId,isCurrent:()=>current===me}) : null, createProductionFiles?createProductionFiles({host:$('#order-create-production-files'),quoteId:ref.quoteId,isCurrent:()=>current===me}):null, previewOrderNo(me)]);
      if (sourcing) me.sourcing = sourcing; me.production=production;
      if(current!==me)return result;
      me.ready = true; submit.disabled = false; status.textContent = '';
    } catch (e) { if (current === me) { error.textContent = e.message; status.textContent = ''; } }
    return result;
  }
  async function previewOrderNo(me = current) {
    if (!me) return;
    const input = form.elements.orderNo, untouched = !input.value.trim() || input.value === input.dataset.auto;
    try {
      const r = await api(`/orders/next-no?quoteId=${encodeURIComponent(me.ref.quoteId)}&orderDate=${encodeURIComponent(form.elements.orderDate.value)}`);
      if (current !== me) return;
      input.placeholder = r.error || 'Nhập số đơn hàng';
      if (untouched || !input.value.trim()) input.value = r.orderNo || '';
      input.dataset.auto = r.orderNo || '';
    } catch { input.placeholder = 'Nhập số đơn hàng'; }
  }
  const syncDelivery = key => {
    if (!current?.ready || current.busy) return;
    form.elements.note.value = syncOrderDeliveryNotes(form.elements.note.value, { [key]: form.elements[key].value }, current.source);
  };
  form.elements.deliveryDate.addEventListener('change', () => syncDelivery('deliveryDate'));
  form.elements.deliveryAddress.addEventListener('change', () => syncDelivery('deliveryAddress'));
  form.elements.orderDate.addEventListener('change', () => previewOrderNo());
  form.addEventListener('submit', async e => {
    e.preventDefault(); const me = current; if (!me?.ready || me.busy || !form.reportValidity()) return;
    const orderNo = form.elements.orderNo.value.trim(), customerName = form.elements.customerName.value.trim();
    let sourcing;try{sourcing=me.sourcing?.read()||{};}catch(ex){error.textContent=ex.message;return;}
    if (!await confirmBox(`Xác nhận sinh đơn hàng?\n\nSố đơn: ${orderNo}\nKhách hàng: ${customerName}`, { title: 'Xác nhận sinh đơn hàng', ok: 'Xác nhận sinh đơn' })) return;
    me.busy = true; submit.disabled = true; error.textContent = '';
    const fields = { orderNo, receiverName: form.elements.receiverName.value, receiverPhone: form.elements.receiverPhone.value, orderDate: form.elements.orderDate.value, deliveryDate: form.elements.deliveryDate.value, deliveryAddress: form.elements.deliveryAddress.value, note: form.elements.note.value };
    try {
      if(me.sourcing?.prepare)sourcing=await me.sourcing.prepare();
      if(me.production)Object.assign(fields,await me.production.prepare());
      if(current!==me)return;
      Object.assign(fields,sourcing,{note:[fields.note,sourcing.note].filter(Boolean).join('\n\n')});
      const push = form.elements.pushSapo.value === 'yes'; submit.textContent = push ? 'Đang sinh đơn hàng + đơn Sapo…' : 'Đang sinh đơn hàng…';
      const r = push ? await chooseSapo({ quoteId: me.ref.quoteId }, { title: 'Sinh đơn hàng', action: 'Sinh đơn hàng + đơn Sapo', pushSapo: true, isCurrent: () => current === me, run: (loc, enabled) => me.run(fields, loc, enabled) })
        : await me.run(fields, null, false);
      if (current !== me || !r) return;
      current = null; dialog.close(); me.resolve(r);
    } catch (e) { if (current === me) error.textContent = e.message; }
    finally { if (current === me) { me.busy = false; submit.disabled = false; } submit.textContent = 'Sinh đơn hàng'; }
  });
  return { choose };
}
