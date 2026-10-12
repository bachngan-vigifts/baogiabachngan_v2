/** Open the business form first. Sapo is contacted only after submitting with explicit opt-in. */
export function initOrderCreate({ api, $, todayIso, chooseSapo }) {
  const dialog = $('#order-create-dialog'), form = $('#order-create-form'), submit = $('#order-create-submit');
  const status = $('#order-create-status'), error = $('#order-create-error');
  let current = null;
  dialog.addEventListener('close', () => { const c = current; current = null; c?.resolve(null); });
  async function choose(ref, run) {
    current?.resolve(null);
    const me = current = { ref, run, busy: false, ready: false, resolve: () => {} };
    const result = new Promise(resolve => { me.resolve = resolve; });
    form.reset(); form.elements.orderDate.value = todayIso(); error.textContent = '';
    $('#order-create-quote').textContent = ref.quoteNo || 'báo giá'; status.textContent = 'Đang lấy thông tin báo giá…'; submit.disabled = true;
    if (!dialog.open) dialog.showModal();
    try {
      const [q, config] = await Promise.all([
        api('/quotes/' + encodeURIComponent(ref.quoteId)),
        api('/orders/create-config').catch(e => { throw new Error(e.status === 404 ? 'API sinh đơn đang cập nhật. Vui lòng mở lại form sau.' : e.message); }),
      ]);
      if (current !== me) return result;
      if (config.version !== 1 || config.noteMaxLength !== 20000) throw new Error('API chưa hỗ trợ form sinh đơn mới. Vui lòng tải lại sau.');
      $('#order-create-quote').textContent = [q.data.quoteNo || ref.quoteNo, q.data.customer].filter(Boolean).join(' · ');
      form.elements.deliveryDate.value = q.data.deliveryDate || '';
      form.elements.deliveryAddress.value = q.data.customerAddress || '';
      form.elements.note.value = q.data.notes || '';
      me.ready = true; submit.disabled = false; status.textContent = '';
    } catch (e) { if (current === me) { error.textContent = e.message; status.textContent = ''; } }
    return result;
  }
  form.addEventListener('submit', async e => {
    e.preventDefault(); const me = current; if (!me?.ready || me.busy || !form.reportValidity()) return;
    me.busy = true; submit.disabled = true; error.textContent = '';
    const fields = { orderDate: form.elements.orderDate.value, deliveryDate: form.elements.deliveryDate.value, deliveryAddress: form.elements.deliveryAddress.value, note: form.elements.note.value };
    try {
      const push = form.elements.pushSapo.value === 'yes'; submit.textContent = push ? 'Tiếp tục chọn kho Sapo…' : 'Đang sinh đơn hàng…';
      const r = push ? await chooseSapo({ quoteId: me.ref.quoteId }, { title: 'Sinh đơn hàng', action: 'Sinh đơn hàng + đơn Sapo', run: (loc, enabled) => me.run(fields, loc, enabled) })
        : await me.run(fields, null, false);
      if (current !== me || !r) return;
      current = null; dialog.close(); me.resolve(r);
    } catch (e) { if (current === me) error.textContent = e.message; }
    finally { if (current === me) { me.busy = false; submit.disabled = false; } submit.textContent = 'Sinh đơn hàng'; }
  });
  return { choose };
}
