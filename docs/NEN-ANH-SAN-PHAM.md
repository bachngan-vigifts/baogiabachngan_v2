# Nén lại ảnh sản phẩm trên Supabase

Ảnh sản phẩm (bucket public `product-images`) chiếm khoảng 97% dung lượng Supabase Storage (đo ngày 14/11/2026: 4.395 ảnh, khoảng 751 MB; riêng PNG 335 MB cho 1.219 ảnh). Công cụ này nén lại ảnh ngay tại chỗ, giữ nguyên đường dẫn và loại file, nên mọi link ảnh trong danh mục, báo giá, đơn hàng và PDF vẫn dùng được.

## Cách nén

- JPEG: thu về tối đa 1200 px cạnh dài, chất lượng 80.
- PNG: thu về tối đa 1200 px, bảng màu 256, giữ nền trong suốt.
- Chỉ ghi đè khi file mới nhỏ hơn ít nhất 15%.
- Giữ nguyên: ảnh dưới 30 KB, GIF, WebP, PNG đã ở dạng bảng màu, ảnh không đọc được.
- Chạy lại nhiều lần không làm ảnh xấu thêm.

Đo trên 16 ảnh mẫu lấy ngẫu nhiên: 4,9 MB còn 1,0 MB (giảm 79%), so bằng mắt không thấy khác.

## Cách chạy

GitHub → Actions → **Nén lại ảnh sản phẩm** → Run workflow.

1. Lần đầu để `mode = dry-run`: chỉ đo và in bảng kết quả, không ghi gì.
2. Xem bảng "Tiết kiệm" trong phần Summary của lượt chạy.
3. Chạy lại với `mode = apply` để ghi đè. Để `backup` bật: bản gốc được lưu thành artifact `product-image-originals` trong 14 ngày.

`limit` cho phép thử trên N ảnh nặng nhất trước (ví dụ 50).

## An toàn

- Sau mỗi lần ghi, công cụ tải lại file để kiểm dung lượng; không khớp thì trả bản gốc.
- Ảnh lỗi được giữ nguyên và liệt kê trong kết quả. Quá 5% ảnh lỗi thì lượt chạy báo đỏ.
- Khoá `service_role` lấy tại lúc chạy bằng `SUPABASE_ACCESS_TOKEN` có sẵn của repo và được che trong log.
- Việc ghi đè không hoàn tác được sau khi artifact bản gốc hết hạn 14 ngày.

## Khôi phục

Tải artifact `product-image-originals` của lượt chạy, rồi tải các file cần khôi phục lên lại đúng đường dẫn trong bucket `product-images` (Supabase → Storage).
