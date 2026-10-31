/**
 * RÀ HẠN CÔNG NỢ (Manager, trang Công nợ): xem trước các kỳ còn nợ có hạn sai quy tắc
 * (đơn lấy số ngày theo báo giá / khách; cọc HĐKT = ngày ký + 3 ngày), chọn rồi áp dụng. Không tự ghi đè.
 */
const day = iso => String(iso || '').split('-').reverse().join('/');
export async function openDueRepair({ api, toast, confirmBox, esc, money, onDone }) {
  const dlg = document.getElementById('due-repair-dialog'), list = document.getElementById('due-repair-list');
  const err = document.getElementById('due-repair-error'), apply = document.getElementById('due-repair-apply');
  err.textContent = ''; list.innerHTML = '<p class="muted">Đang rà…</p>'; apply.disabled = true;
  if (!dlg.open) dlg.showModal();
  let items = [];
  try { items = (await api('/payment-due-repairs')).items || []; } catch (e) { list.innerHTML = ''; err.textContent = e.message; return; }
  if (!items.length) { list.innerHTML = '<p class="muted">Không có kỳ công nợ nào cần sửa hạn.</p>'; return; }
  list.innerHTML = `<p class="muted small">${items.length} kỳ có hạn khác quy tắc. Bỏ chọn kỳ muốn giữ nguyên.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th><input type="checkbox" data-all checked aria-label="Chọn tất cả"></th><th>Chứng từ</th><th>Kỳ</th><th class="right">Số tiền</th><th>Hạn hiện tại</th><th>Hạn đúng</th><th>Căn cứ</th></tr></thead><tbody>
    ${items.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" checked aria-label="Sửa hạn ${esc(r.no)}"></td><td>${esc(r.no)}<small>${esc(r.customer)}</small></td>
      <td>${r.kind === 'deposit' ? 'Cọc' : 'Còn lại'}</td><td class="right">${money(r.amount)}</td><td>${day(r.from)}</td><td><b>${day(r.to)}</b></td><td class="small">${esc(r.reason)}</td></tr>`).join('')}
    </tbody></table></div>`;
  const boxes = () => [...list.querySelectorAll('input[data-i]')];
  const sync = () => { apply.disabled = !boxes().some(b => b.checked); };
  list.onchange = e => { if (e.target.matches('[data-all]')) boxes().forEach(b => { b.checked = e.target.checked; }); sync(); };
  sync();
  apply.onclick = async () => {
    const picked = boxes().filter(b => b.checked).map(b => items[+b.dataset.i]).map(r => ({ id: r.id, from: r.from, to: r.to }));
    if (!picked.length || !await confirmBox(`Sửa hạn ${picked.length} kỳ công nợ theo quy tắc mới? Mỗi thay đổi được ghi nhật ký.`, { ok: 'Sửa hạn' })) return;
    apply.disabled = true; err.textContent = '';
    try {
      const r = await api('/payment-due-repairs', 'POST', { items: picked });
      toast(`Đã sửa hạn ${r.applied} kỳ${r.skipped ? ` · bỏ qua ${r.skipped} kỳ đã thay đổi` : ''}.`);
      onDone?.(); await openDueRepair({ api, toast, confirmBox, esc, money, onDone });
    } catch (e) { err.textContent = e.message; sync(); }
  };
}
