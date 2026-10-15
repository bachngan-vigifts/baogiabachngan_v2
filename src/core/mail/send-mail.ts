import { AppError } from '../errors.ts';

/**
 * Gửi email từ máy chủ qua Resend (https://resend.com) – dùng cho email đơn đặt hàng kèm PDF gửi NCC.
 * Cấu hình bằng secret của Edge Function: RESEND_API_KEY (mã API) + MAIL_FROM (vd "Bách Ngân <don-hang@tenmien.vn>",
 * tên miền phải được xác thực trên Resend). Thiếu cấu hình thì route trả 503 để giao diện quay về cách soạn mail ở máy.
 */
export interface MailerConfig { apiKey: string; from: string; fetch?: typeof fetch; endpoint?: string; timeoutMs?: number }
export interface MailAttachment { filename: string; content: string /* base64 */ }
export interface MailMessage { to: string[]; cc?: string[]; replyTo?: string; subject: string; text: string; attachments?: MailAttachment[] }

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
export const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v);

export const MAIL_NOT_CONFIGURED = 'mail_not_configured';

export function mailerReady(cfg: MailerConfig | undefined): cfg is MailerConfig {
  return !!cfg && cfg.apiKey.length >= 10 && cfg.from.includes('@');
}

/** Gửi một email; trả id của Resend. Lỗi dịch vụ → AppError 502 (không lộ mã API / nội dung phản hồi thô). */
export async function sendMail(cfg: MailerConfig | undefined, msg: MailMessage): Promise<string> {
  if (!mailerReady(cfg)) throw new AppError(503, 'Máy chủ chưa cấu hình gửi email (RESEND_API_KEY / MAIL_FROM).', MAIL_NOT_CONFIGURED);
  const to = msg.to.filter(isEmail), cc = (msg.cc ?? []).filter(isEmail);
  if (!to.length) throw new AppError(400, 'Email người nhận không hợp lệ.');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(cfg.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST', signal: ctl.signal,
      headers: { authorization: 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: cfg.from, to, ...(cc.length ? { cc } : {}), ...(isEmail(msg.replyTo) ? { reply_to: msg.replyTo } : {}),
        subject: msg.subject.slice(0, 250), text: msg.text, ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      }),
    });
  } catch { throw new AppError(502, 'Không kết nối được dịch vụ gửi email. Thử lại sau.'); }
  finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' (kiểm tra RESEND_API_KEY / tên miền gửi đã xác thực chưa)' : res.status === 429 ? ' (gửi quá nhiều, thử lại sau ít phút)' : '';
    throw new AppError(502, 'Dịch vụ email từ chối gửi' + hint + '.');
  }
  return String(data.id ?? '');
}
