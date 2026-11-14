# Web Lock (locknlockonline.com)

Mã nguồn WordPress/WooCommerce đề xuất cho web Lock: plugin nhỏ, snippet và script đồng bộ. Thư mục này không tự triển khai lên web. Mỗi thay đổi được cài lên web thật chỉ sau khi anh Thái duyệt.

- Agent phụ trách: `.claude/agents/woocommerce-web.md`.
- Đọc cấu trúc web (chỉ GET): workflow "Đọc cấu trúc Web Lock" (`.github/workflows/probe-woo-lock-structure.yml`). Workflow dùng các secret `WC_BASE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`.
- Mã cầu nối GHN và CRM đã có: `handoff/lock-ghn-wordpress/`.
- Sửa web: viết kế hoạch vào `web-lock/changes/<tên>.json`, rồi chạy workflow "Sửa web Lock" (`woo-lock-apply.yml`). Lượt `dry-run` chỉ xem trước; lượt `apply` mới ghi, kèm sao lưu và kế hoạch hoàn tác trong artifact.
