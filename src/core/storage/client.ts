import { createClient } from '@supabase/supabase-js';

export const FILE_BUCKET = 'baogiabachngan-v2-files';
export const MAX_FILE_BYTES = 6 * 1024 * 1024;
export const FILE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export interface StorageEnv { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string }

/** Chỉ dùng phía server, sau khi route xác thực và kiểm tra quyền với phiếu/ảnh liên quan. */
export function createStorage(env: StorageEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('Thiếu cấu hình Supabase Storage.');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(FILE_BUCKET);
}

/** Bucket private. Caller tự kiểm tra quyền của người dùng trước khi gọi. */
export async function uploadFile(env: StorageEnv, key: string, bytes: Uint8Array, mimeType: string) {
  if (!key || key.startsWith('/') || key.split('/').includes('..')) throw new Error('Đường dẫn file không hợp lệ.');
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) throw new Error('File phải từ 1 byte đến 6 MB.');
  if (!FILE_MIME_TYPES.some(m => m === mimeType)) throw new Error('Chỉ nhận ảnh JPEG, PNG, WebP hoặc PDF.');
  const { data, error } = await createStorage(env).upload(key, bytes, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return data.path;
}

/** URL hết hạn sau 5 phút; chỉ cấp sau khi kiểm tra quyền đọc tài liệu. */
export async function signedFileUrl(env: StorageEnv, key: string) {
  const { data, error } = await createStorage(env).createSignedUrl(key, 300);
  if (error) throw error;
  return data.signedUrl;
}
