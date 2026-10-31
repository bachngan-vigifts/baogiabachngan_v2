import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module; injected camera/decoder below
import { startBarcodeCamera, releaseWarmCamera } from '../../trial-ui/barcode-camera.js';
// @ts-ignore browser file parser
import { parseBarcodeSheet } from '../../trial-ui/barcode-file.js';

test('File barcode: giữ số 0, đọc tên cột tiếng Việt, số dòng gốc; chặn thiếu/nhầm cột và số khoa học', () => {
  assert.deepEqual(parseBarcodeSheet([['Báo cáo'], ['Mã hàng', 'Mã vạch'], ['00123', '0001234567890'], ['', ''], [' A-1 ', ' ABC-01 ']]), [{ sku: '00123', barcode: '0001234567890', rowNumber: 3 }, { sku: 'A-1', barcode: 'ABC-01', rowNumber: 5 }]);
  for (const rows of [[['SKU', 'Tên']], [['SKU', 'Barcode'], ['1', '']], [['SKU', 'Barcode'], ['1', '1.234E+12']], [['SKU', 'Mã hàng', 'Barcode'], ['a', 'b', 'c']]]) assert.throws(() => parseBarcodeSheet(rows));
});
const video = () => ({ srcObject: null as any, async play() {}, muted: false, playsInline: false });
test('Camera native: dùng camera sau, đọc đúng một lần, nhả camera khi quét xong', async () => {
  let stopped = 0, constraint: any;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] }, codes: string[] = [];
  class Detector { async detect() { return [{ rawValue: '0001234567890' }]; } }
  const handle = await startBarcodeCamera(video(), (code: string) => codes.push(code), { Detector, mediaDevices: { async getUserMedia(c: any) { constraint = c; return stream; } } });
  await new Promise(r => setTimeout(r, 15));
  assert.deepEqual(codes, ['0001234567890']); assert.equal(constraint.video.facingMode.ideal, 'environment'); assert.ok(stopped > 0);
  handle.stop();
});
test('Camera fallback cho iPhone: nhả stream khi đóng lúc chờ tải bộ quét, không mở lại sau đóng', async () => {
  let stopped = 0, load: (() => void) | undefined, decodeCalled = false;
  const controller = new AbortController(), v = video();
  const pending = startBarcodeCamera(v, () => assert.fail('Không được trả mã sau đóng'), { Detector: null, signal: controller.signal, mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() { stopped++; } }] }; } }, reader: () => new Promise(resolve => { load = () => resolve({ BrowserMultiFormatReader: class { async decodeFromStream() { decodeCalled = true; } } }); }) });
  await new Promise(r => setTimeout(r, 0)); controller.abort(); assert.ok(stopped > 0);
  load!(); const handle = await pending; handle.stop(); assert.equal(decodeCalled, false); assert.equal(v.srcObject, null);
});
test('Camera fallback trả barcode và dừng, lỗi từ chối camera được trả về UI', async () => {
  const codes: string[] = []; let release = 0;
  const handle = await startBarcodeCamera(video(), (code: string) => codes.push(code), { Detector: null, mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() { release++; } }] }; } }, reader: async () => ({ BrowserMultiFormatReader: class { async decodeFromStream(_s: unknown, _v: unknown, cb: Function) { cb({ getText: () => '001234' }); cb({ getText: () => 'ignored' }); return { stop() { release++; } }; } } }) });
  assert.deepEqual(codes, ['001234']); assert.ok(release >= 2); handle.stop();
  await assert.rejects(startBarcodeCamera(video(), () => {}, { Detector: null, mediaDevices: { async getUserMedia() { throw Object.assign(Error('denied'), { name: 'NotAllowedError' }); } } }), { name: 'NotAllowedError' });
});
test('Đóng camera khi đang kiểm tra native formats không tạo yêu cầu camera muộn', async () => {
  let resolve: (formats: string[]) => void = () => {}, requested = false;
  const controller = new AbortController();
  class Detector { static getSupportedFormats() { return new Promise<string[]>(r => { resolve = r; }); } }
  const p = startBarcodeCamera(video(), () => {}, { Detector, signal: controller.signal, mediaDevices: { async getUserMedia() { requested = true; return { getTracks: () => [] }; } } });
  controller.abort(); resolve(['ean_13']); await p; assert.equal(requested, false);
});

test('quét liên tục: một luồng camera cho cả phiên, nghỉ giữa hai lần đọc; để ấm thì lần mở sau không xin quyền lại', async () => {
  let requests = 0, stopped = 0, t = 0, emit: Function = () => {};
  const media = { async getUserMedia() { requests++; return { getTracks: () => [{ readyState: 'live', stop() { stopped++; } }] }; } };
  const reader = async () => ({ BrowserMultiFormatReader: class { async decodeFromStream(_s: unknown, _v: unknown, cb: Function) { emit = cb; return { stop() {} }; } } });
  const codes: string[] = [];
  const handle = await startBarcodeCamera(video(), (c: string) => codes.push(c), { Detector: null, mediaDevices: media, reader, continuous: true, pauseMs: 1000, keepWarmMs: 30000, now: () => t });
  emit({ getText: () => 'A' }); emit({ getText: () => 'A' }); t = 500; emit({ getText: () => 'B' }); t = 1200; emit({ getText: () => 'A' });
  assert.deepEqual(codes, ['A', 'A'], 'mỗi lần đưa mã chỉ đếm một lần; sau thời gian nghỉ đếm tiếp, camera không tắt');
  handle.stop(); assert.equal(stopped, 0, 'để ấm: chưa tắt luồng');
  const again = await startBarcodeCamera(video(), () => {}, { Detector: null, mediaDevices: media, reader, keepWarmMs: 30000 });
  assert.equal(requests, 1, 'mở lại dùng luồng cũ, không xin quyền lần hai');
  again.stop(); releaseWarmCamera(); assert.equal(stopped, 1, 'tắt hẳn khi giải phóng');
});
