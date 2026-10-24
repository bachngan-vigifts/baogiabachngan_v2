/** Advisory lookup; saving still checks identities under a server transaction lock. */
export function bindCustomerDuplicateCheck({ api, root, read, endpoint = '/customers/duplicates/check', exceptId = () => '', onChoose, active = () => true }) {
  const box = document.createElement('div'); box.className = 'customer-duplicate-check span-2'; box.hidden = true;
  box.setAttribute('role', 'status'); root.append(box);
  const labels = { taxCode: 'MST', phone: 'SĐT', name: 'tên khách' };
  let request = 0, timer;
  const reset = () => { ++request; clearTimeout(timer); box.replaceChildren(); box.hidden = true; };
  async function refresh() {
    const id = ++request, data = read();
    const params = new URLSearchParams({ name: data.name || '', phone: data.phone || '', taxCode: data.taxCode || '', exceptId: exceptId() || '' });
    if (![data.phone, data.taxCode].some(v => v?.trim())) return reset(); // trùng tên được phép: chỉ kiểm SĐT / MST
    try {
      const result = await api(endpoint + '?' + params);
      if (id !== request || !root.isConnected || !active()) return;
      box.replaceChildren(); box.hidden = !result.matches.length;
      if (!result.matches.length) return;
      const title = document.createElement('p'); title.className = 'error'; title.textContent = 'Đã có khách trùng thông tin. Chọn khách có sẵn:'; box.append(title);
      for (const match of result.matches) {
        const row = document.createElement('p'), text = `${match.name} · trùng ${match.reasons.map(r => labels[r] || r).join(', ')}`;
        const item = document.createElement(match.id ? (onChoose ? 'button' : 'a') : 'span'); item.textContent = text;
        if (match.id && onChoose) { item.type = 'button'; item.className = 'btn secondary small'; item.addEventListener('click', () => onChoose(match)); }
        else if (match.id) item.href = '#/customers/' + encodeURIComponent(match.id);
        row.append(item); box.append(row);
      }
    } catch { if (id === request) { box.replaceChildren(); box.hidden = false; const note = document.createElement('p'); note.className = 'muted small'; note.textContent = 'Chưa kiểm tra được khách trùng. Máy chủ sẽ kiểm tra lại khi lưu.'; box.append(note); } }
  }
  root.addEventListener('input', e => {
    if (!['phone', 'taxCode'].includes(e.target.name)) return;
    reset(); timer = setTimeout(refresh, 300);
  });
  return { reset, refresh };
}
