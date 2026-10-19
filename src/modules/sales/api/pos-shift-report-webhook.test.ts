import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posShiftReportPayload, sendPosShiftReport } from './pos-shift-report-webhook.ts';

const report = { shift: { id: 'shift-1', registerId: 'reg-1', memberId: 'emp-1' }, register: { id: 'reg-1', name: 'Két Minh Long' }, memberName: 'Thái Thị Yến', bills: { count: 3, revenue: 1200000 } };

test('POS shift webhook giữ nguyên snapshot và khóa chống gửi trùng theo shift', async () => {
  const payload = posShiftReportPayload(report);
  assert.equal(payload.idempotency_key, 'pos-shift:shift-1');
  assert.equal(payload.register.name, 'Két Minh Long');
  assert.equal(payload.employee.name, 'Thái Thị Yến');
  assert.equal(payload.report, report);
  let request: RequestInit | undefined;
  const result = await sendPosShiftReport({ posShiftReportWebhook: { url: 'https://example.test/hook', token: 'secret', fetch: async (_url: string | URL | Request, init?: RequestInit) => { request = init; return new Response('{"ok":true}'); } } } as any, report);
  assert.equal(result.status, 'queued');
  assert.equal(new Headers(request?.headers).get('authorization'), 'Bearer secret');
  assert.equal(JSON.parse(String(request?.body)).shift_id, 'shift-1');
});
