import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { employees } from '../../staff/schema.ts';
import { aiChatHelpfulVotes as votes, aiChatQuestions as questions } from '../schema.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
const member = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const clean = (value: unknown, max: number) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const sensitive = (value: string) => /(?:mật\s*khẩu|password|access[_ -]?token|api[_ -]?key|secret|lương|thưởng|sức khỏe|kỷ luật|mâu thuẫn cá nhân|\b0\d{9}\b|\b\d{9,12}\b)/iu.test(value);

function integration(env: StaffEnv) {
  const cfg = env.aiChatIntegration;
  if (!cfg || cfg.webhookToken.length < 32) throw new AppError(503, 'Chat cùng AI chưa được kết nối n8n.');
  try { const u = new URL(cfg.webhookUrl); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); } catch { throw new AppError(503, 'Webhook Chat cùng AI không hợp lệ.'); }
  return cfg;
}
function callbackOrigin(env: StaffEnv) {
  const u = new URL(env.aiChatIntegration?.callbackOrigin || 'https://crm.minhlongonline.com');
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) throw new AppError(503, 'Địa chỉ callback CRM không hợp lệ.');
  return u.origin;
}

async function sendToAi(env: StaffEnv, row: typeof questions.$inferSelect, author: { id: string; name: string; positionId: string | null }, token: string) {
  const cfg = integration(env);
  try {
    const response = await (cfg.fetch ?? fetch)(cfg.webhookUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.webhookToken}` }, body: JSON.stringify({
      schema_version: 1, action: 'answer_public_crm_question', question: { id: row.id, text: row.question, topic: row.topic, author: { id: author.id, name: author.name, positionId: author.positionId } },
      visibility: 'all_employees', rules: ['Không tiết lộ bí mật hoặc dữ liệu ngoài quyền.', 'Trả lời bằng tiếng Việt, rõ ràng, thực tế.', 'Nếu chưa chắc, yêu cầu quản lý xác nhận.'],
      callback: { url: `${callbackOrigin(env)}/api/staff/integrations/ai-chat/${encodeURIComponent(row.id)}/result`, token },
    }) });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`N8N_HTTP_${response.status}`);
  } catch {
    await env.db.update(questions).set({ status: 'needs_review', error: 'Chưa xác định AI đã nhận câu hỏi. Có thể gửi lại sau khi kiểm tra n8n.', updatedAt: nowIso() }).where(and(eq(questions.id, row.id), eq(questions.status, 'pending')));
  }
}

export function registerAiChatRoutes(router: Router<StaffEnv>) {
  router.get('/ai-chat/questions', async c => {
    const m = member(c), q = clean(c.url.searchParams.get('q'), 100), topic = clean(c.url.searchParams.get('topic'), 60), page = Math.max(1, Number(c.url.searchParams.get('page')) || 1), limit = 20;
    const where = and(topic ? eq(questions.topic, topic) : undefined, q ? or(ilike(questions.question, `%${q.replace(/[%_\\]/g, '\\$&')}%`), ilike(questions.answer, `%${q.replace(/[%_\\]/g, '\\$&')}%`)) : undefined);
    const helpful = sql<number>`(select count(*) from ${votes} v where v.question_id = ${questions.id})`.mapWith(Number);
    const mine = sql<boolean>`exists(select 1 from ${votes} v where v.question_id = ${questions.id} and v.member_id = ${m.id})`;
    const [items, [total]] = await Promise.all([
      c.env.db.select({ id: questions.id, question: questions.question, answer: questions.answer, topic: questions.topic, status: questions.status, error: questions.error, createdAt: questions.createdAt, answeredAt: questions.answeredAt, authorName: employees.name, helpful, helpfulByMe: mine }).from(questions).leftJoin(employees, eq(employees.id, questions.createdBy)).where(where).orderBy(desc(questions.createdAt)).limit(limit).offset((page - 1) * limit),
      c.env.db.select({ n: count() }).from(questions).where(where),
    ]);
    return json({ items, total: total?.n ?? 0, page, pageSize: limit });
  }, 'business');

  router.post('/ai-chat/questions', async c => {
    const m = member(c), b = await readJson(c.req, 20_000), question = clean(b.question, 3000), topic = clean(b.topic, 60) || 'CRM';
    if (question.length < 5) throw new AppError(400, 'Nhập câu hỏi rõ hơn để AI hỗ trợ.');
    if (sensitive(question)) throw new AppError(422, 'Câu hỏi có thể chứa thông tin cá nhân hoặc nhạy cảm nên chưa thể đăng công khai. Hãy bỏ dữ liệu nhận diện hoặc trao đổi riêng với quản lý.');
    const cfg = integration(c.env), id = crypto.randomUUID(), token = crypto.randomUUID(), at = nowIso();
    const [row] = await c.env.db.insert(questions).values({ id, question, topic, createdBy: m.id, callbackTokenHash: sha256Hex(token), createdAt: at, updatedAt: at }).returning();
    const work = sendToAi(c.env, row!, { id: m.id, name: m.name, positionId: m.positionId }, token);
    if (c.env.waitUntil) c.env.waitUntil(work); else await work;
    return json({ id, status: 'pending', configured: !!cfg }, 202);
  }, 'business');

  router.post('/ai-chat/questions/:id/helpful', async c => {
    const m = member(c), b = await readJson(c.req, 1000), id = c.params.id || '';
    const [row] = await c.env.db.select({ id: questions.id }).from(questions).where(eq(questions.id, id)); if (!row) throw new AppError(404, 'Không tìm thấy câu hỏi.');
    if (b.on === false) await c.env.db.delete(votes).where(and(eq(votes.questionId, id), eq(votes.memberId, m.id)));
    else await c.env.db.insert(votes).values({ questionId: id, memberId: m.id, createdAt: nowIso() }).onConflictDoNothing();
    return json({ ok: true, on: b.on !== false });
  }, 'business');

  router.post('/integrations/ai-chat/:id/result', async c => {
    const token = /^Bearer (.+)$/.exec(c.req.headers.get('authorization') || '')?.[1] || '', b = await readJson(c.req, 40_000), id = c.params.id || '', got = sha256Hex(token), at = nowIso();
    const [row] = await c.env.db.select().from(questions).where(eq(questions.id, id));
    if (!row) throw new AppError(404, 'Không tìm thấy câu hỏi.');
    if (!row.callbackTokenHash || row.callbackTokenHash !== got) throw new AppError(401, 'Callback không hợp lệ hoặc đã sử dụng.');
    if (!['pending', 'needs_review'].includes(row.status)) throw new AppError(409, 'Câu hỏi không còn chờ trả lời.');
    const status = clean(b.status, 30), answer = clean(b.answer, 12_000), error = clean(b.error, 1000);
    if (status === 'answered' && answer.length < 2) throw new AppError(422, 'Kết quả phải có câu trả lời.');
    if (!['answered', 'needs_review', 'failed'].includes(status)) throw new AppError(422, 'Trạng thái callback không hợp lệ.');
    await c.env.db.update(questions).set({ status, answer: status === 'answered' ? answer : '', error: status === 'answered' ? '' : error || 'AI chưa thể trả lời; cần quản lý hỗ trợ.', callbackTokenHash: null, answeredAt: status === 'answered' ? at : null, updatedAt: at }).where(eq(questions.id, id));
    return json({ ok: true });
  }, 'ai-chat-sync');
}
