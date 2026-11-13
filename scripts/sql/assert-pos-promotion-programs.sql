-- Read-only deployment gate; never creates/seeds/repairs production data.
-- Apply 20261113054030_pos_promotion_programs.sql separately before deploying this API.
DO $$
DECLARE r regclass := to_regclass('public.pos_promotion_programs'); required record;
BEGIN
 IF r IS NULL THEN
  RAISE EXCEPTION 'Apply 20261113054030_pos_promotion_programs.sql: missing pos_promotion_programs';
 END IF;
 FOR required IN SELECT * FROM (VALUES
  ('register_id','text','NO'),('title','text','NO'),('enabled','boolean','NO'),
  ('threshold','double precision','NO'),('gift_sku','text','NO'),('gift_qty','integer','NO'),
  ('revision','integer','NO'),('updated_at','text','NO'),('updated_by','text','YES')
 ) AS cols(col,typ,nullable) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='pos_promotion_programs'
     AND column_name=required.col AND data_type=required.typ AND is_nullable=required.nullable) THEN
   RAISE EXCEPTION 'Incomplete 20261113054030_pos_promotion_programs.sql: column %',required.col;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=r AND relrowsecurity) THEN
  RAISE EXCEPTION 'Incomplete 20261113054030_pos_promotion_programs.sql: RLS disabled';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
   WHERE c.conrelid=r AND c.contype='p' AND i.indisvalid AND i.indisready
     AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=r AND attname='register_id')]::smallint[]) THEN
  RAISE EXCEPTION 'Incomplete 20261113054030_pos_promotion_programs.sql: register primary key';
 END IF;
 FOR required IN SELECT * FROM (VALUES
  ('register_id','pos_registers','id'),('gift_sku','products','sku'),('updated_by','staff_members','id')
 ) AS refs(col,tbl,target_col) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=r AND c.contype='f' AND c.convalidated
    AND c.confrelid=to_regclass('public.'||required.tbl)
    AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=r AND attname=required.col)]::smallint[]
    AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname=required.target_col)]::smallint[]) THEN
   RAISE EXCEPTION 'Incomplete 20261113054030_pos_promotion_programs.sql: foreign key %',required.col;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=r AND contype='c'
   AND conname='chk_pos_promotion_values' AND convalidated) THEN
  RAISE EXCEPTION 'Incomplete 20261113054030_pos_promotion_programs.sql: values constraint';
 END IF;
END $$;
