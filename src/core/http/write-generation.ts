/**
 * Bộ đếm lệnh ghi trong phiên chạy (isolate) này: mỗi yêu cầu không phải GET/HEAD/OPTIONS tăng một nấc.
 * Cache đọc ngắn (vd. huy hiệu menu) gắn số nấc vào khoá để bỏ kết quả cũ ngay khi có thao tác ghi; phiên chạy khác
 * không thấy nấc này nên cache vẫn phải có thời hạn ngắn.
 */
let generation = 0;
export const writeGeneration = () => generation;
export function noteRequestMethod(method: string) { if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) generation++; }
