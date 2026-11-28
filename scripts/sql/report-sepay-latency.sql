-- Báo cáo CHỈ ĐỌC: độ trễ từ lúc ngân hàng ghi giao dịch đến lúc CRM ghi nhận.
-- Một câu SELECT, không ghi CSDL. Không trả nội dung chuyển khoản, số tài khoản, số tiền hay tên khách.
-- __DAYS__ được workflow thay bằng số ngày (1–14) đã kiểm tra.
with cfg as (select now() - make_interval(days => __DAYS__) as since),
pulls as (
  select created_at::timestamptz as at from audit_logs, cfg
  where action = 'sepay.pull-today' and created_at::timestamptz >= cfg.since - interval '1 hour'
),
tx as (
  select t.transaction_at::timestamptz as bank_at, t.received_at::timestamptz as crm_at, t.status, t.match_method,
    exists(select 1 from pulls p where abs(extract(epoch from p.at - t.received_at::timestamptz)) <= 30) as via_pull
  from sepay_transactions t, cfg
  where t.transfer_type = 'in' and t.transaction_at::timestamptz >= cfg.since
),
txd as (select *, extract(epoch from crm_at - bank_at) as delay_s, case when via_pull then 'lich_tai_5_phut' else 'webhook' end as source from tx),
qr as (
  select r.id, r.created_at::timestamptz as qr_at, r.confirmed_at::timestamptz as confirmed_at,
    exists(select 1 from sales_orders o where o.pos_payment_request_id = r.id) as has_order,
    (select min(t.transaction_at::timestamptz) from sepay_transactions t
      where t.transfer_type = 'in'
        and t.transaction_at::timestamptz between r.created_at::timestamptz - interval '10 minutes' and r.created_at::timestamptz + interval '2 hours'
        and position(('POS' || left(upper(replace(r.id, '-', '')), 12)) in upper(regexp_replace(t.content, '[^A-Za-z0-9]', '', 'g'))) > 0) as bank_at
  from pos_payment_requests r, cfg
  where r.created_at::timestamptz >= cfg.since
),
qrd as (
  select *, extract(epoch from confirmed_at - qr_at) as qr_to_confirm_s, extract(epoch from confirmed_at - bank_at) as bank_to_confirm_s from qr
),
stat as (
  select source, count(*) as n,
    round(percentile_cont(0.5) within group (order by delay_s)::numeric, 1) as median_s,
    round(percentile_cont(0.9) within group (order by delay_s)::numeric, 1) as p90_s,
    round(max(delay_s)::numeric, 1) as max_s
  from txd group by source
)
select json_build_object(
  'days', __DAYS__,
  'tien_vao_theo_nguon', coalesce((select json_agg(stat order by source) from stat), '[]'),
  'tien_vao_theo_trang_thai', coalesce((select json_object_agg(k, n) from (select status || '/' || match_method as k, count(*) as n from txd group by 1) s), '{}'),
  'qr_quay', json_build_object(
    'tong', (select count(*) from qrd),
    'da_xac_nhan', (select count(*) from qrd where confirmed_at is not null),
    'chua_xac_nhan_nhung_co_tien_ve', (select count(*) from qrd where confirmed_at is null and bank_at is not null),
    'co_don_ban', (select count(*) from qrd where has_order),
    'tu_luc_hien_qr_den_xac_nhan_median_s', (select round(percentile_cont(0.5) within group (order by qr_to_confirm_s)::numeric, 1) from qrd where confirmed_at is not null),
    'tu_luc_hien_qr_den_xac_nhan_p90_s', (select round(percentile_cont(0.9) within group (order by qr_to_confirm_s)::numeric, 1) from qrd where confirmed_at is not null),
    'tu_luc_ngan_hang_ghi_den_xac_nhan_median_s', (select round(percentile_cont(0.5) within group (order by bank_to_confirm_s)::numeric, 1) from qrd where confirmed_at is not null and bank_at is not null),
    'tu_luc_ngan_hang_ghi_den_xac_nhan_p90_s', (select round(percentile_cont(0.9) within group (order by bank_to_confirm_s)::numeric, 1) from qrd where confirmed_at is not null and bank_at is not null),
    'tu_luc_ngan_hang_ghi_den_xac_nhan_max_s', (select round(max(bank_to_confirm_s)::numeric, 1) from qrd where confirmed_at is not null and bank_at is not null)
  ),
  'chi_tiet_tien_vao_moi_nhat', coalesce((select json_agg(x) from (
    select to_char(bank_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI:SS') as gio_ngan_hang, round(delay_s::numeric, 1) as tre_s, source as nguon, status as trang_thai
    from txd order by bank_at desc limit 40) x), '[]'),
  'chi_tiet_qr_moi_nhat', coalesce((select json_agg(y) from (
    select to_char(qr_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI:SS') as gio_hien_qr,
      round(qr_to_confirm_s::numeric, 1) as hien_qr_den_xac_nhan_s, round(bank_to_confirm_s::numeric, 1) as ngan_hang_den_xac_nhan_s,
      (bank_at is not null) as co_tien_ve, has_order as co_don
    from qrd order by qr_at desc limit 40) y), '[]')
) as report;
