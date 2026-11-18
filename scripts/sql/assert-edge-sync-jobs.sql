-- Read-only gate for 20261118050000_edge_sync_jobs.sql; never repairs schema or data.
DO $assert$
DECLARE tbl regclass; col record; role_name text;
BEGIN
 tbl:=to_regclass('public.edge_sync_jobs');
 IF tbl IS NULL THEN RAISE EXCEPTION 'Apply 20261118050000_edge_sync_jobs.sql: missing edge_sync_jobs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=tbl AND relrowsecurity) THEN
  RAISE EXCEPTION 'Incomplete 20261118050000_edge_sync_jobs.sql: RLS required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='edge_sync_jobs') THEN
  RAISE EXCEPTION 'Incomplete 20261118050000_edge_sync_jobs.sql: internal queue must not have client policies';
 END IF;
 FOR col IN SELECT * FROM (VALUES
  ('key','text','NO'),('kind','text','NO'),('status','text','NO'),('state','text','NO'),('result','text','NO'),
  ('token','text','YES'),('lease_until','text','NO'),('available_at','text','NO'),('updated_at','text','NO'),
  ('attempts','integer','NO'),('error_code','text','YES')) AS cols(name,typ,nullable) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='edge_sync_jobs'
   AND column_name=col.name AND data_type=col.typ AND is_nullable=col.nullable) THEN
   RAISE EXCEPTION 'Incomplete 20261118050000_edge_sync_jobs.sql: column %',col.name;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=tbl AND c.contype='p'
  AND array_length(c.conkey,1)=1 AND c.conkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=tbl AND attname='key')) THEN
  RAISE EXCEPTION 'Incomplete 20261118050000_edge_sync_jobs.sql: primary key';
 END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   IF has_table_privilege(role_name,tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Incomplete 20261118050000_edge_sync_jobs.sql: direct browser privilege';
   END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=tbl AND a.grantee=0) THEN
  RAISE EXCEPTION 'Incomplete 20261118050000_edge_sync_jobs.sql: PUBLIC privilege';
 END IF;
END $assert$;
