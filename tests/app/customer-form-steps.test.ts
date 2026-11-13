import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = join(import.meta.dirname, '../../trial-ui'), read = (f: string) => readFileSync(join(ui, f), 'utf8');

test('form khách hàng nhập theo 3 bước, chỉ ẩn/hiện ô sẵn có', () => {
  const js = read('customer-form-steps.js'), app = read('app.js');
  assert.match(js, /\[1, 'Công ty'\], \[2, 'Người liên hệ'\], \[3, 'Kiểm tra và lưu'\]/);
  assert.match(app, /import \{ initCustomerFormSteps \} from '\.\/customer-form-steps\.js';/);
  assert.match(app, /customerSteps\.reset\(!id\);\s*\$\('#customer-dialog'\)\.showModal\(\)/, 'mỗi lần mở form quay về bước 1');
  assert.doesNotMatch(js, /\.append\(fields\.controls|replaceWith|\.name\s*=/, 'không di chuyển / đổi tên ô nhập');
  assert.doesNotMatch(js, /api\(/, 'không gọi API');
  assert.match(read('style.css'), /\.cstep-off \{ display:none !important; \}/);
});
test('điện thoại và email công ty ghi rõ là của công ty, không bắt buộc ở cả giao diện lẫn máy chủ', () => {
  const fields = read('customer-form-fields.js'), app = read('app.js');
  assert.match(fields, /companyLabels \? 'Điện thoại công ty \(không bắt buộc\)' : 'Điện thoại'/);
  assert.match(fields, /companyLabels \? 'Email công ty \(không bắt buộc\)' : 'Email'/);
  assert.match(app, /customerFormFields\(\{requireProfile:true,paymentDays:true,contactDirectory:true,companyLabels:true,requireCode:true\}\)/);
  assert.doesNotMatch(app, /\['phone','số điện thoại'\]/, 'giao diện không còn chặn lưu khi thiếu SĐT công ty');
  const server = readFileSync(join(ui, '../src/modules/customers/domain/customer-input.ts'), 'utf8');
  assert.match(server, /\[\['contact','người liên hệ'\],\['taxCode','mã số thuế'\],\['address','địa chỉ'\]\]/, 'máy chủ bắt buộc: người liên hệ, MST, địa chỉ');
});
test('Mã khách hàng nằm đầu bước 1 và bắt buộc khi tạo khách ở CRM', () => {
  const steps = read('customer-form-steps.js'), fields = read('customer-form-fields.js'), app = read('app.js');
  assert.match(steps, /const COMPANY = \['customerCode', 'taxCode', 'name', 'address', 'phone', 'email'\]/);
  assert.doesNotMatch(steps, /COMPANY_EXTRA = \[[^\]]*customerCode/);
  assert.match(fields, /requireCode && name === 'customerCode'/);
  assert.match(app, /\['customerCode','mã'\],\['taxCode','mã số thuế'\],\['address','địa chỉ'\]/);
});
test('POS vẫn dùng nhãn cũ (form khách lẻ không đổi)', () => {
  assert.doesNotMatch(read('pos-customer.js') + read('pos.js'), /companyLabels|requireCode/);
});
