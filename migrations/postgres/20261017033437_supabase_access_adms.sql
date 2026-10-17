-- Truy cập qua backend CRM đã kiểm quyền Manager, không qua Data API công khai.
REVOKE ALL ON TABLE "hr_adms_logs", "hr_adms_members", "hr_adms_sync_state" FROM PUBLIC, anon, authenticated;
