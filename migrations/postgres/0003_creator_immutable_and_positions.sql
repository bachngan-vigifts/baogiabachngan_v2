-- Chủ báo giá bất biến; người phụ trách vẫn đổi được.
CREATE FUNCTION public.prevent_quotation_creator_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.creator_id IS DISTINCT FROM NEW.creator_id THEN
    RAISE EXCEPTION 'creator_id của báo giá không được đổi' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_quotations_creator_immutable
BEFORE UPDATE OF creator_id ON public.staff_quotations
FOR EACH ROW EXECUTE FUNCTION public.prevent_quotation_creator_change();
--> statement-breakpoint
INSERT INTO public.staff_positions (id, name) VALUES
  ('manager', 'Manager'), ('sale', 'Sale'), ('sale-admin', 'Sale Admin'),
  ('sales-ml', 'NVBH ML'), ('sales-lock', 'NVBH LOCK'), ('warehouse', 'Kho'),
  ('accounting', 'Kế toán'), ('supplier', 'NCC') ON CONFLICT DO NOTHING;
