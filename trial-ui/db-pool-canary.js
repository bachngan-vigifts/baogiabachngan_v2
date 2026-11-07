// THỬ POOLER CÓ KIỂM SOÁT (07/11/2026) – chỉ Manager, chỉ máy này (mục "Đo tốc độ").
// Bật: mọi lượt gọi API của máy này gửi header `x-db-pool: pooler` → Edge dùng transaction pooler (nếu deploy đã đặt secret thử
// DB_POOLER_CANARY_URL; chưa có thì máy chủ bỏ qua header, Server-Timing vẫn ghi dbmode="direct"). Máy khác không bị ảnh hưởng.
// Tắt: bỏ chọn – có hiệu lực ngay ở lượt gọi kế tiếp.
const KEY = 'bn-db-pool';

export function createDbPoolCanary({ storage = () => globalThis.localStorage } = {}) {
  const read = () => { try { return storage()?.getItem(KEY) === 'pooler'; } catch { return false; } };
  let on = read();
  return {
    enabled: () => on,
    headers: () => (on ? { 'x-db-pool': 'pooler' } : {}),
    set(next) {
      on = !!next;
      try { if (on) storage()?.setItem(KEY, 'pooler'); else storage()?.removeItem(KEY); } catch { /* bỏ qua */ }
    },
  };
}

const pick = (timing, name) => new RegExp(`(?:^|,)\\s*${name};(?:dur=([\\d.]+)|desc="([^"]*)")`).exec(String(timing || ''));
const durOf = (timing, name) => { const m = pick(timing, name); return m && m[1] !== undefined ? Number(m[1]) : NaN; };
const descOf = (timing, name) => { const m = pick(timing, name); return m?.[2] ?? ''; };
const quantile = (xs, q) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))] : NaN; };

/** Tóm tắt một loạt lượt đo: trung vị / p90 / lớn nhất (trình duyệt và máy chủ), inflight lớn nhất, chế độ máy chủ báo, số lỗi. */
export function summarizeLoad(samples) {
  const ok = samples.filter(s => s.status >= 200 && s.status < 300);
  const server = ok.map(s => durOf(s.timing, 'total')), inflight = ok.map(s => Number(descOf(s.timing, 'inflight')));
  const modes = [...new Set(ok.map(s => descOf(s.timing, 'dbmode') || 'chưa rõ'))];
  return {
    count: samples.length, errors: samples.length - ok.length,
    median: quantile(ok.map(s => s.ms), 0.5), p90: quantile(ok.map(s => s.ms), 0.9), max: ok.length ? Math.max(...ok.map(s => s.ms)) : NaN,
    serverMedian: quantile(server, 0.5), serverP90: quantile(server, 0.9),
    maxInflight: Math.max(0, ...inflight.filter(Number.isFinite)), modes,
  };
}

/**
 * Đo tải đồng thời: mỗi chế độ (trực tiếp / pooler) gửi `rounds` đợt, mỗi đợt `parallel` lượt GET cùng lúc tới một API đọc nhẹ.
 * `probe(path, { pool })` gửi một lượt và trả { ms, status, timing }. Không gửi lệnh ghi; mặc định 3 × 8 = 24 lượt mỗi chế độ.
 */
export async function runLoadTest(probe, { path = '/me', parallel = 8, rounds = 3, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const result = {};
  for (const [mode, pool] of [['direct', false], ['pooler', true]]) {
    const samples = [];
    for (let r = 0; r < rounds; r++) {
      samples.push(...await Promise.all(Array.from({ length: parallel }, () => probe(path, { pool }).catch(() => ({ ms: NaN, status: 0, timing: '' })))));
      await pause(300);
    }
    result[mode] = summarizeLoad(samples);
  }
  return result;
}

const ms = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('vi-VN')} ms` : '–';
/** Một dòng / chế độ để hiện và sao chép. */
export function loadReport(result, { parallel = 8, rounds = 3, path = '/me' } = {}) {
  const line = (label, r) => `${label}: trung vị ${ms(r.median)}, p90 ${ms(r.p90)}, lớn nhất ${ms(r.max)} · máy chủ trung vị ${ms(r.serverMedian)}, p90 ${ms(r.serverP90)} · cùng lúc tối đa ${r.maxInflight} lượt/isolate · máy chủ báo: ${r.modes.join(', ') || '–'} · lỗi ${r.errors}/${r.count}`;
  return [`Đo tải đồng thời – ${new Date().toLocaleString('vi-VN')} · ${rounds} đợt × ${parallel} lượt GET ${path} mỗi chế độ`,
    line('Kết nối trực tiếp', result.direct), line('Pooler (thử)', result.pooler)].join('\n');
}
