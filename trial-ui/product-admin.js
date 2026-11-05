// Thêm sản phẩm trên web + duyệt (trang Sản phẩm).
//  - Nút ＋ xanh mở hộp "Thêm sản phẩm": SKU, tên, thương hiệu, ĐVT, mẫu, link ảnh, giá theo từng bảng giá.
//  - Manager thêm → có hiệu lực ngay. Nhân viên thêm → "Chờ duyệt", chưa hiện khi lập báo giá.
//  - Khung "Sản phẩm chờ duyệt" ở đầu trang: Manager bấm Duyệt / Từ chối; người tạo xoá được sản phẩm mình gửi.

/** @param deps { api, toast, esc, money, confirmBox, isManager, userId, policies(), onChanged() } */
export function initProductAdmin(deps) {
  const { api, toast, esc, money, confirmBox, isManager } = deps, canApprove = deps.canApprove || isManager, canUpdate = deps.canUpdate || isManager;
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
    const policies = editing && deps.canSeePrices && !deps.canSeePrices() ? [] : deps.policies();
    const priceKind = p => p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const requiredPrices = editing ? [] : [/^gia(ban)?le$/, /^gia(ban)?levat$/].map(pattern => policies.find(p => pattern.test(priceKind(p))));
    const dlg = document.createElement('dialog'); dlg.className = 'modal product-admin-dialog';
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${editing ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm'}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body form-grid cols-2">
        <label>Mã sản phẩm (SKU)<input name="sku" required maxlength="64" placeholder="VD: ML-BT-001" autocapitalize="characters"></label>
        <label>Đơn vị tính<input name="unit" maxlength="50" placeholder="cái, bộ, hộp…"></label>
        <label class="span-2">Tên sản phẩm<input name="name" required maxlength="500"></label>
        <label>Thương hiệu<input name="brand" maxlength="200" list="pa-brands"></label>
        <label>Mẫu / hoạ tiết<input name="pattern" maxlength="200"></label>
        <label class="span-2">Link ảnh (https://…)<input name="imageUrl" type="url" maxlength="2000" placeholder="Không bắt buộc"></label>
        <div class="span-2 product-image-picker">
          <button type="button" class="btn secondary small" data-image-choose>Tải ảnh lên</button><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-image-file hidden>
          <button type="button" class="btn ghost small" data-image-clear hidden>Bỏ ảnh đã chọn</button>
          <small class="muted" data-image-status>Chọn ảnh từ máy hoặc điện thoại. Ảnh được lưu khi bấm Lưu.</small>
          <div data-image-preview hidden></div>
        </div>
        ${editing?`<p class="muted small span-2">Quy cách thùng đóng gói (cm, kg)</p>${[['perCarton','Số sản phẩm / thùng'],['cartonLength','Dài thùng (cm)'],['cartonWidth','Rộng thùng (cm)'],['cartonHeight','Cao thùng (cm)'],['cartonWeight','Cân nặng thùng (kg)']].map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0.001" max="1000000" step="${key==='perCarton'?'1':'any'}" inputmode="decimal" placeholder="Chưa có"></label>`).join('')}`:''}
        ${policies.map(p => `<label>Giá: ${esc(p.name)}${requiredPrices.includes(p) ? ' *' : ''}<input name="price:${esc(p.id)}" inputmode="numeric" ${requiredPrices.includes(p) ? 'required aria-required="true" placeholder="Bắt buộc nhập"' : 'placeholder="0"'}></label>`).join('')}
        ${editing ? '' : '<p class="muted small span-2">* Bắt buộc nhập Giá bán lẻ và Giá lẻ +VAT lớn hơn 0.</p>'}
        <p class="muted small span-2">${editing ? 'Cập nhật danh mục CRM. Nếu sản phẩm được đồng bộ từ Sapo, lần đồng bộ sau có thể ghi đè thông tin. Mã SKU được giữ nguyên.' : isManager() ? 'Bạn là Manager: sản phẩm có hiệu lực ngay sau khi lưu.' : 'Sản phẩm mới cần Manager duyệt mới dùng được khi lập báo giá.'}</p>
        <p class="error span-2" data-err role="alert"></p>
      </div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button type="submit" class="btn primary">${editing ? 'Lưu cập nhật' : 'Lưu sản phẩm'}</button></div></form>
      <datalist id="pa-brands">${[...document.querySelectorAll('#product-brand option')].map(o => o.value).filter(Boolean).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
    if (editing) {
      for (const key of ['sku','unit','name','brand','pattern','imageUrl']) dlg.querySelector('form').elements.namedItem(key).value = product[key] || '';
      for(const key of ['perCarton','cartonLength','cartonWidth','cartonHeight','cartonWeight'])dlg.querySelector('form').elements.namedItem(key).value=product[key]??'';
      dlg.querySelector('[name="sku"]').readOnly = true;
      for (const policy of policies) { const price = product.prices.find(p => p.policyId === policy.id)?.price; dlg.querySelector('form').elements.namedItem('price:' + policy.id).value = price == null ? '' : String(price); }
    }
    const imageInput = dlg.querySelector('[name="imageUrl"]'), preview = dlg.querySelector('[data-image-preview]'), imageStatus = dlg.querySelector('[data-image-status]'), clearImage = dlg.querySelector('[data-image-clear]');
    let pendingImage = '', imageBusy = false, imageSequence = 0;
    function drawImage(src) {
      preview.replaceChildren(); preview.hidden = !src;
      if (src) { const img = document.createElement('img'); img.src = src; img.alt = 'Ảnh sản phẩm đã chọn'; img.style.cssText = 'display:block;max-width:100%;height:110px;object-fit:contain;margin-top:8px'; preview.append(img); }
      clearImage.hidden = !pendingImage;
    }
    drawImage(imageInput.value);
    imageInput.addEventListener('input', () => { imageSequence++; pendingImage = ''; imageBusy = false; drawImage(imageInput.value.trim()); });
    dlg.querySelector('[data-image-choose]').addEventListener('click', () => dlg.querySelector('[data-image-file]').click());
    dlg.querySelector('[data-image-file]').addEventListener('change', async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      const sequence = ++imageSequence; imageBusy = true; imageStatus.textContent = 'Đang chuẩn bị ảnh…';
      try {
        if (file.size > 20 * 1024 * 1024) throw Error('Ảnh quá lớn (tối đa 20 MB trước khi thu nhỏ).');
        if (!deps.compress) throw Error('Chưa tải được công cụ xử lý ảnh. Vui lòng tải lại trang.');
        const data = await deps.compress(file);
        if (sequence !== imageSequence || !dlg.isConnected) return;
        pendingImage = data; imageInput.value = ''; drawImage(data); imageStatus.textContent = 'Ảnh đã chọn — bấm Lưu để cập nhật.';
      } catch (ex) { if (sequence === imageSequence) imageStatus.textContent = ex.message; }
      finally { if (sequence === imageSequence) imageBusy = false; }
    });
    clearImage.addEventListener('click', () => { imageSequence++; pendingImage = ''; imageBusy = false; imageInput.value = product?.imageUrl || ''; drawImage(imageInput.value); imageStatus.textContent = 'Đã bỏ ảnh vừa chọn.'; });
    document.body.append(dlg); dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => dlg.remove());
    let saving = false;
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (saving) return;
      if (imageBusy) { dlg.querySelector('[data-err]').textContent = 'Đợi xử lý ảnh xong rồi bấm Lưu.'; return; }
      const f = e.target.elements, err = dlg.querySelector('[data-err]'), v = k => f.namedItem(k).value.trim();
      const prices = {};
      if (requiredPrices.some(p => !p)) { err.textContent = 'Chưa có đủ bảng Giá bán lẻ và Giá lẻ +VAT. Vui lòng tải lại hoặc cấu hình bảng giá.'; return; }
      for (const p of policies) { const raw = v('price:' + p.id).replace(/[\s.,]/g, ''); if (raw && !/^\d+$/.test(raw)) { err.textContent = 'Giá phải là số nguyên VNĐ từ 0 trở lên.'; return; } if (raw) prices[p.id] = Number(raw); else if (editing) prices[p.id] = null; }
      for (const p of requiredPrices) {
        if (!Number.isSafeInteger(prices[p.id]) || prices[p.id] <= 0 || prices[p.id] > 1e12) {
          err.textContent = `Bắt buộc nhập ${p.name} lớn hơn 0 (tối đa 1.000.000.000.000đ).`;
          f.namedItem('price:' + p.id).focus(); return;
        }
      }
      const body = { sku: v('sku'), name: v('name'), brand: v('brand'), unit: v('unit'), pattern: v('pattern'), imageUrl: v('imageUrl'), prices };
      if(editing)for(const key of ['perCarton','cartonLength','cartonWidth','cartonHeight','cartonWeight']){
        const raw=v(key);if(raw===String(product[key]??''))continue;const value=raw===''?null:Number(raw.replace(',','.'));
        if(value!==null&&(!Number.isFinite(value)||value<=0||value>1e6||(key==='perCarton'&&!Number.isInteger(value)))){err.textContent='Nhập quy cách thùng là số dương; số SP/thùng là số nguyên.';return;}body[key]=value;
      }
      if (!body.sku || !body.name) { err.textContent = 'Nhập mã SKU và tên sản phẩm.'; return; }
      const submit = dlg.querySelector('button[type=submit]'), imageControls = [imageInput,clearImage,dlg.querySelector('[data-image-choose]')]; saving = true; if (submit) submit.disabled = true; imageControls.forEach(el => el.disabled = true); err.textContent = '';
      try {
        if (pendingImage) {
          const uploaded = await api('/product-images', 'POST', { image: pendingImage });
          body.imageUrl = uploaded.imageUrl; imageInput.value = uploaded.imageUrl; pendingImage = ''; drawImage(uploaded.imageUrl);
        }
        const r = editing ? await api('/products/' + encodeURIComponent(product.sku), 'PUT', { ...body, expectedUpdatedAt: product.updatedAt }) : await api('/products', 'POST', body);
        dlg.close();
        toast(editing ? `Đã cập nhật ${body.name}.` : r.approvalStatus === 'approved' ? `Đã thêm ${body.name}.` : `Đã gửi ${body.name} – chờ Manager duyệt.`);
        loadPending(); deps.onChanged();
      } catch (ex) { err.textContent = ex.message; }
      finally { saving = false; if (submit) submit.disabled = false; imageControls.forEach(el => el.disabled = false); }
    });
  }

  let openingEdit = false;
  async function openEdit(sku) {
    if (!canUpdate() || openingEdit) return;
    openingEdit = true;
    try { const { product } = await api('/products/' + encodeURIComponent(sku)); openForm(product); }
    catch (ex) { toast(ex.message, 'err'); }
    finally { openingEdit = false; }
  }
  return { openCreate: () => openForm(), openEdit, loadPending };
}

