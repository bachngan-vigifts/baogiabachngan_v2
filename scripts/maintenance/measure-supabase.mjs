// Đo máy chủ Supabase (chỉ đọc): log Edge 24h, thống kê CSDL, gọi /health trực tiếp. Không in dữ liệu khách/nhân viên hay khoá.
const REF = 'taceqfnsorewelsbdckg', TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const api = (path, init = {}) => fetch('https://api.supabase.com/v1/projects/' + REF + path, { ...init, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const out = {};
async function logs(name, sql, hours = 24) {
  const end = new Date(), start = new Date(end - hours * 3600e3);
  const q = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
  const r = await api('/analytics/endpoints/logs.all?' + q);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 400); }
  out[name] = r.ok ? (j.result ?? j) : { status: r.status, error: j?.error ?? j };
}
async function db(name, sql) {
  const r = await api('/database/query', { method: 'POST', body: JSON.stringify({ query: sql, read_only: true }) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 400); }
  out[name] = r.ok ? j : { status: r.status, error: j };
}
const PATH = `regexp_replace(regexp_replace(regexp_replace(r.pathname, r'^/functions/v1/baogia-v2-api', ''), r'[0-9a-f]{8}-[0-9a-f-]{27}', ':id'), r'/[A-Za-z0-9_-]{16,}', '/:id')`;
const BASE = `from function_edge_logs t cross join unnest(t.metadata) m cross join unnest(m.request) r cross join unnest(m.response) s where r.pathname like '/functions/v1/baogia-v2-api%'`;
await logs('edge_overall', `select count(*) calls, approx_quantiles(m.execution_time_ms,100)[offset(50)] p50, approx_quantiles(m.execution_time_ms,100)[offset(90)] p90, approx_quantiles(m.execution_time_ms,100)[offset(99)] p99, max(m.execution_time_ms) max_ms, countif(s.status_code>=500) err5xx, countif(s.status_code=401 or s.status_code=403) auth4xx ${BASE}`);
await logs('edge_by_region', `select m.region region, count(*) calls, approx_quantiles(m.execution_time_ms,100)[offset(50)] p50, approx_quantiles(m.execution_time_ms,100)[offset(90)] p90 ${BASE} group by region order by calls desc`);
await logs('edge_slowest_paths', `select r.method method, ${PATH} path, count(*) calls, approx_quantiles(m.execution_time_ms,100)[offset(50)] p50, approx_quantiles(m.execution_time_ms,100)[offset(90)] p90, max(m.execution_time_ms) max_ms ${BASE} group by method, path having calls >= 5 order by p90 desc limit 15`);
await logs('edge_busiest_paths', `select r.method method, ${PATH} path, count(*) calls, approx_quantiles(m.execution_time_ms,100)[offset(50)] p50, approx_quantiles(m.execution_time_ms,100)[offset(90)] p90 ${BASE} group by method, path order by calls desc limit 12`);
await logs('edge_by_hour_vn', `select format_timestamp('%H', t.timestamp, 'Asia/Ho_Chi_Minh') hour_vn, count(*) calls, approx_quantiles(m.execution_time_ms,100)[offset(50)] p50, approx_quantiles(m.execution_time_ms,100)[offset(90)] p90 ${BASE} group by hour_vn order by hour_vn`);
await logs('slow_log_lines', `select count(*) api_slow from function_logs where event_message like '%API slow%'`);
await logs('slow_log_sample', `select regexp_replace(event_message, r'[0-9a-f]{8}-[0-9a-f-]{27}', ':id') msg from function_logs where event_message like '%API slow%' order by timestamp desc limit 15`);
await db('db_overview', `select json_build_object(
  'version', current_setting('server_version'), 'max_connections', current_setting('max_connections')::int,
  'connections', (select json_object_agg(coalesce(state,'(none)'), n) from (select state, count(*) n from pg_stat_activity where datname=current_database() group by state) x),
  'long_running_over_5s', (select count(*) from pg_stat_activity where state='active' and now()-query_start > interval '5 seconds'),
  'db_size_mb', round(pg_database_size(current_database())/1048576.0),
  'cache_hit_pct', (select round(100.0*sum(blks_hit)/nullif(sum(blks_hit)+sum(blks_read),0),2) from pg_stat_database where datname=current_database()),
  'deadlocks', (select deadlocks from pg_stat_database where datname=current_database()),
  'stats_since', (select stats_reset from pg_stat_statements_info)
) as r`);
await db('top_queries_total', `select calls, round(total_exec_time) total_ms, round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time) max_ms, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) query from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and query not ilike '%pg_stat%' order by total_exec_time desc limit 12`);
await db('top_queries_mean', `select calls, round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time) max_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) query from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and calls >= 20 and query not ilike '%pg_stat%' order by mean_exec_time desc limit 10`);
await db('tables', `select relname, n_live_tup live, n_dead_tup dead, round(pg_total_relation_size(relid)/1048576.0,1) mb, seq_scan, idx_scan, last_autovacuum, last_autoanalyze from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 12`);
await db('seq_heavy', `select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup live from pg_stat_user_tables where seq_scan > 1000 and n_live_tup > 2000 order by seq_tup_read desc limit 8`);
// Gọi /health trực tiếp (máy đo ở Mỹ: thời gian mạng cao hơn ở VN; xem Server-Timing để tách phần máy chủ)
const health = [];
for (const region of ['', 'ap-northeast-2']) for (let i = 0; i < 8; i++) {
  const t0 = performance.now();
  const r = await fetch(`https://${REF}.supabase.co/functions/v1/baogia-v2-api/api/staff/health${region ? '?forceFunctionRegion=' + region : ''}`).catch(e => ({ ok: false, status: String(e.message) }));
  const ms = Math.round(performance.now() - t0); let body = null; try { body = await r.json(); } catch {}
  health.push({ region: region || 'mặc định', i, status: r.status, ms, mode: body?.databaseMode, timing: r.headers?.get?.('server-timing'), edgeRegion: r.headers?.get?.('x-sb-edge-region') });
}
out.health = health;
console.log(JSON.stringify(out, null, 2));
