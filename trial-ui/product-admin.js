// Thêm sản phẩm trên web + duyệt (trang Sản phẩm).
//  - Nút ＋ xanh mở hộp "Thêm sản phẩm": SKU, tên, thương hiệu, ĐVT, mẫu, link ảnh, giá theo từng bảng giá.
//  - Manager thêm → có hiệu lực ngay. Nhân viên thêm → "Chờ duyệt", chưa hiện khi lập báo giá.
//  - Khung "Sản phẩm chờ duyệt" ở đầu trang: Manager bấm Duyệt / Từ chối; người tạo xoá được sản phẩm mình gửi.

/** @param deps { api, toast, esc, money, confirmBox, isManager, userId, policies(), onChanged() } */
export function initProductAdmin(deps) {
  const { api, toast, esc, money, confirmBox, isManager } = deps, canApprove = deps.canApprove || isManager;
  const box = document.getElementById('product-pending');

  async function loadPending() {
    let rows = [];
    try { rows = (await api('/product-approvals')).products; } catch { box.hidden = true; return; }
    box.hidden = !rows.length;
    if (!rows.length) { box.innerHTML = ''; return; }
    const pol = new Map(deps.policies().map(p => [p.id, p.name]));
    box.innerHTML = `<div class="approval-head"><b>Sản phẩm chờ Manager duyệt (${rows.length})</b><small class="muted">Chưa dùng được khi lập báo giá cho tới khi được duyệt.</small></div>
      <ul class="approval-list">${rows.map(p => `<li>
        <span><b>${esc(p.name)}</b><small>${esc(p.sku)}${p.brand ? ' · ' + esc(p.brand) : ''}${p.unit ? ' · ' + esc(p.unit) : ''} · ${p.prices.map(x => `${esc(pol.get(x.policyId) || x.policyId)} ${money(x.price)}`).join(' · ') || 'chưa có giá'}</small>
          <small class="muted">Người thêm: ${esc(p.createdByName || '—')}</small></span>
        <span class="row-actions">${canApprove() ? `<button type="button" class="btn primary small" data-approve-product="${esc(p.sku)}">Duyệt</button>` : ''}
          <button type="button" class="btn ghost small danger-text" data-reject-product="${esc(p.sku)}">${canApprove() ? 'Từ chối' : 'Xoá'}</button></span></li>`).join('')}</ul>`;
  }
  box.addEventListener('click', async e => {
    const ok = e.target.closest('[data-approve-product]'), no = e.target.closest('[data-reject-product]');
    try {
      if (ok) { await api(`/products/${encodeURIComponent(ok.dataset.approveProduct)}/approve`, 'POST', {}); toast('Đã duyệt sản phẩm.'); }
      else if (no) {
        if (!await confirmBox(`Xoá sản phẩm chờ duyệt ${no.dataset.rejectProduct}?`, { ok: 'Xoá', danger: true })) return;
        await api(`/products/${encodeURIComponent(no.dataset.rejectProduct)}`, 'DELETE'); toast('Đã xoá sản phẩm chờ duyệt.');
      } else return;
      loadPending(); deps.onChanged();
    } catch (ex) { toast(ex.message, 'err'); }
  });

  function openForm(product = null) {
    const editing = !!product;
    const policies = deps.policies();
    const dlg = document.createElement('dialog'); dlg.className = 'modal';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${editing ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm'}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body form-grid cols-2">
        <label>Mã sản phẩm (SKU)<input name="sku" required maxlength="64" placeholder="VD: ML-BT-001" autocapitalize="characters"></label>
        <label>Đơn vị tính<input name="unit" maxlength="50" placeholder="cái, bộ, hộp…"></label>
        <label class="span-2">Tên sản phẩm<input name="name" required maxlength="500"></label>
        <label>Thương hiệu<input name="brand" maxlength="200" list="pa-brands"></label>
        <label>Mẫu / hoạ tiết<input name="pattern" maxlength="200"></label>
        <label class="span-2">Link ảnh (https://…)<input name="imageUrl" type="url" maxlength="2000" placeholder="Không bắt buộc"></label>
        ${policies.map(p => `<label>Giá: ${esc(p.name)}<input name="price:${esc(p.id)}" inputmode="numeric" placeholder="0"></label>`).join('')}
        <p class="muted small span-2">${editing ? 'Cập nhật danh mục CRM. Nếu sản phẩm được đồng bộ từ Sapo, lần đồng bộ sau có thể ghi đè thông tin. Mã SKU được giữ nguyên.' : isManager() ? 'Bạn là Manager: sản phẩm có hiệu lực ngay sau khi lưu.' : 'Sản phẩm mới cần Manager duyệt mới dùng được khi lập báo giá.'}</p>
        <p class="error span-2" data-err role="alert"></p>
      </div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button type="submit" class="btn primary">${editing ? 'Lưu cập nhật' : 'Lưu sản phẩm'}</button></div></form>
      <datalist id="pa-brands">${[...document.querySelectorAll('#product-brand option')].map(o => o.value).filter(Boolean).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
    if (editing) {
      for (const key of ['sku','unit','name','brand','pattern','imageUrl']) dlg.querySelector('form').elements.namedItem(key).value = product[key] || '';
      dlg.querySelector('[name="sku"]').readOnly = true;
      for (const policy of policies) { const price = product.prices.find(p => p.policyId === policy.id)?.price; dlg.querySelector('form').elements.namedItem('price:' + policy.id).value = price == null ? '' : String(price); }
    }
    document.body.append(dlg); dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => dlg.remove());
    let saving = false;
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (saving) return;
      const f = e.target.elements, err = dlg.querySelector('[data-err]'), v = k => f.namedItem(k).value.trim();
      const prices = {};
      for (const p of policies) { const raw = v('price:' + p.id).replace(/[\s.,]/g, ''); if (raw && !/^\d+$/.test(raw)) { err.textContent = 'Giá phải là số nguyên VNĐ từ 0 trở lên.'; return; } if (raw) prices[p.id] = Number(raw); else if (editing) prices[p.id] = null; }
      const body = { sku: v('sku'), name: v('name'), brand: v('brand'), unit: v('unit'), pattern: v('pattern'), imageUrl: v('imageUrl'), prices };
      if (!body.sku || !body.name) { err.textContent = 'Nhập mã SKU và tên sản phẩm.'; return; }
      const submit = dlg.querySelector('button[type=submit]'); saving = true; if (submit) submit.disabled = true; err.textContent = '';
      try {
        const r = editing ? await api('/products/' + encodeURIComponent(product.sku), 'PUT', { ...body, expectedUpdatedAt: product.updatedAt }) : await api('/products', 'POST', body);
        dlg.close();
        toast(editing ? `Đã cập nhật ${body.name}.` : r.approvalStatus === 'approved' ? `Đã thêm ${body.name}.` : `Đã gửi ${body.name} – chờ Manager duyệt.`);
        loadPending(); deps.onChanged();
      } catch (ex) { err.textContent = ex.message; }
      finally { saving = false; if (submit) submit.disabled = false; }
    });
  }

  let openingEdit = false;
  async function openEdit(sku) {
    if (!isManager() || openingEdit) return;
    openingEdit = true;
    try { const { product } = await api('/products/' + encodeURIComponent(sku)); openForm(product); }
    catch (ex) { toast(ex.message, 'err'); }
    finally { openingEdit = false; }
  }
  return { openCreate: () => openForm(), openEdit, loadPending };
}
