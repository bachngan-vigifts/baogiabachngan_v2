# #780 — bước A: bill MOP HEADS lệch tiền

Ngày kiểm tra: 23/11/2026. Mã ứng dụng: `origin/main` tại
`c37c9683086dacec1350833ef396301edb0c9a12`.
Chỉ thêm test và báo cáo; không sửa ứng dụng, migration hay dữ liệu production.

## Kết luận có bằng chứng

Có một đường API tạo được đúng triệu chứng đơn giá 101.001đ, tổng lệch 6đ
trên dữ liệu giả: cập nhật giá sản phẩm có phần lẻ qua `PUT /products/:sku`.
API tự làm tròn thành số nguyên trước khi POS lấy giá.

| Bước trên main chưa sửa | Đầu vào / kết quả thực tế của test |
|---|---|
| Giá được duyệt ban đầu trong fixture | 101000 VND, đã gồm VAT 8% |
| PUT cập nhật sản phẩm | `prices["retail-vat"] = 101000.52` (thử cả number và string) |
| HTTP / giá lưu | 200 / 101001, đáng ra từ chối giá VND có phần lẻ |
| `/pos/catalog` | `price = 101001` |
| Preview → checkout → snapshot → `/pos/bills/:id` | `listUnitPrice = 101001` |
| Renderer K80, SL 6, CK 0% | `101.001×6 cái`, thành tiền 606.006đ; so với giá fixture 101000: lệch 6đ |
| Renderer K80, SL 3, CK 10% | thành tiền 272.703đ; so với giá fixture 101000: lệch 3đ |

**Giới hạn quan trọng:** đây là tái hiện có điều kiện, chưa phải kết luận rằng
bill anh Thái gửi đã đi qua PUT với giá lẻ. Không có ảnh bill gốc, SKU, lịch sử
giá hay fixture đã ẩn danh của bill đó trong lệnh giao việc. Không đọc production
để bổ sung chúng. Không suy ra cả bill thực tế lệch 6đ là vì mua sáu MOP HEADS.
Đề nghị Claude đối chiếu thêm bằng chứng đã có trước khi duyệt nguyên nhân của
bill cụ thể và bước B.

## Vị trí mã nguồn

- `src/modules/catalog/api/product-admin.ts:27–31`: `cleanProduct` chỉ kiểm số hữu
  hạn, không âm và trần 1e12; sau đó `Math.round(n)`. `PUT /products/:sku` dùng
  kết quả này để upsert giá và ghi audit. Đây là lỗi đầu vào đã chứng minh được.
  POST tạo sản phẩm còn có `requireNewProductPrices` kiểm số nguyên cho hai bảng
  giá bắt buộc; PUT không dùng kiểm tra đó.
- `src/modules/sales/api/pos-store.ts:125–145`: POS lấy đúng `product_prices.price`
  của chính sách giá và truyền vào `posLine`, không tính lại giá từ VAT.
  Snapshot lưu nguyên `c.lines` tại dòng 486 trở đi.
- `src/modules/sales/domain/pos-money.ts:26–41`: giữ `price` nguyên; tính số tiền
  sau giảm rồi tách VAT bằng phần dư. Không cộng VAT ngược vào số đã làm tròn để
  tạo `listUnitPrice`.
- `src/modules/sales/api/pos-routes.ts:1217`: in lại trả snapshot đã lưu, không chia
  tổng dòng cho SL để tính đơn giá.
- `trial-ui/pos-print.js:83–92`: renderer in trực tiếp `item.listUnitPrice` và
  `item.total`. Chỉ đọc file, không sửa file thuộc làn #811.
- `trial-ui/product-admin.js` sau #807 đã chặn giá lẻ trên UI. Test ở đây gọi API
  trực tiếp để chứng minh backend vẫn nhận được giá lẻ từ client khác hoặc client
  cũ; chưa xác minh có client nào thực tế đã gửi giá đó.

