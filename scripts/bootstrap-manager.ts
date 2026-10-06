// Tạo Manager đầu tiên. Dùng:
//   npm run bootstrap:manager -- --name "Họ tên" --email a@b.vn --phone 09xxxxxxxx --origin https://ten-mien.vn > manager.sql
//   Áp manager.sql trong Supabase SQL Editor (sau khi kiểm tra dữ liệu).
// Liên kết kích hoạt in ra STDERR (không lẫn vào file SQL). Gửi liên kết cho người đó; hiệu lực 24 giờ.
import { buildManagerBootstrap } from '../src/modules/staff/domain/bootstrap.ts';

const arg = (name: string) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] ?? '' : ''; };
try {
  const r = buildManagerBootstrap({ name: arg('name'), email: arg('email'), phone: arg('phone'), origin: arg('origin').replace(/\/$/, ''), nowSec: Math.floor(Date.now() / 1000) });
  if (!/^https:\/\//.test(arg('origin'))) throw new Error('--origin phải là địa chỉ https://… của trang web.');
  console.log(r.sql.join('\n'));
  console.error('\nLiên kết kích hoạt (hiệu lực 24 giờ, chỉ dùng một lần):\n' + r.url + '\n');
} catch (e) { console.error('Lỗi: ' + (e as Error).message); process.exit(1); }
