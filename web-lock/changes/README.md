# Kế hoạch sửa web Lock

Mỗi file `<ngày>-<việc>.json` là một kế hoạch:

```json
{ "title": "Bổ sung cân nặng nhóm Bình nước", "ops": [
  { "method": "PUT", "path": "/products/21708", "body": { "weight": "0.6" }, "note": "LHC8055SBL" }
] }
```

Đường dẫn được phép: `/products/<id>`, `/products/<id>/variations/<id>`, `/products/categories|tags|brands|attributes/<id>`, `/products/attributes/<id>/terms/<id>`. POST chỉ dùng để tạo mới các mục này. Không có DELETE.
