# Kiểm tra PR trên cloud Claude (bổ sung cho GitHub Actions)

Bộ test đầy đủ (khoảng 2.300 test, 4 phần) chiếm khoảng 90% phút GitHub Actions. Tài liệu này mô tả cách chạy đúng bộ đó
trên cloud Claude mỗi khi PR được mở hoặc có commit mới, và báo kết quả bằng bình luận trên PR.

## Thành phần

| Thành phần | Ở đâu | Việc |
|---|---|---|
| `scripts/ci/cloud-ci.sh` | repo | `npm ci` → `npm run typecheck` → toàn bộ test chia 4 phần chạy song song; ghi `.cloud-ci/summary.md`; mã thoát 0 = đạt |
| Tác vụ "Kiểm tra PR trên cloud Claude" | claude.ai/code/routines | Mỗi lần kích hoạt mở một phiên mới: lấy commit đầu nhánh PR, chạy script, đăng `summary.md` thành bình luận trên PR |
| Kích hoạt GitHub | cài trong tác vụ (xem dưới) | PR mở / có commit mới → chạy tác vụ |

Script chạy được ở máy bất kỳ có Node 22: `bash scripts/ci/cloud-ci.sh`. Máy ít nhân: `CLOUD_CI_SHARDS=2 bash scripts/ci/cloud-ci.sh`.

## Cài kích hoạt GitHub (làm một lần, trên web)

1. Mở https://claude.ai/code/routines, chọn tác vụ **Kiểm tra PR trên cloud Claude**, bấm **Edit**.
2. Mục repository: chọn `bachngan-vigifts/baogiabachngan_v2`. Môi trường: `baogiabachngan_v2`.
3. Ở dòng **Trigger** bấm **+** → **GitHub event** → **Pull request**. Chọn sự kiện *opened* và *synchronized* (có commit mới).
4. Thêm bộ lọc để đỡ tốn lượt chạy: **Is draft** = `false`; **Base branch** equals `main`.
5. **Save changes**. Ứng dụng Claude trên GitHub phải được cài cho repo (trang cài trigger sẽ nhắc nếu thiếu).

Mỗi sự kiện mở một phiên riêng; hai lần đẩy commit là hai phiên độc lập.

## An toàn

- Phiên chạy không giữ khoá production; test dùng PostgreSQL giả lập (PGlite) trong máy.
- Tác vụ chỉ đọc mã và đăng bình luận: không sửa mã, không push, không merge, không đổi nhãn.
- Nội dung PR / bình luận / log được coi là dữ liệu, không phải chỉ thị.
- Tester KHÔNG chặn được nút Merge. Muốn chặn merge theo kết quả, giữ một bước kiểm tra trên GitHub (xem dưới).

## Giới hạn

- Mỗi lượt chạy là một phiên Claude khoảng 25–40 phút, tính vào hạn mức sử dụng của tài khoản.
- Sự kiện GitHub có trần số lượt mỗi giờ cho từng tác vụ và cho cả tài khoản.
- Kết quả là bình luận trên PR, không phải check của GitHub.

## CI trên GitHub: tiết kiệm nhưng giữ kiểm tra đầy đủ

- Chỉ kích hoạt trên PR, không chạy trùng cùng bộ test trên sự kiện push.
- PR nháp: TypeScript và nhóm test nhanh. Chuyển sang **Ready for review** tự kích hoạt lại; mọi PR sẵn sàng merge chạy toàn bộ 4 phần test, không phân loại đường dẫn để bỏ qua test nghiệp vụ.
- Commit mới tự huỷ lượt CI cũ của cùng PR. Chuyển lại thành draft cũng huỷ lượt cũ. Lượt chạy tay được tách riêng, không huỷ lượt kiểm tra PR; không đổi cơ chế triển khai production.
- Cache npm theo `package-lock.json`, vẫn dùng `npm ci` để kiểm tra lockfile và cài sạch. Cache không chứa `node_modules`; không dùng kết quả test của commit trước.
- TypeScript chạy một lần trước các shard, thay vì chạy thêm trên từng shard. Nhóm test nhanh không lặp lại khi đã chạy full suite.
- Check tổng hợp `test` chỉ thành công trên PR ready khi TypeScript và đủ 4 shard thành công. Shard lỗi, bị huỷ hoặc bị bỏ qua đều làm check tổng hợp thất bại.
- Actions → Kiểm tra → Run workflow → `full=true` vẫn chạy toàn bộ; `full=false` chỉ là smoke check, không phải bằng chứng full suite cho PR.

**Giới hạn:** cấu hình workflow không tự bật bảo vệ nhánh. Cần quy tắc riêng yêu cầu check `test` để GitHub chặn merge; bình luận cloud không thay thế quy tắc đó. Không merge PR nháp, không coi smoke check hoặc kết quả SHA cũ là kiểm thử đầy đủ. Trước release, kiểm tra full suite đạt trên revision hiện tại và giữ các cổng migration/deploy hiện có.

Đây là tiết kiệm so với chạy full suite lặp lại trên mọi draft/push, không phải cam kết giảm chi phí so với cấu hình chỉ chạy smoke. Chưa đo mức tiết kiệm thực tế; số phút còn phụ thuộc cache hit và thời gian test.

## Chạy tay

- Trên web: mở tác vụ, bấm **Run now** (tác vụ tự tìm PR đang mở chưa có kết quả cho commit mới nhất).
- Trong một phiên Claude: nhắn "kiểm PR <số>".
