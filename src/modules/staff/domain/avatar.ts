import { AppError } from '../../../core/errors.ts';

/** Ảnh đại diện: trình duyệt thu nhỏ còn ~160×160 JPEG/WebP rồi gửi lên dạng data URL; máy chủ chỉ kiểm tra. */
export const AVATAR_MAX_CHARS = 120_000; // ~90 KB ảnh – dư cho ảnh 160 px
const MAGIC: Record<string, string> = { jpeg: '/9j/', png: 'iVBORw0KGgo', webp: 'UklGR' };
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
export const AVATAR_KEY = /^[a-f0-9]{32}$/;

export function cleanAvatar(v: unknown): string {
  if (typeof v !== 'string' || v.length > AVATAR_MAX_CHARS) throw new AppError(400, 'Ảnh đại diện quá lớn hoặc không hợp lệ.');
  const m = DATA_URL.exec(v);
  // Kiểm tra cả "chữ ký" đầu file để chắc là ảnh thật đúng định dạng đã khai.
  if (!m || !m[2]!.startsWith(MAGIC[m[1]!]!)) throw new AppError(400, 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.');
  return v;
}

export const newAvatarKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
