export class ExternalResponseTooLarge extends Error {
  readonly code = 'EXTERNAL_BODY_TOO_LARGE';
  constructor() { super('External response exceeded byte limit'); }
}
async function boundedText(response: Response, maxBytes: number) {
  if (!response.body) return '';
  const reader=response.body.getReader(), decoder=new TextDecoder(), parts:string[]=[]; let bytes=0;
  for (;;) {
    const part=await reader.read(); if(part.done)break;
    bytes+=part.value.byteLength;
    if(bytes>maxBytes){await reader.cancel();throw new ExternalResponseTooLarge();}
    parts.push(decoder.decode(part.value,{stream:true}));
  }
  parts.push(decoder.decode()); return parts.join('');
}
/** Deadline includes response-body consumption. Only explicitly read-only operations may retry. */
export async function externalText(fetcher: typeof fetch, url: string, init: RequestInit,
  options: { timeoutMs: number; maxBytes?: number; retrySafe?: boolean; attempts?: number; sleep?: (ms: number) => Promise<void> }) {
  const attempts = options.retrySafe ? Math.min(3, Math.max(1, options.attempts ?? 2)) : 1;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('External request timed out', 'TimeoutError')), options.timeoutMs);
    let retry = false;
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      retry = attempt + 1 < attempts && [408, 429, 502, 503, 504].includes(response.status);
      if (!retry) return { response, text: await boundedText(response, options.maxBytes ?? 8*1024*1024) };
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof ExternalResponseTooLarge || attempt + 1 >= attempts || init.signal?.aborted) throw error;
      retry = true;
    } finally {
      clearTimeout(timer); init.signal?.removeEventListener('abort', abort);
    }
    if (retry) await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 125));
  }
}
