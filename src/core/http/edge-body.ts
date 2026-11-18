/** Pass encoded bytes through: never decode/encode a multi-MB catalogue twice. */
export async function edgeBody(response: Response, acceptEncoding: string) {
  const cookie = response.headers.get('set-cookie');
  let body = response.body;
  if (cookie) {
    const payload = await response.json();
    payload.sessionToken = /__Host-bn-session=([a-f0-9]{64})/.exec(cookie)?.[1] || '';
    body = new Response(JSON.stringify(payload)).body;
  }
  if (!body || !/\bgzip\b/.test(acceptEncoding)) return { body, gzip: false };
  // Peek bytes without concatenating them. Small responses retain the previous no-gzip behavior.
  const reader = body.getReader(), prefix: Uint8Array[] = []; let size = 0, ended = false;
  while (size <= 4000) {
    const part = await reader.read(); if (part.done) { ended = true; break; }
    prefix.push(part.value); size += part.value.byteLength;
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefix.length) { controller.enqueue(prefix.shift()!); return; }
      if (ended) { controller.close(); return; }
      const part = await reader.read(); if (part.done) controller.close(); else controller.enqueue(part.value);
    }, cancel(reason) { return reader.cancel(reason); },
  });
  return { body: size > 4000 ? new Response(stream).body!.pipeThrough(new CompressionStream('gzip')) : stream, gzip: size > 4000 };
}
