alter table "web_store_orders" add column if not exists "ghn_order_code" text default '' not null;
alter table "web_store_orders" add column if not exists "ghn_status" text default '' not null;
alter table "web_store_orders" add column if not exists "ghn_sort_code" text default '' not null;
alter table "web_store_orders" add column if not exists "ghn_fee" double precision default 0 not null;
