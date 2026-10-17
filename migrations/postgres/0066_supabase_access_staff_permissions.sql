-- Phòng ban, quyền theo chức vụ, nhật ký phân quyền: chỉ API máy chủ truy cập; không công khai qua Data API.
REVOKE ALL ON TABLE public."staff_departments" FROM anon, authenticated;
REVOKE ALL ON TABLE public."staff_position_permissions" FROM anon, authenticated;
REVOKE ALL ON TABLE public."staff_permission_log" FROM anon, authenticated;
