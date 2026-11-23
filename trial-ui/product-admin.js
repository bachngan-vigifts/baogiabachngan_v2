// Thêm sản phẩm trên web + duyệt (trang Sản phẩm).
//  - Nút ＋ xanh mở hộp "Thêm sản phẩm": SKU, tên, thương hiệu, ĐVT, mẫu, VAT 8%/10%, link ảnh, giá theo từng bảng giá.
//  - Manager thêm → có hiệu lực ngay. Nhân viên thêm → "Chờ duyệt", chưa hiện khi lập báo giá.
//  - Khung "Sản phẩm chờ duyệt" ở đầu trang: Manager bấm Duyệt / Từ chối; người tạo xoá được sản phẩm mình gửi.

const priceFormat = new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 0});
/** Integer VND only; separators are accepted only in complete thousands groups. */
export function parseProductPrice(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const grouped = /^[1-9]\d{0,2}([., \u00a0\u202f])\d{3}(?:\1\d{3})*$/.test(raw);
  const digits = typeof value === 'number' ? value : /^\d+$/.test(raw) ? raw : grouped ? raw.replace(/[., \u00a0\u202f]/g, '') : null;
  const amount = Number(digits);
  if (digits === null || !Number.isSafeInteger(amount) || amount < 0 || amount > 1e12) {
    throw Error('Giá phải là số nguyên VNĐ từ 0 đến 1.000.000.000.000; không nhập phần lẻ.');
  }
  return amount;
}

