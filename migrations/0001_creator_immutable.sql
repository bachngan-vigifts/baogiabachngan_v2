-- Chủ của báo giá (người tạo) không bao giờ đổi, dù có người khác cùng làm hoặc được giao phụ trách.
-- Muốn đổi người PHỤ TRÁCH thì dùng cột assignee_id. Trigger này chặn ngay cả khi code ứng dụng có lỗi.
-- Nếu sau này thật sự cần chuyển quyền chủ (vd nhân viên nghỉ việc), phải tạo migration có chủ đích gỡ/tạm tắt trigger này.
CREATE TRIGGER trg_quotations_creator_immutable
BEFORE UPDATE OF creator_id ON staff_quotations
FOR EACH ROW WHEN OLD.creator_id <> NEW.creator_id
BEGIN
  SELECT RAISE(ABORT, 'creator_id của báo giá không được đổi');
END;
