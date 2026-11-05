-- Read-only deployment gate. Never applies the customer's production migration implicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('sapo_customers','customer_type'), ('sapo_customers','data_source'),
      ('appsheet_customer_links','app_id'), ('appsheet_customer_links','table_name'),
      ('appsheet_customer_links','row_id'), ('appsheet_customer_links','customer_id'),
      ('appsheet_customer_links','state'), ('appsheet_customer_links','source_created_at'),
      ('appsheet_customer_links','source_updated_at'), ('appsheet_customer_links','approval_raw'),
      ('appsheet_customer_links','source_json'), ('appsheet_customer_links','applied_json'), ('appsheet_customer_links','synced_at'),
      ('appsheet_contact_links','app_id'), ('appsheet_contact_links','table_name'), ('appsheet_contact_links','row_id'),
      ('appsheet_contact_links','contact_id'), ('appsheet_contact_links','customer_row_id'),
      ('appsheet_contact_links','source_updated_at'), ('appsheet_contact_links','source_json'),
      ('appsheet_contact_links','applied_json'), ('appsheet_contact_links','synced_at'),
      ('appsheet_sync_runs','id'), ('appsheet_sync_runs','actor_id'), ('appsheet_sync_runs','app_id'),
      ('appsheet_sync_runs','plan_hash'), ('appsheet_sync_runs','summary_json'), ('appsheet_sync_runs','created_at')
    ) AS required(table_name,column_name)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
      AND c.table_name=required.table_name AND c.column_name=required.column_name AND c.data_type='text')
  ) OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('appsheet_customer_links','appsheet_contact_links','appsheet_sync_runs')
        AND c.relrowsecurity AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary)) <> 3 THEN
    RAISE EXCEPTION 'Missing AppSheet customer schema. Obtain owner approval and apply migrations/postgres/20261105025522_appsheet_customer_sync.sql before deployment.';
  END IF;
END $$;
