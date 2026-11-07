import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_FILE_MIMES, fileMatchesMime } from '../../src/core/storage/file-sniff.ts';
import { memoryFileStore } from '../../src/core/storage/file-store.ts';

const b = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap(p => typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p));
const ZIP = [0x50, 0x4b, 0x03, 0x04], OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
test('nội dung phải đúng loại khai báo: ảnh, PDF, Word / Excel mới và cũ, CSV / TXT; ZIP và loại lạ bị từ chối', () => {
  const good: [string, Uint8Array][] = [
    ['image/jpeg', b([0xff, 0xd8, 0xff, 0xe0], 'x')], ['image/png', b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'x')],
    ['image/webp', b('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')], ['image/gif', b('GIF89a', 'x')], ['application/pdf', b('%PDF-1.7\n')],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b(ZIP, '..[Content_Types].xml..xl/workbook.xml')],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', b(ZIP, '..[Content_Types].xml..word/document.xml')],
    ['application/vnd.ms-excel', b(OLE, 'x')], ['application/msword', b(OLE, 'x')],
    ['text/csv', new TextEncoder().encode('Mã,Tên\nA1,Ly sứ\n')], ['text/plain; charset=utf-8', new TextEncoder().encode('ghi chú')],
  ];
  for (const [mime, bytes] of good) assert.equal(fileMatchesMime(bytes, mime), true, mime);
  const exe = b('MZ', [0x90, 0, 3, 0]);
  for (const mime of ALLOWED_FILE_MIMES) assert.equal(fileMatchesMime(exe, mime), false, 'file .exe đổi đuôi thành ' + mime);
  assert.equal(fileMatchesMime(b(ZIP, 'evil.exe'), 'application/zip'), false, 'ZIP không còn được nhận');
  assert.equal(fileMatchesMime(b(ZIP, 'evil.exe'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), false, 'ZIP thường giả làm Excel');
  assert.equal(fileMatchesMime(b('<svg onload=alert(1)>'), 'image/svg+xml'), false);
  assert.equal(fileMatchesMime(b([0xff, 0xd8, 0xff]), 'image/png'), false, 'JPEG khai là PNG');
  assert.equal(fileMatchesMime(b('abc', [0], 'def'), 'text/plain'), false, 'file nhị phân khai là văn bản');
  assert.equal(fileMatchesMime(new Uint8Array(), 'image/jpeg'), false);
});
test('lớp lưu trữ từ chối file sai loại trước khi ghi (mọi đường tải lên đều đi qua)', async () => {
  const store = memoryFileStore();
  await assert.rejects(store.put('a/x.pdf', b('MZ', [0x90]), 'application/pdf'), (e: any) => e.status === 400 && e.code === 'FILE_TYPE_MISMATCH');
  assert.equal(store.files.size, 0);
  await store.put('a/y.pdf', b('%PDF-1.4'), 'application/pdf'); assert.equal(store.files.size, 1);
});
