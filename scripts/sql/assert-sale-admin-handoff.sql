DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_quotations' AND column_name='support_assignee_id' AND data_type='text') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_quotations' AND column_name='support_assignment_revision' AND data_type='bigint' AND is_nullable='NO') THEN
 RAISE EXCEPTION 'Apply 20261121102152_sale_admin_handoff.sql before deploying Sale Admin handoff'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.staff_quotations'::regclass AND confrelid='public.staff_members'::regclass AND contype='f' AND confdeltype='n' AND convalidated AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (support_assignee_id)%') THEN RAISE EXCEPTION 'Missing Sale Admin handoff foreign key'; END IF;
END $$;