Phép tính `round(101000 / 1.08) * 1.08 = 101000.52` có thể tạo đầu vào ví dụ trên.
Tuy nhiên **không tìm thấy phép tính đó trong đường tính/in K80 hiện tại**,
nên không quy kết lỗi VAT cho POS. Nhánh preview của `pos-order-edit.ts:164`
có tính lại `gross` từ `amount` đã làm tròn, nhưng không đổi `listUnitPrice`
và không phải nguồn K80 trong các đường đã truy. Chưa sửa nhánh đó.

## Test và kết quả trước sửa

File: `tests/app/crm-bill-money-audit.test.ts`. Toàn bộ dùng PGlite, router ứng dụng
thật, API nội bộ và renderer K80 với document giả tối thiểu. Không gọi dịch vụ
GHN/Sapo/SePay, không gửi mail/push thật, không dùng dữ liệu khách thật.

```sh
node --import tsx --test --test-concurrency=1 tests/app/crm-bill-money-audit.test.ts
```

Kết quả main chưa sửa: **4 test, 2 đạt, 2 hỏng đúng lỗi mong đợi**, exit 1,
không skip/todo. Hai test hỏng ở `200 !== 400` cho giá lẻ number và string.
Trước assertion này, test đã đi qua catalog, preview, checkout, lưu snapshot,
in lại và ghi rõ số tiền K80 thực tế.

Hai test đối chứng đạt:

1. Giá đúng 101000 không biến thành 101001 qua preview/checkout/in lại: SL 1,
   SL 3 có CK 10%, SL 6; có kiểm tổng trước VAT + VAT bằng tổng thanh toán.
2. Giá lẻ 101000.52 nằm sẵn trong bảng giá (mô phỏng import) bị POS chặn 400;
   không tạo đơn. Không thể kết luận mọi giá lẻ đều bị printer làm tròn lên.

Kiểm tra bổ sung (Node 22.22.0):

```sh
node --import tsx --test --test-concurrency=1 \
  src/modules/sales/domain/pos-money.test.ts tests/app/pos-ui.test.ts \
  tests/app/product-admin-prices.test.ts tests/app/product-update.test.ts \
  tests/architecture.test.ts
npm run typecheck
npm run ui:build
```

54/54 test hiện có đạt, không skip/todo, exit 0; typecheck exit 0; UI build exit 0.
Không có sửa giao diện nên không tuyên bố đã test layout 390/1280 hay máy in thật.
Chưa có kết quả sau sửa vì bước B chưa được duyệt.

## Đề xuất bước B để Claude duyệt

1. Nếu duyệt lỗi API đã tái hiện: kiểm số nguyên VND trước mọi bước làm tròn trong
   `cleanProduct`; trả 400 và không ghi giá/audit khi có phần lẻ. Giữ nguyên quyền,
   khóa cập nhật `expectedUpdatedAt`, semantics null/xóa giá, zero hợp lệ khi cập
   nhật, và số tiền nguyên đã hợp lệ. Mở PR riêng sau duyệt.
2. Không chữa bằng cách trừ 1đ ở renderer, làm tròn đơn giá theo nghìn hay tính lại
   tiền bill cũ từ giá hiện tại. Những cách đó có thể sửa sai giao dịch hợp lệ.
3. Cần đối chiếu ảnh bill/SKU/SL/CK/VAT và nguồn giá được phép trước khi khẳng định
   lỗi API là nguồn của bill thực tế. Nếu bằng chứng chỉ tới renderer POS thì báo
   `[Codex-1][CẦN PHỐI HỢP]` và phối hợp #811; chưa sửa các file đó.
4. Chưa xác nhận đơn cũ nào sai. Nếu cần kiểm tra tiếp, chỉ đề xuất đối chiếu READ
   ONLY theo đúng order/SKU: giá gốc và tổng dòng trong snapshot, `list_unit_price`
   trong `sales_order_lines`, và before/after trong audit cập nhật sản phẩm. Một
   giá 101001 tự nó không chứng minh sai. Xin duyệt riêng trước mọi sửa giá/đơn;
   không viết migration hay tác vụ tự sửa hàng loạt.

Nhánh test/báo cáo không dùng để merge hoặc deploy: hai regression test cố ý đỏ
để giữ bằng chứng trước sửa. Chưa mở PR sửa ứng dụng.
