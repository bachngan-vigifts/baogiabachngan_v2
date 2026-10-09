// Liên kết kích hoạt trỏ tới /login.html#email=…&token=…; phần sau dấu # không gửi lên máy chủ, giữ nguyên khi chuyển trang.
location.replace('index.html' + location.hash);
