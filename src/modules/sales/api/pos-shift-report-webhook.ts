import type { StaffEnv } from '../../staff/api/auth-routes.ts';

type ClosedShiftReport = Record<string, any> & {
  shift?: { id?: string; registerId?: string; memberId?: string; openedAt?: string; closedAt?: string };
  register?: { id?: string; name?: string };
  memberName?: string;
};

export function posShiftReportPayload(report: ClosedShiftReport) {
  const shiftId = String(report.shift?.id || '');
  return {
    event: 'crm_pos_shift_closed',
    idempotency_key: `pos-shift:${shiftId}`,
    shift_id: shiftId,
    register: { id: report.register?.id || report.shift?.registerId || '', name: report.register?.name || '' },
    employee: { id: report.shift?.memberId || '', name: report.memberName || '' },
    report,
  };
}

export async function sendPosShiftReport(env: StaffEnv, report: ClosedShiftReport) {
  const config = env.posShiftReportWebhook;
  if (!config?.url || !config.token) return { status: 'disabled' as const };
  const response = await (config.fetch || fetch)(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify(posShiftReportPayload(report)),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POS shift report webhook ${response.status}: ${text.slice(0, 300)}`);
  return { status: 'queued' as const };
}
