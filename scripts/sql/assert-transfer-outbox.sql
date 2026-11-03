-- Read-only deploy gate: catch partial migration before replacing a working API.
DO $$
DECLARE expected record;
BEGIN
 FOR expected IN
  SELECT * FROM (VALUES
   ('stock_transfer_lines','received_qty'),('stock_transfer_lines','shipped_qty'),
   ('stock_transfers','shipped_by'),('stock_transfers','shipped_at'),('stock_transfers','shipped_note'),
   ('stock_transfer_integration_settings','id'),('stock_transfer_integration_settings','enabled'),
   ('stock_transfer_integration_settings','integration_activated_at'),('stock_transfer_integration_settings','updated_at'),
   ('stock_transfer_outbox','idempotency_key'),('stock_transfer_outbox','transfer_id'),
   ('stock_transfer_outbox','payload_hash'),('stock_transfer_outbox','payload'),('stock_transfer_outbox','status'),
   ('stock_transfer_outbox','attempt_count'),('stock_transfer_outbox','dispatch_token'),('stock_transfer_outbox','dispatch_until'),
   ('stock_transfer_outbox','next_attempt_at'),('stock_transfer_outbox','claim_token'),('stock_transfer_outbox','claimed_at'),
   ('stock_transfer_outbox','processed_at'),('stock_transfer_outbox','destination_system'),('stock_transfer_outbox','destination_id'),
   ('stock_transfer_outbox','destination_no'),('stock_transfer_outbox','destination_url'),('stock_transfer_outbox','last_error'),
   ('stock_transfer_outbox','created_at'),('stock_transfer_outbox','updated_at')
  ) AS required(table_name,column_name)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name) THEN
   RAISE EXCEPTION 'Transfer migration incomplete: %.%. Run 20261102104511_transfer_received_outbox.sql and prerequisite 20261102120000_transfer_receive.sql before deployment',expected.table_name,expected.column_name;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.stock_transfer_outbox'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.stock_transfer_integration_settings'::regclass AND relrowsecurity) THEN
   RAISE EXCEPTION 'Transfer integration tables require RLS';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.stock_transfer_outbox'::regclass AND indisprimary AND indisvalid)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_transfer_outbox'::regclass AND contype='u' AND convalidated)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_transfer_lines'::regclass AND conname='chk_stock_transfer_lines_shipped' AND convalidated) THEN
   RAISE EXCEPTION 'Transfer integration migration lacks valid uniqueness/quantity constraints';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_transfer_integration_settings WHERE id='stock_transfer_received_v1') THEN
   RAISE EXCEPTION 'Transfer integration settings row is missing';
 END IF;
END $$;
