const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = String(text); return n; };
const button = (text, fn, cls = 'btn secondary') => { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

export function choosePurchaseMode(onChoose) {
  const dialog = node('dialog', 'modal pur-mode-dialog');
  const body = node('div', 'pur-mode-body');
  const close = () => { dialog.close(); dialog.remove(); };
  const choose = mode => { close(); onChoose(mode); };
  body.append(node('h2', '', 'Lập đơn mua'), node('p', 'muted', 'Anh/chị muốn mua hàng theo nhu cầu nào?'));
  const choices = node('div', 'pur-mode-choices');
  for (const [mode, title, detail] of [
    ['source', 'Mua theo đơn / báo giá', 'Chọn đơn hàng, báo giá hoặc yêu cầu hỏi tồn; xem số còn cần đặt.'],
    ['restock', 'Mua bổ sung', 'Chọn nhanh nhiều sản phẩm trong danh mục để bổ sung hàng.'],
  ]) {
    const b = button('', () => choose(mode), 'pur-mode-choice');
    b.append(node('strong', '', title), node('span', 'muted', detail)); choices.append(b);
  }
  body.append(choices, button('Huỷ', close)); dialog.append(body);
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dialog); dialog.showModal();
  return close;
}

/** Catalog pages never own selection: the purchase draft remains the single source of truth. */
export function createRestockPicker({ api, selected, toggle, active = () => true }) {
  const root = node('section', 'sup-section pur-restock-picker');
  const q = node('input'); q.type = 'search'; q.placeholder = 'Tìm mã hàng hoặc tên sản phẩm'; q.setAttribute('aria-label', q.placeholder);
  const list = node('div', 'pur-catalog-list'), message = node('p', 'muted small'), pager = node('div', 'pur-catalog-pager');
  let offset = 0, total = 0, products = [], sequence = 0, timer, disposed = false;
  const limit = 30;
  const previous = button('← Trước', () => { offset = Math.max(0, offset - limit); load(); });
  const next = button('Sau →', () => { offset += limit; load(); });
  const refresh = () => {
    list.replaceChildren();
    for (const p of products) {
      const label = node('label', 'pur-catalog-product'), check = node('input'); check.type = 'checkbox'; check.checked = selected(p.sku);
      check.setAttribute('aria-label', 'Chọn ' + p.sku);
      check.addEventListener('change', () => { toggle(p, check.checked); refresh(); });
      const detail = node('span'); detail.append(node('b', '', p.sku), node('span', '', p.name), node('small', 'muted', p.unit || ''));
      label.append(check, detail); list.append(label);
    }
  };
  async function load() {
    const request = ++sequence;
    previous.disabled = next.disabled = true; list.replaceChildren(); message.textContent = 'Đang tải sản phẩm…';
    try {
      const r = await api('/products?' + new URLSearchParams({ q: q.value.trim(), offset: String(offset), limit: String(limit) }));
      if (disposed || !active() || request !== sequence) return;
      products = r.products || []; total = Number(r.total) || 0; refresh();
      message.textContent = total ? `${offset + 1}–${offset + products.length} / ${total} sản phẩm. Các mã đã chọn được giữ khi tìm kiếm hoặc đổi trang.` : 'Không có sản phẩm phù hợp.';
      previous.disabled = offset === 0; next.disabled = offset + limit >= total;
    } catch (e) {
      if (disposed || !active() || request !== sequence) return;
      message.textContent = e.message || 'Không tải được sản phẩm.'; previous.disabled = next.disabled = true;
      list.append(button('Thử lại', load));
    }
  }
  q.addEventListener('input', () => { ++sequence; clearTimeout(timer); offset = 0; products = []; list.replaceChildren(); previous.disabled = next.disabled = true; message.textContent = 'Đang tìm sản phẩm…'; timer = setTimeout(load, 250); });
  pager.append(previous, next);
  root.append(node('h3', '', '1. Chọn sản phẩm mua bổ sung'), q, message, list, pager);
  return { root, load, refresh, dispose() { disposed = true; ++sequence; clearTimeout(timer); } };
}
