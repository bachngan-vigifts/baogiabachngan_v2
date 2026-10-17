// Mã do CRM tạo riêng cho Header thêm phía SyncTime. Không dùng khóa SyncTime Client.
const node = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
export async function renderSynctimeWebhook(host, { api, toast }) {
  const section = node('section'), title = node('h3', 'Nhận webhook từ SyncTime'), status = node('p', 'Đang kiểm tra đầu nhận SyncTime…');
  status.setAttribute('role', 'status'); section.append(title, status); host.append(section);
  let state;
  const actions = node('div'), details = node('div'), secret = node('textarea'), samples = node('div');
  actions.className = 'row-gap'; secret.readOnly = true; secret.rows = 3; secret.hidden = true; secret.setAttribute('aria-label', 'Header xác thực mới tạo, chỉ hiện trong lần này');
  const warning = node('p', 'Mã chỉ hiện trong lần tạo này. Sao chép Header thêm sang SyncTime trước khi đóng cửa sổ.'); warning.hidden = true;
  section.append(details, actions, warning, secret, samples);
  const run = async fn => { try { await fn(); } catch (e) { toast(e.message, 'err'); } };
  const button = (label, fn) => { const b = node('button', label); b.type = 'button'; b.className = 'btn secondary';
    b.addEventListener('click', () => run(async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } })); return b; };
  async function refresh() {
    state = await api('/hr/synctime');
    status.textContent = `${state.configured ? 'Đã có mã nhận webhook.' : 'Chưa tạo mã nhận webhook.'} Đã nhận ${state.total} gói.` +
      (state.latestAt ? ' Gần nhất: ' + new Date(state.latestAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + '.' : '');
    details.replaceChildren(); actions.replaceChildren(); samples.replaceChildren();
    const apiBase = document.querySelector('meta[name="bn-api"]')?.content || 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
    const url = node('input'); url.readOnly = true; url.value = apiBase.replace(/\/$/, '') + state.path; url.setAttribute('aria-label', 'URL webhook CRM');
    const urlLabel = node('label', 'URL webhook'); urlLabel.append(url); details.append(urlLabel);
    details.append(node('p', 'Tên: CRM Bách Ngân · Bật đẩy realtime · Header thêm: dùng mã do CRM tạo ở dưới · HMAC secret: để trống · Map mã nhân viên: để trống để giữ mã nguồn.'));
    details.append(node('p', 'Chọn nguồn log cần nhận (Máy ADMS / SyncTime API / USB). Đây là hộp nhận chờ đối chiếu mẫu, chưa tự cập nhật ngày công hay lương.'));
    const create = button(state.configured ? 'Đổi mã kết nối' : 'Tạo mã kết nối', async () => {
      if (state.configured && !globalThis.confirm('Đổi mã sẽ ngừng nhận với Header cũ. Anh/chị cần cập nhật lại Header thêm trên SyncTime. Tiếp tục?')) return;
      const r = await api('/hr/synctime/key', 'POST', { replace: !!state.configured });
      secret.value = r.header; secret.hidden = warning.hidden = false; await refresh();
    });
    actions.append(create, button('Cập nhật trạng thái', refresh));
    if (state.configured) actions.append(button('Ngắt nhận webhook', async () => {
      if (!globalThis.confirm('Ngừng nhận webhook SyncTime? Dữ liệu đã nhận vẫn được giữ trong thời hạn lưu.')) return;
      await api('/hr/synctime/key', 'DELETE'); secret.value = ''; secret.hidden = warning.hidden = true; await refresh();
    }));
    for (const sample of state.latest) {
      const pre = node('pre'); pre.hidden = true; pre.style.whiteSpace = 'pre-wrap'; pre.style.overflowWrap = 'anywhere';
      const row = node('div'); row.append(button('Xem gói mẫu ' + new Date(sample.receivedAt).toLocaleString('vi-VN'), async () => {
        const r = await api('/hr/synctime/receipts/' + encodeURIComponent(sample.id)); pre.textContent = r.payloadText; pre.hidden = false;
      }), pre); samples.append(row);
    }
  }
  try { await refresh(); } catch (e) { status.textContent = 'Chưa mở được đầu nhận SyncTime: ' + e.message; }
}