/** @param deps { api, toast, esc, money, confirmBox, isManager, userId, policies(), onChanged() } */
export function initProductAdmin(deps) {
  const { api, toast, esc, money, confirmBox, isManager } = deps, canApprove = deps.canApprove || isManager, canUpdate = deps.canUpdate || isManager;
  const box = document.getElementById('product-pending');

  let archivedButton;
  async function loadPending() {
    if(archivedButton)archivedButton.hidden=!isManager();
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
    const initialTax = editing ? product.taxable && [8, 10].includes(product.taxOut) ? String(product.taxOut) : '' : '8';
    const legacyTaxLabel = !product?.taxable ? 'Không áp dụng thuế (giữ nguyên)' : Number.isFinite(product.taxOut) ? `${product.taxOut}% (giữ nguyên)` : 'Chưa có thuế (giữ nguyên)';
    const policies = editing && deps.canSeePrices && !deps.canSeePrices() ? [] : deps.policies();
    const priceKind = p => p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const requiredPrices = editing ? [] : [/^gia(ban)?le$/, /^gia(ban)?levat$/].map(pattern => policies.find(p => pattern.test(priceKind(p))));
    const dlg = document.createElement('dialog'); dlg.className = editing ? 'modal product-admin-dialog' : 'modal product-admin-dialog product-create'; // product-create: điện thoại vẫn được tạo mới (trang Sản phẩm mobile chỉ xem)
    dlg.setAttribute('aria-label', editing ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm');
    dlg.innerHTML = `<form novalidate><div class="modal-head"><h2>${editing ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm'}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body product-editor-layout">
        ${editing ? '' : `<fieldset class="product-editor-link form-grid"><legend>Tạo nhanh từ link sản phẩm</legend>
          <div class="product-link-row"><input name="sourceUrl" type="url" inputmode="url" maxlength="2500" placeholder="https://website-thuong-hieu.vn/san-pham/…" aria-label="Link trang sản phẩm"><button type="button" class="btn secondary small" data-link-fetch data-mobile-inline>Lấy thông tin</button></div>
          <small class="muted" data-link-status>Dán link trang MỘT sản phẩm (Sapo, Haravan, WooCommerce hoặc trang có dữ liệu sản phẩm): hệ thống điền sẵn mã, tên, thương hiệu, ảnh, giá web – kiểm tra lại rồi bấm Lưu.</small>
        </fieldset>`}
        <fieldset class="product-editor-info form-grid cols-2"><legend>Thông tin sản phẩm</legend>
        <label>Mã sản phẩm (SKU)<input name="sku" required maxlength="64" placeholder="VD: ML-BT-001" autocapitalize="characters"></label>
        <label>Đơn vị tính<input name="unit" maxlength="50" placeholder="cái, bộ, hộp…"></label>
        <label class="span-2">Tên sản phẩm<input name="name" required maxlength="500"></label>
        <label>Thương hiệu<input name="brand" maxlength="200" list="pa-brands"></label>
        <label>Mẫu / hoạ tiết<input name="pattern" maxlength="200"></label>
        <label class="span-2">Thuế sản phẩm (VAT)<select name="taxRate">${editing && !initialTax ? `<option value="" selected disabled>${esc(legacyTaxLabel)}</option>` : ''}<option value="8">8%</option><option value="10">10%</option></select></label>
        </fieldset><fieldset class="product-editor-image form-grid"><legend>Ảnh sản phẩm</legend>
        <label>Link ảnh (https://…)<input name="imageUrl" type="url" maxlength="2000" placeholder="Không bắt buộc"></label>
        <div class="product-image-picker">
          <button type="button" class="btn secondary small" data-image-choose>Tải ảnh lên</button><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-image-file hidden>
          <button type="button" class="btn ghost small" data-image-clear hidden>Bỏ ảnh đã chọn</button>
          <small class="muted" data-image-status>Chọn ảnh từ máy hoặc điện thoại. Ảnh được lưu khi bấm Lưu.</small>
          <div data-image-preview hidden></div>
        </div>
        </fieldset>
        ${editing?`<fieldset class="product-editor-carton form-grid"><legend>Quy cách thùng đóng gói (cm, kg)</legend>${[['perCarton','Số sản phẩm / thùng'],['cartonLength','Dài thùng (cm)'],['cartonWidth','Rộng thùng (cm)'],['cartonHeight','Cao thùng (cm)'],['cartonWeight','Cân nặng thùng (kg)']].map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0.001" max="1000000" step="${key==='perCarton'?'1':'any'}" inputmode="decimal" placeholder="Chưa có"></label>`).join('')}</fieldset>`:''}
        <fieldset class="product-editor-prices form-grid"><legend>Bảng giá</legend>
        ${policies.map(p => `<label>Giá: ${esc(p.name)}${requiredPrices.includes(p) ? ' *' : ''}<input name="price:${esc(p.id)}" data-money="0" inputmode="numeric" ${requiredPrices.includes(p) ? 'required aria-required="true" placeholder="Bắt buộc nhập"' : 'placeholder="0"'}></label>`).join('')}
        <small class="muted">Nhập giá nguyên VNĐ. Dấu chấm hoặc dấu phẩy chỉ dùng tách nhóm nghìn, ví dụ 450.000.</small>
        </fieldset>
        ${editing ? '' : '<p class="muted small span-2">* Bắt buộc nhập Giá bán lẻ và Giá lẻ +VAT lớn hơn 0.</p>'}
        <p class="muted small span-2">${editing ? 'Cập nhật danh mục CRM. Nếu sản phẩm được đồng bộ từ Sapo, lần đồng bộ sau có thể ghi đè thông tin. Mã SKU được giữ nguyên.' : isManager() ? 'Bạn là Manager: sản phẩm có hiệu lực ngay sau khi lưu.' : 'Sản phẩm mới cần Manager duyệt mới dùng được khi lập báo giá.'}</p>
        <p class="error span-2" data-err role="alert"></p>
      </div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Huỷ</button><button type="submit" class="btn primary">${editing ? 'Lưu cập nhật' : 'Lưu sản phẩm'}</button></div></form>
      <datalist id="pa-brands">${[...document.querySelectorAll('#product-brand option')].map(o => o.value).filter(Boolean).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
    // Preserve input until validation: the generic money proxy strips punctuation.
    // Numeric provenance distinguishes a loaded fraction from human grouping.
    const priceSources = new WeakMap();
    const setPriceValue = (input, value) => {
      const amount = value == null || value === '' ? null : Number(value);
      input.value = amount === null ? '' : Number.isSafeInteger(amount) ? priceFormat.format(amount) : String(value);
      if (amount !== null) priceSources.set(input, {text: input.value, amount});
    };
    for (const input of dlg.querySelectorAll('input[name^="price:"]')) input.addEventListener('input', () => {
      priceSources.delete(input); input.removeAttribute('aria-invalid'); input.parentElement.querySelector('[data-price-error]')?.remove();
    });
    if (editing) {
      for (const key of ['sku','unit','name','brand','pattern','imageUrl']) dlg.querySelector('form').elements.namedItem(key).value = product[key] || '';
      for(const key of ['perCarton','cartonLength','cartonWidth','cartonHeight','cartonWeight'])dlg.querySelector('form').elements.namedItem(key).value=product[key]??'';
      dlg.querySelector('[name="sku"]').readOnly = true;
      for (const policy of policies) { const price = product.prices.find(p => p.policyId === policy.id)?.price; setPriceValue(dlg.querySelector('form').elements.namedItem('price:' + policy.id), price); }
    }
    dlg.querySelector('[name="taxRate"]').value = initialTax;
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
    // Tạo nhanh từ link: máy chủ đọc trang (chỉ đọc, chống SSRF), trình duyệt điền form; ảnh tải qua máy chủ rồi thu nhỏ như ảnh chọn từ máy.
    const linkButton = dlg.querySelector('[data-link-fetch]');
    if (linkButton) linkButton.addEventListener('click', async () => {
      const f = dlg.querySelector('form').elements, status = dlg.querySelector('[data-link-status]'), url = f.namedItem('sourceUrl').value.trim();
      if (!/^https:\/\//i.test(url)) { status.textContent = 'Dán link đầy đủ bắt đầu bằng https://'; return; }
      linkButton.disabled = true; status.textContent = 'Đang đọc trang sản phẩm…';
      try {
        const r = await deps.api('/product-link-preview', 'POST', { url }), p = r.product, notes = [...(r.warnings || [])];
        if (p.sku) f.namedItem('sku').value = p.sku;
        f.namedItem('name').value = p.name || f.namedItem('name').value;
        if (p.brand) f.namedItem('brand').value = p.brand;
        if (!f.namedItem('unit').value) f.namedItem('unit').value = 'cái';
        const [retail, retailVat] = requiredPrices;
        if (p.price && retail && retailVat) {
          const rate = Number(f.namedItem('taxRate').value) || 8;
          setPriceValue(f.namedItem('price:' + retailVat.id), p.price);
          setPriceValue(f.namedItem('price:' + retail.id), Math.round(p.price / (1 + rate / 100)));
          notes.unshift(`Giá web ${money(p.price)} điền vào ${retailVat.name}; ${retail.name} = giá web ÷ (1 + VAT ${rate}%). Kiểm tra lại giá bán của công ty.`);
        }
        if (r.existing) notes.unshift(`⚠ Mã ${r.existing.sku} đã có trong danh mục (${r.existing.name}${r.existing.approvalStatus === 'pending' ? ', đang chờ duyệt' : ''}) – đổi mã nếu là sản phẩm khác.`);
        status.textContent = (notes.length ? notes.join(' ') : 'Đã điền thông tin từ ' + r.source + '.') + (p.imageUrl ? ' Đang tải ảnh…' : '');
        if (p.imageUrl) {
          const sequence = ++imageSequence; imageBusy = true;
          try {
            const img = await deps.api('/product-link-image', 'POST', { url: p.imageUrl });
            // Không dùng fetch(data:) – CSP connect-src không cho data:. Giải mã base64 trực tiếp.
            const [head, b64] = String(img.dataUrl).split(','), type = /^data:(image\/[a-z]+);base64$/.exec(head)?.[1];
            if (!type || !b64) throw Error('Ảnh không hợp lệ.');
            const blob = new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type });
            if (!deps.compress) throw Error('Chưa tải được công cụ xử lý ảnh.');
            const data = await deps.compress(new File([blob], 'link-image', { type: blob.type }));
            if (sequence !== imageSequence || !dlg.isConnected) return;
            pendingImage = data; imageInput.value = ''; drawImage(data);
            imageStatus.textContent = 'Ảnh lấy từ link — bấm Lưu để tải lên kho ảnh CRM.';
            status.textContent = status.textContent.replace(' Đang tải ảnh…', '');
          } catch (ex) { if (sequence === imageSequence) { imageStatus.textContent = 'Chưa lấy được ảnh: ' + ex.message + ' Có thể tải ảnh lên tay.'; status.textContent = status.textContent.replace(' Đang tải ảnh…', ''); } }
          finally { if (sequence === imageSequence) imageBusy = false; }
        }
      } catch (ex) { status.textContent = ex.message; }
      finally { linkButton.disabled = false; }
    });
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
      for (const p of policies) {
        const input = f.namedItem('price:' + p.id), raw = v('price:' + p.id), source = priceSources.get(input);
        try {
          const amount = parseProductPrice(source?.text === raw ? source.amount : raw);
          if (amount !== null) prices[p.id] = amount; else if (editing) prices[p.id] = null;
        } catch (ex) {
          err.textContent = `${p.name}: ${ex.message}`; input.setAttribute('aria-invalid', 'true');
          let hint = input.parentElement.querySelector('[data-price-error]');
          if (!hint) { hint = document.createElement('small'); hint.className = 'error'; hint.dataset.priceError = ''; input.after(hint); }
          hint.textContent = ex.message; input.focus(); hint.scrollIntoView({block: 'nearest'}); return;
        }
      }
      for (const p of requiredPrices) {
        if (!Number.isSafeInteger(prices[p.id]) || prices[p.id] <= 0 || prices[p.id] > 1e12) {
          err.textContent = `Bắt buộc nhập ${p.name} lớn hơn 0 (tối đa 1.000.000.000.000đ).`;
          f.namedItem('price:' + p.id).focus(); return;
        }
      }
      const body = { sku: v('sku'), name: v('name'), brand: v('brand'), unit: v('unit'), pattern: v('pattern'), imageUrl: v('imageUrl'), prices };
      if (!editing || v('taxRate') !== initialTax) {
        const rate = Number(v('taxRate'));
        if (rate !== 8 && rate !== 10) { err.textContent = 'Chọn thuế sản phẩm 8% hoặc 10%.'; return; }
        body.taxRate = rate;
      }
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
  let removing=false;
  async function openRemove(sku){
    if(!isManager()||removing)return;removing=true;
    try{const {product:p}=await api('/products/'+encodeURIComponent(sku));
      if(!await confirmBox(`Xoá ${p.name} (${sku}) khỏi danh mục? Chỉ thực hiện khi không còn tồn, hàng đang về hoặc giữ hàng. Lịch sử, chứng từ và giá được giữ nguyên; có thể khôi phục trong Đã xoá.`,{ok:'Xoá khỏi danh mục',danger:true,mobileAllowed:true}))return;
      await api('/products/'+encodeURIComponent(sku)+'/archive','POST',{expectedUpdatedAt:p.updatedAt});toast('Đã xoá khỏi danh mục. Có thể khôi phục tại Đã xoá.');deps.onChanged();
    }catch(e){toast(e.message,'err');}finally{removing=false;}
  }
  function openArchived(){
    if(!isManager())return;const dlg=document.createElement('dialog');dlg.className='modal product-archive-dialog';
    dlg.innerHTML='<div class="modal-head"><h2>Sản phẩm đã xoá khỏi danh mục</h2><button type="button" class="btn secondary" data-close>Đóng</button></div><div class="modal-body"><p class="muted">Khôi phục để dùng lại mã cũ. Lịch sử và chứng từ luôn được giữ nguyên.</p><input type="search" placeholder="Tìm mã hoặc tên sản phẩm…" aria-label="Tìm sản phẩm đã xoá"><p role="alert" class="error"></p><div data-list></div></div><div class="modal-foot"><button type="button" class="btn secondary" data-prev>Trước</button><button type="button" class="btn secondary" data-next>Sau</button></div>';
    let offset=0,next=null,seq=0,timer,busy=false;const search=dlg.querySelector('input'),list=dlg.querySelector('[data-list]'),err=dlg.querySelector('[role=alert]');
    const load=async()=>{const n=++seq;err.textContent='';try{const d=await api('/archived-products?'+new URLSearchParams({q:search.value.trim(),offset:String(offset)}));if(n!==seq||!dlg.open)return;next=d.nextOffset;list.replaceChildren();
      if(!d.products.length)list.textContent='Không có sản phẩm đã xoá phù hợp.';
      for(const p of d.products){const row=document.createElement('div');row.className='row-gap';const name=document.createElement('span');name.textContent=p.sku+' · '+p.name;const restore=document.createElement('button');restore.type='button';restore.className='btn secondary small';restore.dataset.mobileInline='';restore.textContent='Khôi phục';restore.setAttribute('aria-label','Khôi phục '+p.sku);restore.onclick=async()=>{if(busy)return;if(!await confirmBox('Khôi phục '+p.sku+' vào danh mục?',{ok:'Khôi phục',mobileAllowed:true}))return;busy=true;restore.disabled=true;try{await api('/products/'+encodeURIComponent(p.sku)+'/restore','POST',{expectedUpdatedAt:p.updatedAt});toast('Đã khôi phục '+p.sku);await deps.onChanged();await load();}catch(e){err.textContent=e.message;}finally{busy=false;restore.disabled=false;}};row.append(name,restore);list.append(row);}
      dlg.querySelector('[data-prev]').disabled=offset===0;dlg.querySelector('[data-next]').disabled=next===null;
    }catch(e){if(n===seq)err.textContent=e.message;}};
    search.oninput=()=>{++seq;clearTimeout(timer);timer=setTimeout(()=>{offset=0;load();},250);};dlg.querySelector('[data-prev]').onclick=()=>{offset=Math.max(0,offset-25);load();};dlg.querySelector('[data-next]').onclick=()=>{if(next!==null){offset=next;load();}};
    dlg.querySelector('[data-close]').onclick=()=>dlg.close();dlg.addEventListener('close',()=>{++seq;clearTimeout(timer);dlg.remove();},{once:true});document.body.append(dlg);dlg.showModal();load();
  }
  {const b=archivedButton=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent='Đã xoá';b.dataset.mobileNavigation='';b.hidden=!isManager();b.onclick=openArchived;document.getElementById('new-product')?.parentElement?.append(b);}
  return { openCreate: () => openForm(), openEdit, openRemove,openArchived,loadPending };
}
