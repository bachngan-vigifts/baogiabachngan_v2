ALTER TABLE public.packing_slips
 ADD COLUMN plan_source text,
 ADD COLUMN planned_delivery_date text,
 ADD CONSTRAINT chk_packing_plan_source CHECK(plan_source IS NULL OR plan_source IN ('stock','transfer','purchase','incoming')),
 ADD CONSTRAINT chk_packing_planned_delivery_date CHECK(planned_delivery_date IS NULL OR (planned_delivery_date ~ '^\d{4}-\d{2}-\d{2}$' AND planned_delivery_date::date::text=planned_delivery_date));
COMMENT ON COLUMN public.packing_slips.planned_delivery_date IS 'Customer-confirmed delivery date for this source allocation; never inferred from supplier arrival text.';
