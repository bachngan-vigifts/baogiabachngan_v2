CREATE TABLE public.pos_promotion_programs (
 register_id text PRIMARY KEY REFERENCES public.pos_registers(id),
 title text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 threshold double precision NOT NULL,
 gift_sku text NOT NULL REFERENCES public.products(sku),
 gift_qty integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 1,
 updated_at text NOT NULL, updated_by text REFERENCES public.staff_members(id),
 CONSTRAINT chk_pos_promotion_values CHECK(threshold>=0 AND threshold<=100000000000 AND threshold=trunc(threshold) AND gift_qty>0 AND gift_qty<=100 AND revision>0 AND length(trim(title)) BETWEEN 1 AND 200)
);
ALTER TABLE public.pos_promotion_programs ENABLE ROW LEVEL SECURITY;
-- Only the verified Minh Long showroom; no name substring matching or other-register defaults.
INSERT INTO public.pos_promotion_programs(register_id,title,enabled,threshold,gift_sku,gift_qty,updated_at)
SELECT r.id,'Minh Long · Tặng bộ 2 chén Gourmet',true,1000000,p.sku,1,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM public.pos_registers r CROSS JOIN public.products p
WHERE r.name='Showroom Gốm Sứ Minh Long Cần Thơ' AND r.active=true AND p.sku='031059000B2' AND p.active=true AND p.approval_status='approved';
