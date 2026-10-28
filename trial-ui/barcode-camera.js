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
/** Both native and fallback readers share one stream and an explicit release handle. */
export async function startBarcodeCamera(video, onCode, { mediaDevices = navigator.mediaDevices, Detector = globalThis.BarcodeDetector, reader = loadReader, signal } = {}) {
  if (!mediaDevices?.getUserMedia) throw Error('Trình duyệt chưa hỗ trợ camera. Dùng Safari/Chrome mới hoặc máy quét cầm tay.');
  if (globalThis.isSecureContext === false) throw Error('Camera cần truy cập CRM qua HTTPS.');
  video.autoplay = true; video.playsInline = true; video.muted = true;
  let stopped = false, stream, controls, timer;
  const stop = () => { stopped = true; clearTimeout(timer); controls?.stop(); stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; signal?.removeEventListener('abort', stop); };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) { stop(); return { stop }; }
  const found = code => {
    if (stopped || !String(code || '').trim()) return;
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
    stream = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (stopped || signal?.aborted) { stop(); return { stop }; }
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
      controls = await new lib.BrowserMultiFormatReader().decodeFromStream(stream, video, result => { if (result) found(result.getText()); });
      if (stopped) controls.stop();
    }
    return { stop };
  } catch (e) { stop(); throw e; }
}

// Label printing reuses the same local library; this does not request camera access.
export { loadReader as loadBarcodeLibrary };
