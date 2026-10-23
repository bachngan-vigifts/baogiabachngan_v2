-- Liên kết Sapo theo từng đợt nhận; không suy diễn/bổ sung dữ liệu của phiếu cũ.
alter table supplier_receipts add column if not exists sapo_purchase_order_id text not null default '';
alter table supplier_receipts add column if not exists sapo_receipt_id text not null default '';
alter table supplier_receipts add column if not exists sapo_receipt_url text not null default '';
alter table supplier_receipts add column if not exists sapo_verified_at text;
--> statement-breakpoint
create table if not exists supplier_receipt_jobs (
 receipt_id text primary key references supplier_receipts(id),
 action text not null check (action in ('create_purchase_receipt','reconcile_existing')),
 status text not null check (status in ('queued','processing','callback_pending','done','failed','needs_review')),
 payload text not null, payload_hash text not null,
 attempts bigint not null default 0 check (attempts>=0),
 dispatch_token text, dispatch_until text,
 lease_token text, lease_until text,
 reconciliation_id text, expected_link text,
 last_error text not null default '', created_at text not null, updated_at text not null
);
--> statement-breakpoint
alter table supplier_receipt_jobs enable row level security;
revoke all on supplier_receipt_jobs from public;
--> statement-breakpoint
create index if not exists idx_supplier_receipt_jobs_pending on supplier_receipt_jobs(status,updated_at);
--> statement-breakpoint
-- Chỉ server/service role dùng outbox. Không trả payload chứa giá qua Data API public.
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then execute 'revoke all on supplier_receipt_jobs from anon'; end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on supplier_receipt_jobs from authenticated'; end if;
 if exists(select 1 from pg_roles where rolname='service_role') then execute 'grant all on supplier_receipt_jobs to service_role'; end if;
end $$;

--> statement-breakpoint
create unique index if not exists idx_supplier_receipts_sapo_id on supplier_receipts(sapo_receipt_id) where sapo_receipt_id <> '';
--> statement-breakpoint
alter table supplier_receipts add constraint chk_supplier_receipt_verified check (sapo_verified_at is null or (sapo_receipt_id <> '' and sapo_purchase_order_id <> '' and sapo_receipt_code <> '' and sapo_receipt_url <> '' and sapo_status='done'));
