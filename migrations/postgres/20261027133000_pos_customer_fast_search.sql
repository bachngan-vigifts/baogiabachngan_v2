-- POS customer lookup: keep one pre-folded search document and index contains queries.
-- Backfill protects records created before every write path consistently populated `search`.
do $$
begin
  create extension if not exists pg_trgm;
exception when feature_not_supported or undefined_file then
  -- PGlite/test runtimes do not package pg_trgm; production PostgreSQL/Supabase does.
  raise notice 'pg_trgm is unavailable; skipping the optional POS customer search index';
end $$;
--> statement-breakpoint
update "sapo_customers"
set "search" = btrim(regexp_replace(translate(lower(
  coalesce("name", '') || ' ' || coalesce("contact", '') || ' ' || coalesce("phone", '') || ' ' ||
  coalesce("email", '') || ' ' || coalesce("address", '') || ' ' || coalesce("tax_code", '') || ' ' ||
  coalesce("customer_code", '')
), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
   'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'), '\s+', ' ', 'g'))
where "search" = '';
--> statement-breakpoint
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists "idx_sapo_customers_search_trgm"
      on "sapo_customers" using gin ("search" gin_trgm_ops);
  end if;
end $$;
