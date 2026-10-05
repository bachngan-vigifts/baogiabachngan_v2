import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AppError } from '../errors.ts';

/*
 * Định dạng lưu: `pbkdf2-sha256$<vòng lặp>$<salt hex>$<hash hex>` – GIỐNG HỆT bản cũ để mật khẩu
 * đang có trong DB đăng nhập được ngay. Dùng @noble/hashes (không dùng WebCrypto) vì Cloudflare Workers
 * giới hạn PBKDF2 của WebCrypto ở 100.000 vòng, trong khi hash cũ dùng 600.000.
 * Lưu ý tương thích: salt được băm theo UTF-8 của CHUỖI hex, không phải theo byte đã giải mã.
 */
const ITERATIONS = 600_000;
const enc = new TextEncoder();
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));
const derive = (password: string, salt: string, iterations: number) =>
  pbkdf2Async(sha256, enc.encode(password), enc.encode(salt), { c: iterations, dkLen: 32 });

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPassword(password: unknown, iterations = ITERATIONS): Promise<string> {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw new AppError(400, 'Mật khẩu cần từ 8 đến 128 ký tự. Có thể dùng một cụm từ dễ nhớ.');
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256$${iterations}$${salt}$${toHex(await derive(password, salt, iterations))}`;
}

/**
 * Luôn tốn thời gian tính toán như nhau kể cả khi chưa có hash (chống dò tài khoản qua thời gian):
 * khi thiếu hash thì băm một hash giả có CÙNG số vòng với hash thật (`dummyIterations`, mặc định 600.000; test hạ xuống).
 */
export async function verifyPassword(password: unknown, stored: string | null | undefined, dummyIterations = ITERATIONS): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 128) return false;
  const dummy = `pbkdf2-sha256$${dummyIterations}$${'0'.repeat(32)}$${'00'.repeat(32)}`;
  const [scheme, iter, salt, hash] = (stored || dummy).split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash || !Number.isInteger(iterations) || iterations < 1 || iterations > 5_000_000) return false;
  const actual = await derive(password, salt, iterations);
  return constantTimeEqual(actual, fromHex(hash)) && Boolean(stored);
}
