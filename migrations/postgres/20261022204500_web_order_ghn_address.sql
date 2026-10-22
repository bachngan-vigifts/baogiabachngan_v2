alter table "web_store_orders" add column if not exists "ghn_address_snapshot" text default '{}' not null;
