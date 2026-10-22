alter table public.deliveries add column if not exists tracking_code text not null default '';
alter table public.deliveries add column if not exists tracking_status text not null default '';
alter table public.deliveries add column if not exists tracking_updated_at text;
create index if not exists idx_deliveries_tracking_code on public.deliveries(tracking_code) where tracking_code <> '';

update public.deliveries d
set tracking_code = upper((regexp_match(o.note, '(?i)(?:^|[^A-Z0-9])GHN[-:#[:space:]]*([A-Z0-9]{6,24})(?:$|[^A-Z0-9])'))[1]),
    carrier = case when d.carrier = '' then 'GHN' else d.carrier end
from public.sales_orders o
where o.id = d.order_id and d.tracking_code = '' and o.channel = 'pos' and o.fulfillment_mode = 'cod'
  and o.note ~* '(?:^|[^A-Z0-9])GHN[-:#[:space:]]*[A-Z0-9]{6,24}(?:$|[^A-Z0-9])';
