const API = 'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Same-origin, server-only bridge for the one-time AI Chat callback contract.
 * It deliberately forwards only the callback bearer and JSON content type.
 */
export async function onRequestPost({ request, params, env }) {
  const id = String(params?.id || '');
  if (!UUID.test(id)) return Response.json({ error: 'Invalid question id.' }, { status: 400 });

  const authorization = request.headers.get('authorization') || '';
  const contentType = request.headers.get('content-type') || '';
  if (!/^Bearer [0-9a-f-]{36}$/i.test(authorization) || !/^application\/json(?:;|$)/i.test(contentType)) {
    return Response.json({ error: 'Invalid callback request.' }, { status: 401 });
  }

  const upstreamFetch = env?.AI_CHAT_UPSTREAM_FETCH || fetch;
  const response = await upstreamFetch(`${API}/integrations/ai-chat/${encodeURIComponent(id)}/result`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: request.body,
    redirect: 'manual',
  });
  return new Response(response.body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8' },
  });
}
