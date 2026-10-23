const API = document.querySelector('meta[name="bn-api"]')?.content
  || 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const $ = s => document.querySelector(s);
let token = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
// Keep the bearer invitation out of subsequent navigation and browser history.
history.replaceState(null, '', location.pathname + location.search);
const form = $('#registration-form'), error = $('#registration-error'), note = $('#registration-note');
async function api(path, body) {
  let r;
  try { r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Chưa kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'); }
  const d = await r.json().catch(() => ({ error: 'Máy chủ chưa sẵn sàng. Vui lòng thử lại.' }));
  if (!r.ok) throw new Error(d.error || 'Không thực hiện được thao tác.');
  return d;
}
$('#registration-show-password').onchange = e => {
  for (const key of ['password', 'password2']) form.elements[key].type = e.target.checked ? 'text' : 'password';
};
form.onsubmit = async e => {
  e.preventDefault(); error.textContent = '';
  if (form.elements.password.value !== form.elements.password2.value) { error.textContent = 'Hai mật khẩu chưa khớp.'; return; }
  const submit = $('#registration-submit'); submit.disabled = true;
  try {
    const d = await api('/register-partner', { token, name: form.elements.name.value, email: form.elements.email.value, phone: form.elements.phone.value, password: form.elements.password.value });
    token = ''; form.reset(); form.hidden = true;
    note.textContent = 'Đăng ký thành công. Đăng nhập bằng ' + d.login + ' và mật khẩu vừa tạo.';
    const login = $('#registration-login'); login.href = d.portal === '/supplier.html' ? 'supplier.html' : 'customer.html'; login.hidden = false;
  } catch (e) { error.textContent = e.message; }
  finally { submit.disabled = false; }
};
try {
  const d = await api('/registration-info', { token });
  $('#registration-entity').textContent = (d.kind === 'supplier' ? 'Nhà cung cấp: ' : 'Khách hàng: ') + d.entityName;
  note.textContent = 'Lời mời đăng ký có hiệu lực đến ' + new Date(d.expiresAt).toLocaleString('vi-VN') + '.';
  $('#registration-login-help').textContent = d.kind === 'supplier' ? 'Dùng email để đăng nhập trang NCC.' : 'Nhập email hoặc số di động để đăng nhập trang khách hàng.';
  form.elements.email.required = d.kind === 'supplier'; form.hidden = false;
} catch (e) { note.textContent = 'Không mở được lời mời đăng ký.'; error.textContent = e.message; }
