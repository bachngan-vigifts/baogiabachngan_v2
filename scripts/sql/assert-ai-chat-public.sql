-- Read-only gate for 20261118040000_ai_chat_public_questions.sql; never repairs schema/data.
DO $assert$
DECLARE spec record; col record; tbl regclass; role_name text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES ('ai_chat_questions'),('ai_chat_helpful_votes')) AS tables(name) LOOP
  tbl:=to_regclass('public.'||spec.name);
  IF tbl IS NULL THEN RAISE EXCEPTION 'Apply 20261118040000_ai_chat_public_questions.sql: missing %',spec.name; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=tbl AND relrowsecurity) THEN
   RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: RLS disabled on %',spec.name;
  END IF;
  FOR col IN SELECT * FROM (VALUES
   ('ai_chat_questions','id','NO'),('ai_chat_questions','question','NO'),('ai_chat_questions','answer','NO'),
   ('ai_chat_questions','topic','NO'),('ai_chat_questions','status','NO'),('ai_chat_questions','created_by','NO'),
   ('ai_chat_questions','callback_token_hash','YES'),('ai_chat_questions','error','NO'),
   ('ai_chat_questions','created_at','NO'),('ai_chat_questions','answered_at','YES'),('ai_chat_questions','updated_at','NO'),
   ('ai_chat_helpful_votes','question_id','NO'),('ai_chat_helpful_votes','member_id','NO'),('ai_chat_helpful_votes','created_at','NO')
  ) AS cols(tab,name,nullable) WHERE tab=spec.name LOOP
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=spec.name
    AND column_name=col.name AND data_type='text' AND is_nullable=col.nullable) THEN
    RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: column %.%',spec.name,col.name;
   END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   IF has_table_privilege(role_name,tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: direct privileges on % for %',spec.name,role_name;
   END IF;
   END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=tbl AND a.grantee=0) THEN
   RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: PUBLIC privileges on %',spec.name;
  END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
  ('ai_chat_questions','id','p'),('ai_chat_helpful_votes','question_id,member_id','p')
 ) AS keys(tab,cols,kind) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
   WHERE c.conrelid=to_regclass('public.'||spec.tab) AND c.contype=spec.kind::"char" AND i.indisvalid AND i.indisready
   AND (SELECT string_agg(a.attname,',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num)=spec.cols) THEN
   RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: primary key on %',spec.tab;
  END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
  ('ai_chat_questions','created_by','staff_members','id'),('ai_chat_helpful_votes','member_id','staff_members','id'),
  ('ai_chat_helpful_votes','question_id','ai_chat_questions','id')
 ) AS refs(tab,col,target,target_col) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.'||spec.tab) AND c.contype='f' AND c.convalidated
   AND c.confrelid=to_regclass('public.'||spec.target)
   AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname=spec.col)]::smallint[]
   AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname=spec.target_col)]::smallint[]) THEN
   RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: foreign key %.%',spec.tab,spec.col;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_chat_questions'::regclass AND conname='chk_ai_chat_questions_status' AND contype='c' AND convalidated) THEN
  RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: status constraint';
 END IF;
 FOR spec IN SELECT * FROM (VALUES
  ('ai_chat_questions','created_at'),('ai_chat_questions','status,updated_at'),('ai_chat_helpful_votes','member_id')
 ) AS indexes(tab,cols) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('public.'||spec.tab) AND i.indisvalid AND i.indisready
   AND i.indpred IS NULL AND (SELECT string_agg(a.attname,',' ORDER BY k.ord) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,ord)
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num)=spec.cols) THEN
   RAISE EXCEPTION 'Incomplete 20261118040000_ai_chat_public_questions.sql: index %.%',spec.tab,spec.cols;
  END IF;
 END LOOP;
END
$assert$;
SELECT 'ai_chat_public_ready' AS result;
