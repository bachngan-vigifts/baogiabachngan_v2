import { sha256 } from '@noble/hashes/sha2.js';
import { AppError, unauthorized } from '../../../core/errors.ts';

/** Phiên đăng nhập. Hằng số và định dạng cookie giữ NGUYÊN như bản cũ để phiên đang có vẫn dùng được. */
export const SESSION_COOKIE = '__Host-bn-session';
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/**
 * Phiên "trượt": còn dùng thì không bao giờ bị đá ra. Mỗi khi phiên đã trôi qua quá 1 ngày kể từ lần gia hạn trước,
 * hạn được đẩy lại thành bây giờ + 30 ngày (tối đa một lần ghi mỗi ngày cho mỗi phiên). Bỏ app quá 30 ngày mới phải đăng nhập lại.
 */
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
export const shouldRenewSession = (expires: number, now: number) => expires - now < SESSION_LIFETIME_SECONDS - SESSION_RENEW_AFTER_SECONDS;
/** Cửa sổ đếm số lần thử (đăng nhập, kích hoạt, đổi mật khẩu). */
export const RATE_WINDOW_SECONDS = 900;
export const RATE_LIMITS = { ip: 100, email: 10, activation: 10, password: 10 } as const;

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
/** SHA-256 dạng hex của chuỗi UTF-8 – cách bản cũ băm token phiên, token kích hoạt và khoá giới hạn thử. */
export const sha256Hex = (value: string): string => toHex(sha256(enc.encode(value)));
/** Token ngẫu nhiên 256 bit dạng hex (64 ký tự). Chỉ băm của nó được lưu trong DB. */
export const newToken = (): string => toHex(crypto.getRandomValues(new Uint8Array(32)));
export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Lấy token phiên từ header Cookie; không có hoặc sai định dạng thì 401. */
export function readSessionToken(cookieHeader: string | null | undefined): string {
  const raw = (cookieHeader || '').split(';').map(s => s.trim()).find(s => s.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (!isToken(raw)) throw unauthorized('Vui lòng đăng nhập bằng email công ty.');
  return raw;
}

export const sessionCookie = (value: string, maxAgeSeconds = SESSION_LIFETIME_SECONDS): string =>
  `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
export const clearedSessionCookie = (): string => sessionCookie('', 0);

export interface MemberRow { id: string; name: string; phone: string | null; email: string; role: 'employee' | 'manager' | 'supplier' | 'customer'; positionId: string | null; positionName: string | null; avatarKey?: string | null }
/** Hồ sơ trả cho trình duyệt (không có gì nhạy cảm). Cùng hình dạng bản cũ. */
export const publicMember = (m: MemberRow) => ({ id: m.id, name: m.name, phone: m.phone || '', email: m.email, role: m.role, positionId: m.positionId, position: m.positionName, avatar: m.avatarKey ?? null });

export const tooManyAttempts = () => new AppError(429, 'Đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.');
