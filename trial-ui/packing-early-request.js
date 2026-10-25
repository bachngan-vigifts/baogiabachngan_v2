/** Incoming goods are a request, never a packing allocation or an inventory receipt. */
export function initPackingEarlyRequest({ root, api, lines, parseNum, canRequest, toast }) {
  const attempts = new WeakMap();
  let busy = false;
  const sourceRows = () => [...root.querySelectorAll('.pack-src')];
  function sync(row) {
    const incoming = row.querySelector('[data-src]').value === 'incoming';
    const note = row.querySelector('[data-src-note]');
    note.hidden = incoming;
    note.disabled = incoming || busy;
    for (const input of row.querySelectorAll('[data-src], [data-src-qty], [data-src-del]')) input.disabled = busy;
    let actions = row.querySelector('[data-early-actions]');
    if (!actions) {
      actions = document.createElement('div');
      actions.dataset.earlyActions = '';
      actions.className = 'pack-early-actions';
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn secondary small';
      button.dataset.earlyCreate = ''; button.textContent = 'Xin giao trước';
      const hint = document.createElement('span');
      hint.className = 'muted small'; hint.textContent = 'Lưu phiếu nháp, chưa gửi NCC và chưa gửi kho.';
      const result = document.createElement('div'); result.dataset.earlyResult = '';
      result.setAttribute('role', 'status');
      actions.append(button, hint, result); row.append(actions);
    }
    actions.hidden = !incoming;
    const button = actions.querySelector('[data-early-create]');
    button.disabled = busy || !canRequest();
    button.title = canRequest() ? '' : 'Manager hoặc Sale Admin có quyền mua hàng mới được lập phiếu.';
  }
  root.addEventListener('change', e => {
    if (e.target.matches('[data-src]')) sync(e.target.closest('.pack-src'));
  });
  root.addEventListener('click', async e => {
    const button = e.target.closest('[data-early-create]');
    if (!button || busy || !canRequest()) return;
    const row = button.closest('.pack-src'), packLine = row.closest('.pack-line');
    const result = row.querySelector('[data-early-result]');
    try {
      const line = lines().find(l => l.id === packLine.dataset.line);
      const quantity = parseNum(row.querySelector('[data-src-qty]').value || '0');
      const need = parseNum(packLine.querySelector('[data-need]').value || '0');
      const warehouse = parseNum(packLine.querySelector('[data-wh]').value || '0');
      const other = [...packLine.querySelectorAll('.pack-src')].filter(r => r !== row)
        .reduce((sum, r) => sum + parseNum(r.querySelector('[data-src-qty]').value || '0'), 0);
      if (!line?.sku) throw Error('Dòng hàng chưa có mã sản phẩm để xin lấy trước.');
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw Error('Số lượng xin giao trước phải là số nguyên dương.');
      if (![need, warehouse, other].every(Number.isFinite) || warehouse < 0 || other < 0 || need > line.left + 1e-9 || quantity + warehouse + other > need + 1e-9)
        throw Error('Số lượng xin giao trước vượt phần hàng còn cần đóng.');
      const body = { lines: [{ sku: line.sku, quantity }], scope: { status: 'all' } };
      const fingerprint = JSON.stringify(body);
      let attempt = attempts.get(row);
      if (attempt && attempt.fingerprint !== fingerprint && attempt.request)
        throw Error('Phiếu nháp đã lưu. Mở phiếu để sửa số lượng trước khi tạo yêu cầu khác.');
      if (!attempt || attempt.fingerprint !== fingerprint) {
        attempt = { fingerprint, key: crypto.randomUUID() }; attempts.set(row, attempt);
      }
      busy = true; sourceRows().forEach(sync);
      result.textContent = 'Đang lưu phiếu nháp…';
      // Keep the same key after an uncertain network response so retry cannot duplicate the draft.
      const data = attempt.request ? { request: attempt.request } : await api('/purchase-early-requests', 'POST', { ...body, clientKey: attempt.key });
      attempt.request = data.request;
      const link = document.createElement('a');
      link.href = '#/purchases?mode=incoming&request=' + encodeURIComponent(data.request.id);
      link.textContent = 'Phiếu xin lấy trước — nháp · Mở phiếu';
      link.addEventListener('click', () => root.closest('dialog')?.close());
      result.replaceChildren(link);
      toast('Đã lưu Phiếu xin lấy trước — nháp.');
    } catch (error) { result.textContent = error.message; }
    finally { busy = false; sourceRows().forEach(sync); }
  });
  return { isBusy: () => busy };
}
