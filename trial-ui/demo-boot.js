// Khởi động BẢN DEMO: phải chạy trước app.js (app.js đọc địa chỉ API lúc nạp).
import { DEMO_API, installDemoApi, resetDemo } from './demo-api.js';

window.BN_DEMO = true;
installDemoApi();
const meta = document.createElement('meta');
meta.name = 'bn-api'; meta.content = DEMO_API;
document.head.append(meta);

// Gợi ý tài khoản demo trên màn hình đăng nhập.
const note = document.createElement('div');
note.className = 'demo-note';
note.innerHTML = '<b>Bản demo – dữ liệu mẫu</b><span>Đăng nhập Manager: <code>demo@bachngan.vn</code> / <code>demo1234</code>. Dữ liệu chỉ lưu trên trình duyệt của bạn, chưa nối Supabase.</span>';
document.querySelector('#login-form')?.before(note);
const email = document.querySelector('#email'), pw = document.querySelector('#password');
if (email && !email.value) email.value = 'demo@bachngan.vn';
if (pw && !pw.value) pw.value = 'demo1234';

// Nút khôi phục dữ liệu mẫu trong menu tài khoản.
const reset = document.createElement('button');
reset.setAttribute('role', 'menuitem'); reset.textContent = 'Khôi phục dữ liệu mẫu';
reset.addEventListener('click', () => { resetDemo(); location.reload(); });
document.querySelector('#logout')?.before(reset);
document.querySelector('.topbar .crumbs')?.insertAdjacentHTML('beforeend', '<span class="pill warn">Bản demo</span>');
