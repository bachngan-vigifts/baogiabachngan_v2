let libraryPromise;
function loadReader() {
  if (globalThis.ZXingBrowser) return Promise.resolve(globalThis.ZXingBrowser);
  return libraryPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/zxing-browser/zxing-browser-0.1.5.min.js', import.meta.url).href;
    script.onload = () => globalThis.ZXingBrowser ? resolve(globalThis.ZXingBrowser) : reject(Error('Không khởi tạo được bộ quét mã.'));
    script.onerror = () => { libraryPromise = null; script.remove(); reject(Error('Không tải được bộ quét. Kiểm tra mạng rồi thử lại.')); };
    document.head.append(script);
  });
}
// Luồng camera "để ấm": đóng hộp quét rồi mở lại trong `keepWarmMs` thì dùng lại luồng cũ, không gọi getUserMedia lần nữa
// (Safari / app trên màn hình chính có thể hỏi quyền lại mỗi lần gọi khi quyền camera đang là "Hỏi").
let warm = null;
const live = s => !!s && s.getTracks().every(t => t.readyState !== 'ended');
function stopStream(s) { s?.getTracks().forEach(t => t.stop()); }
async function acquire(mediaDevices) {
  if (warm && live(warm.stream)) { clearTimeout(warm.timer); const s = warm.stream; warm = null; return s; }
  if (warm) { clearTimeout(warm.timer); stopStream(warm.stream); warm = null; }
  return mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
}
function release(stream, keepWarmMs) {
  if (!stream) return;
  if (keepWarmMs > 0 && live(stream)) { if (warm) { clearTimeout(warm.timer); if (warm.stream !== stream) stopStream(warm.stream); } warm = { stream, timer: setTimeout(() => { stopStream(stream); warm = null; }, keepWarmMs) }; }
  else stopStream(stream);
}
/** Tắt hẳn luồng đang để ấm (vd. đăng xuất / rời trang). */
export function releaseWarmCamera() { if (warm) { clearTimeout(warm.timer); stopStream(warm.stream); warm = null; } }
// Ẩn app / chuyển tab: tắt ngay luồng đang để ấm (đèn camera không sáng khi người dùng không ở trên trang).
globalThis.document?.addEventListener?.('visibilitychange', () => { if (globalThis.document.visibilityState === 'hidden') releaseWarmCamera(); });

/**
 * Both native and fallback readers share one stream and an explicit release handle.
 * `continuous`: không dừng sau mỗi mã – gọi `onCode` cho từng mã, nghỉ `pauseMs` giữa hai lần đọc (một lần đưa mã = một lần đếm);
 *   cả phiên quét chỉ xin quyền camera một lần.
 * `keepWarmMs`: giữ luồng sau khi dừng để lần mở kế tiếp không phải xin quyền lại.
 */
export async function startBarcodeCamera(video, onCode, { mediaDevices = navigator.mediaDevices, Detector = globalThis.BarcodeDetector, reader = loadReader, signal, continuous = false, pauseMs = 1200, keepWarmMs = 0, now = () => Date.now() } = {}) {
  if (!mediaDevices?.getUserMedia) throw Error('Trình duyệt chưa hỗ trợ camera. Dùng Safari/Chrome mới hoặc máy quét cầm tay.');
  if (globalThis.isSecureContext === false) throw Error('Camera cần truy cập CRM qua HTTPS.');
  video.autoplay = true; video.playsInline = true; video.muted = true;
  let stopped = false, stream, feed, controls, timer, pausedUntil = 0;
  const stop = () => { if (stopped) return; stopped = true; clearTimeout(timer); controls?.stop(); if (feed && feed !== stream) stopStream(feed); release(stream, keepWarmMs); video.srcObject = null; signal?.removeEventListener('abort', stop); };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) { stop(); return { stop }; }
  const found = code => {
    if (stopped || !String(code || '').trim()) return;
    if (continuous) { if (now() < pausedUntil) return; pausedUntil = now() + pauseMs; onCode(String(code).trim()); return; }
    stop();
    onCode(String(code).trim());
  };
  let detector;
  if (Detector) {
    try {
      const desired = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
      const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : desired;
      const formats = desired.filter(f => supported.includes(f));
      if (formats.length) detector = new Detector({ formats });
    } catch { /* ZXing handles browsers exposing an incomplete native detector. */ }
  }
  try {
    if (stopped || signal?.aborted) return { stop };
    stream = await acquire(mediaDevices);
    if (stopped || signal?.aborted) { const s = stream; stream = null; release(s, keepWarmMs); return { stop }; }
    if (detector) {
      video.srcObject = stream; await video.play();
      const tick = async () => {
        if (stopped) return;
        try { const codes = await detector.detect(video); if (!stopped && codes.length) found(codes[0].rawValue); } catch { /* A frame may not be ready yet. */ }
        if (!stopped) timer = setTimeout(tick, 180);
      };
      timer = setTimeout(tick, 0);
    } else {
      const lib = await reader();
      if (stopped) return { stop };
      // ZXing tự tắt luồng khi dừng: đưa cho nó bản sao (không cần xin quyền) để luồng gốc còn dùng lại được khi để ấm.
      feed = keepWarmMs > 0 && typeof stream.clone === 'function' ? stream.clone() : stream;
      controls = await new lib.BrowserMultiFormatReader().decodeFromStream(feed, video, result => { if (result) found(result.getText()); });
      if (stopped) controls.stop();
    }
    return { stop };
  } catch (e) { stop(); throw e; }
}

// Label printing reuses the same local library; this does not request camera access.
export { loadReader as loadBarcodeLibrary };
