DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='web_store_orders' AND column_name IN ('crm_edit_snapshot','crm_order_no')) <> 2 THEN
   RAISE EXCEPTION 'Run 20261102123212_web_order_crm_edit.sql manually before deploying this API';
 END IF;
END $$;
