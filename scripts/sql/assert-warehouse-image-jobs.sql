-- Read-only gate. Apply 20261115233000_warehouse_image_job_queue.sql separately; this never repairs production.
DO $$
DECLARE spec record; tbl regclass; col record;
BEGIN
 FOR spec IN SELECT * FROM (VALUES ('warehouse_image_queue_state'),('warehouse_image_jobs')) AS tables(name) LOOP
  tbl:=to_regclass('public.'||spec.name);
  IF tbl IS NULL THEN RAISE EXCEPTION 'Apply 20261115233000_warehouse_image_job_queue.sql: missing %',spec.name; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=tbl AND relrowsecurity) THEN
   RAISE EXCEPTION 'Incomplete 20261115233000_warehouse_image_job_queue.sql: RLS disabled on %',spec.name;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
   WHERE c.conrelid=tbl AND c.contype='p' AND i.indisvalid AND i.indisready
   AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=tbl AND attname='id')]::smallint[]) THEN
   RAISE EXCEPTION 'Incomplete 20261115233000_warehouse_image_job_queue.sql: primary key on %',spec.name;
  END IF;
  FOR col IN SELECT * FROM (VALUES
   ('id','text','NO'),('updated_at','text','NO'),
   ('image_hash','text','NO'),('source','text','NO'),('image_payload','text','NO'),('status','text','NO'),
   ('position_hint','integer','NO'),('callback_token_hash','text','YES'),('created_by','text','NO'),
   ('started_at','text','YES'),('finished_at','text','YES'),('draft_id','text','YES'),('draft_no','text','YES'),
   ('draft_url','text','YES'),('pxk_no','text','YES'),('warnings','text','NO'),('last_error','text','NO'),('created_at','text','NO')
  ) AS cols(name,typ,nullable) WHERE spec.name='warehouse_image_jobs' OR name IN ('id','updated_at') LOOP
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=spec.name
    AND column_name=col.name AND data_type=col.typ AND is_nullable=col.nullable) THEN
    RAISE EXCEPTION 'Incomplete 20261115233000_warehouse_image_job_queue.sql: column %.%',spec.name,col.name;
   END IF;
  END LOOP;
 END LOOP;
 tbl:='public.warehouse_image_jobs'::regclass;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid WHERE c.conrelid=tbl AND c.contype='u'
  AND i.indisvalid AND i.indisready AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=tbl AND attname='image_hash')]::smallint[]) THEN
  RAISE EXCEPTION 'Incomplete 20261115233000_warehouse_image_job_queue.sql: image hash uniqueness';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=tbl AND conname='chk_warehouse_image_jobs_status' AND contype='c' AND convalidated) THEN
  RAISE EXCEPTION 'Incomplete 20261115233000_warehouse_image_job_queue.sql: status constraint';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid=tbl AND indisvalid AND indisready
  AND indkey::text=(SELECT string_agg(attnum::text,' ' ORDER BY ord) FROM (VALUES ('status',1),('created_at',2)) AS cols(name,ord)
   JOIN pg_attribute a ON a.attrelid=tbl AND a.attname=cols.name)) THEN
  RAISE EXCEPTION 'Incomplete 20261115233000_warehouse_image_job_queue.sql: queue index';
 END IF;
END $$;
