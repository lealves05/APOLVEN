// Agente do WhatsApp (área logada): conexão, rotinas, lembretes da equipe, conversas, simulador e histórico.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need, can, scopeOf, reauth } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, conflict, idParam, randomToken, onlyDigits, notFound } from '../util.js';
import { CLIENT_ROUTINES, TEAM_ITEMS, TEAM_TEMPLATE, agentSettings, suggestedTemplates } from '../agent/config.js';
import { sealSecrets, readSecrets, testConnection, credentials, toWaId } from '../agent/whatsapp.js';
import { loadAgent, canSend, deliver, processInbound, windowOpen, saveConversation, getConversation } from '../agent/service.js';
import { previewRoutine, runRoutine, runTeam } from '../agent/routines.js';

const r = Router();
const mask = (v) => (v ? `••••${String(v).slice(-4)}` : null);

function publicView(agent, req) {
  const { row, cfg } = agent;
  const s = readSecrets(row);
  const manage = can(req, 'agent_manage');
  return {
    enabled: row.enabled, name: row.name, connection_status: row.connection_status, connection_checked_at: row.connection_checked_at,
    webhook_verified_at: row.webhook_verified_at, last_webhook_at: row.last_webhook_at, last_error: row.last_error,
    phone_number_id: row.phone_number_id, waba_id: row.waba_id, display_phone: row.display_phone, verified_name: row.verified_name, quality_rating: row.quality_rating,
    has_access_token: !!s.access_token, access_token_hint: mask(s.access_token), has_app_secret: !!s.app_secret,
    verify_token: manage ? row.verify_token : null, webhook_path: '/api/whatsapp/webhook', ready: credentials(row).ready, can_send: canSend(agent),
    version: row.version, settings: cfg, is_demo: !!agent.company.is_demo,
    routines: Object.entries(CLIENT_ROUTINES).map(([key, d]) => ({ key, label: d.label, help: d.help, category: d.category, consent: d.consent, params: d.params, text: d.text })),
    team_items: Object.entries(TEAM_ITEMS).map(([key, d]) => ({ key, label: d.label })),
    team_template: TEAM_TEMPLATE, templates: suggestedTemplates(),
  };
}

r.get('/', need('agent_manage', 'agent_inbox'), async (req, res) => {
  const agent = await loadAgent(req.companyId);
  const [{ rows: [stats] }, { rows: users }] = await Promise.all([
    q(`select (select count(distinct client_id)::int from consents where company_id = $1 and purpose = 'whatsapp' and granted and revoked_at is null) as consented,
              (select count(*)::int from wa_conversations where company_id = $1 and not simulated and status = 'humano') as waiting,
              (select count(*)::int from wa_messages where company_id = $1 and direction = 'out' and status <> 'simulada' and created_at > now() - interval '30 days') as sent_30d,
              (select count(*)::int from wa_conversations where company_id = $1 and not simulated and opted_out_at is not null) as opted_out`, [req.companyId]),
    q(`select id, name, role, phone, wa_reminders from users where company_id = $1 and active order by name`, [req.companyId]),
  ]);
  res.json({ ...publicView(agent, req), stats, users: can(req, 'agent_manage') ? users.map((u) => ({ ...u, phone: u.phone ? `•••• ${onlyDigits(u.phone).slice(-4)}` : null })) : [] });
});

// ---------------- conexão ----------------
r.put('/connection', need('agent_manage'), async (req, res) => {
  const d = parse(z.object({
    phone_number_id: z.string().trim().regex(/^\d{6,30}$/, 'ID do número: só dígitos (Gerenciador do WhatsApp › Configuração da API)'),
    waba_id: z.string().trim().regex(/^\d{6,30}$/).nullable().optional().or(z.literal('')),
    access_token: z.string().trim().min(20).max(1000).optional().or(z.literal('')),
    app_secret: z.string().trim().min(16).max(200).optional().or(z.literal('')),
    mfa_code: z.string().optional(), password: z.string().optional(),
  }), req.body);
  const agent = await loadAgent(req.companyId);
  const secrets = readSecrets(agent.row);
  const changingSecret = !!(d.access_token || d.app_secret);
  if (changingSecret) await reauth(req, { code: d.mfa_code, password: d.password });
  const dup = await one('select company_id from wa_agents where phone_number_id = $1 and company_id <> $2', [d.phone_number_id, req.companyId]);
  if (dup) throw conflict('Este número do WhatsApp já está conectado a outra corretora.');
  const next = { access_token: d.access_token || secrets.access_token || null, app_secret: d.app_secret || secrets.app_secret || null };
  const numberChanged = d.phone_number_id !== agent.row.phone_number_id;
  await q(`update wa_agents set phone_number_id = $2, waba_id = $3, secrets = $4, connection_status = case when $5 then 'configurado' else connection_status end,
      display_phone = case when $6 then null else display_phone end, verified_name = case when $6 then null else verified_name end,
      enabled = case when $6 then false else enabled end, last_error = null, version = version + 1, updated_by = $7, updated_at = now() where company_id = $1`,
  [req.companyId, d.phone_number_id, d.waba_id || null, sealSecrets(req.companyId, next), changingSecret || numberChanged, numberChanged, req.user.id]);
  await audit(null, req, { entity: 'wa_agent', entityId: req.companyId, action: 'agent.connection', summary: `WhatsApp: conexão atualizada${changingSecret ? ' (credenciais trocadas)' : ''}`,
    data: { phone_number_id: d.phone_number_id, token: changingSecret ? 'alterado' : 'mantido' } });
  res.json(publicView(await loadAgent(req.companyId), req));
});

r.post('/connection/test', need('agent_manage'), async (req, res) => {
  const agent = await loadAgent(req.companyId);
  if (agent.company.is_demo) throw conflict('Na demonstração não há conexão real com o WhatsApp. Use o simulador para testar o assistente.');
  const t = await testConnection(agent.row);
  await q(`update wa_agents set connection_status = $2, connection_checked_at = now(), last_error = $3,
      display_phone = coalesce($4, display_phone), verified_name = coalesce($5, verified_name), quality_rating = coalesce($6, quality_rating) where company_id = $1`,
  [req.companyId, t.ok ? 'conectado' : 'erro', t.ok ? null : t.error, t.display_phone_number || null, t.verified_name || null, t.quality_rating || null]);
  await audit(null, req, { entity: 'wa_agent', entityId: req.companyId, action: 'agent.test', summary: `WhatsApp: teste de conexão ${t.ok ? 'bem-sucedido' : 'com falha'}` });
  res.json({ ...t, agent: publicView(await loadAgent(req.companyId), req) });
});

r.post('/connection/verify-token', need('agent_manage'), async (req, res) => {
  await q('update wa_agents set verify_token = $2, webhook_verified_at = null where company_id = $1', [req.companyId, randomToken(16)]);
  await audit(null, req, { entity: 'wa_agent', entityId: req.companyId, action: 'agent.verify_token', summary: 'WhatsApp: token de verificação do webhook trocado' });
  res.json(publicView(await loadAgent(req.companyId), req));
});

r.post('/connection/disconnect', need('agent_manage'), async (req, res) => {
  await q(`update wa_agents set enabled = false, secrets = null, phone_number_id = null, connection_status = 'nao_configurado', display_phone = null, verified_name = null,
      version = version + 1, updated_at = now() where company_id = $1`, [req.companyId]);
  await audit(null, req, { entity: 'wa_agent', entityId: req.companyId, action: 'agent.disconnect', summary: 'WhatsApp desconectado (credenciais apagadas)' });
  res.json(publicView(await loadAgent(req.companyId), req));
});

// ---------------- configuração ----------------
const hour = z.number().int().min(0).max(23);
const routineCfg = z.object({ enabled: z.boolean(), days: z.array(z.number().int().min(0).max(120)).max(6), template: z.string().trim().regex(/^[a-z0-9_]{0,512}$/, 'nome do modelo: letras minúsculas, números e _').optional(), template_lang: z.string().max(10).optional() }).partial();
const settingsSchema = z.object({
  sendHour: hour, windowStart: hour, windowEnd: z.number().int().min(1).max(24), weekends: z.boolean(), maxPerRun: z.number().int().min(1).max(1000), templateLang: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
  autoReply: z.boolean(), publicUrl: z.string().url().max(200).refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(u), 'use https'),
  routines: z.record(z.enum(Object.keys(CLIENT_ROUTINES)), routineCfg),
  team: z.object({ enabled: z.boolean(), hour, tasks: z.boolean(), whatsapp: z.boolean(), template: z.string().regex(/^[a-z0-9_]{0,512}$/),
    items: z.record(z.enum(Object.keys(TEAM_ITEMS)), z.boolean()), staleDays: z.object({ assistidas: z.number().int().min(1).max(30), comparativos: z.number().int().min(1).max(30), propostas: z.number().int().min(1).max(60) }).partial() }).partial(),
  texts: z.object({ menu: z.string().min(20).max(1500), handoff: z.string().min(10).max(600), optout: z.string().min(10).max(600) }).partial(),
}).partial();

r.put('/settings', need('agent_manage'), async (req, res) => {
  const d = parse(z.object({ version: z.number().int(), name: z.string().trim().min(2).max(40).optional(), enabled: z.boolean().optional(), settings: settingsSchema.optional() }), req.body);
  const agent = await loadAgent(req.companyId);
  if (d.version !== agent.row.version) throw conflict('A configuração foi alterada por outra pessoa. Recarregue a página.', { code: 'VERSION_CONFLICT' });
  const saved = agent.row.settings || {};
  const merged = { ...saved, ...(d.settings || {}),
    routines: { ...(saved.routines || {}), ...Object.fromEntries(Object.entries(d.settings?.routines || {}).map(([k, v]) => [k, { ...(saved.routines?.[k] || {}), ...v }])) },
    team: { ...(saved.team || {}), ...(d.settings?.team || {}), items: { ...(saved.team?.items || {}), ...(d.settings?.team?.items || {}) }, staleDays: { ...(saved.team?.staleDays || {}), ...(d.settings?.team?.staleDays || {}) } },
    texts: { ...(saved.texts || {}), ...(d.settings?.texts || {}) } };
  const cfg = agentSettings(merged);
  if (cfg.windowEnd <= cfg.windowStart) throw new HttpError(400, 'O fim do horário permitido precisa ser depois do início.');
  if (d.enabled === true && !agent.row.enabled) {
    if (agent.company.is_demo) throw conflict('Na demonstração os envios reais ficam desligados. Use o simulador.');
    if (!credentials(agent.row).ready) throw conflict('Conecte o número do WhatsApp (ID do número, token e segredo do app) antes de ligar o agente.');
    if (agent.row.connection_status !== 'conectado') throw conflict('Teste a conexão com sucesso antes de ligar o agente.');
  }
  await q(`update wa_agents set settings = $2, name = coalesce($3, name), enabled = coalesce($4, enabled), version = version + 1, updated_by = $5, updated_at = now() where company_id = $1`,
    [req.companyId, JSON.stringify(merged), d.name || null, d.enabled ?? null, req.user.id]);
  const changes = Object.keys(d.settings || {}).join(', ');
  await audit(null, req, { entity: 'wa_agent', entityId: req.companyId, action: 'agent.settings',
    summary: `Agente do WhatsApp: ${d.enabled === true ? 'ligado' : d.enabled === false ? 'desligado' : 'configuração alterada'}${changes ? ` (${changes})` : ''}` });
  res.json(publicView(await loadAgent(req.companyId), req));
});

// ---------------- rotinas ----------------
r.get('/routines/:key/preview', need('agent_manage'), async (req, res) => {
  if (!CLIENT_ROUTINES[req.params.key]) throw notFound();
  res.json(await previewRoutine(req.companyId, req.params.key));
});
r.post('/routines/:key/run', need('agent_manage'), async (req, res) => {
  if (!CLIENT_ROUTINES[req.params.key]) throw notFound();
  const out = await runRoutine(req.companyId, req.params.key, { manual: true, userId: req.user.id });
  await audit(null, req, { entity: 'wa_agent', entityId: req.companyId, action: 'agent.run', summary: `Rotina "${CLIENT_ROUTINES[req.params.key].label}" executada: ${out.sent} enviada(s), ${out.failed} falha(s)${out.note ? ` — ${out.note}` : ''}` });
  res.json(out);
});
r.post('/team/run', need('agent_manage'), async (req, res) => {
  const out = await runTeam(req.companyId, { manual: true, userId: req.user.id });
  res.json(out);
});
r.get('/runs', need('agent_manage'), async (req, res) => {
  const { rows } = await q(`select r.*, u.name as user_name from agent_runs r left join users u on u.id = r.user_id where r.company_id = $1 order by r.created_at desc limit 60`, [req.companyId]);
  res.json(rows);
});

/** Meus lembretes: WhatsApp do próprio usuário (qualquer perfil). */
r.put('/me', async (req, res) => {
  const d = parse(z.object({ phone: z.string().trim().max(30).nullable(), wa_reminders: z.boolean() }), req.body);
  const phone = d.phone ? toWaId(d.phone) : null;
  if (d.phone && !phone) throw new HttpError(400, 'Informe o celular com DDD (ex.: 19 99999-0000).');
  if (d.wa_reminders && !phone) throw new HttpError(400, 'Informe o celular para receber os lembretes.');
  await q('update users set phone = $2, wa_reminders = $3 where id = $1', [req.user.id, phone, d.wa_reminders]);
  await audit(null, req, { entity: 'user', entityId: req.user.id, action: 'user.wa_reminders', summary: `Lembretes no WhatsApp ${d.wa_reminders ? 'ligados' : 'desligados'}` });
  res.json({ phone: phone ? `•••• ${phone.slice(-4)}` : null, wa_reminders: d.wa_reminders });
});
r.get('/me', async (req, res) => {
  const u = await one('select phone, wa_reminders from users where id = $1', [req.user.id]);
  res.json({ phone: u.phone || null, wa_reminders: u.wa_reminders });
});

// ---------------- conversas ----------------
function convFilter(req, params) {
  const sc = scopeOf(req, 'clients_view');
  if (sc === 'all' || can(req, 'agent_manage')) return 'true';
  params.push(req.user.id);
  const i = params.length;
  return `(cv.assigned_user_id = $${i} or cl.owner_user_id = $${i} or (cv.client_id is null and cv.user_id is null))`;
}

r.get('/conversations', need('agent_manage', 'agent_inbox'), async (req, res) => {
  const params = [req.companyId, req.query.simulated === '1'];
  const where = ['cv.company_id = $1', 'cv.simulated = $2', convFilter(req, params)];
  if (req.query.status) { params.push(String(req.query.status)); where.push(`cv.status = $${params.length}`); }
  const { rows } = await q(`select cv.id, cv.phone, cv.status, cv.contact_name, cv.client_id, cl.name as client_name, cv.user_id, u.name as user_name, cv.unread,
       cv.handoff_reason, cv.opted_out_at, cv.last_inbound_at, cv.last_outbound_at, cv.updated_at, au.name as assigned_name,
       (select body from wa_messages m where m.conversation_id = cv.id order by created_at desc limit 1) as last_body
     from wa_conversations cv left join clients cl on cl.id = cv.client_id left join users u on u.id = cv.user_id left join users au on au.id = cv.assigned_user_id
     where ${where.join(' and ')} order by (cv.status = 'humano') desc, cv.updated_at desc limit 200`, params);
  res.json(rows.map((x) => ({ ...x, window_open: windowOpen(x) })));
});

async function loadConv(req, id) {
  const params = [idParam(id), req.companyId];
  const f = convFilter(req, params);
  const c = await one(`select cv.*, cl.name as client_name, cl.owner_user_id from wa_conversations cv left join clients cl on cl.id = cv.client_id
     where cv.id = $1 and cv.company_id = $2 and ${f}`, params);
  if (!c) throw notFound();
  return c;
}

r.get('/conversations/:id', need('agent_manage', 'agent_inbox'), async (req, res) => {
  const c = await loadConv(req, req.params.id);
  const { rows } = await q(`select m.id, m.direction, m.kind, m.body, m.template_name, m.status, m.error, m.routine, m.created_at, u.name as sent_by_name
     from wa_messages m left join users u on u.id = m.sent_by where m.conversation_id = $1 order by m.created_at, m.id limit 500`, [c.id]);
  if (c.unread) await q('update wa_conversations set unread = 0 where id = $1', [c.id]);
  res.json({ ...c, unread: 0, context: undefined, window_open: windowOpen(c), messages: rows });
});

r.post('/conversations/:id/messages', need('agent_manage', 'agent_inbox'), async (req, res) => {
  const d = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body);
  const c = await loadConv(req, req.params.id);
  if (!c.simulated && !windowOpen(c)) throw conflict('Fora da janela de 24 h do WhatsApp: só é possível enviar um modelo aprovado. Aguarde o cliente responder ou use uma rotina.', { code: 'WINDOW_CLOSED' });
  const agent = await loadAgent(req.companyId);
  const out = await deliver(agent, c, { text: d.text }, { sent_by: req.user.id, routine: 'manual' });
  if (!out.ok) throw new HttpError(502, `O WhatsApp não aceitou a mensagem: ${out.error}`);
  if (c.status !== 'humano') await q(`update wa_conversations set status = 'humano', assigned_user_id = coalesce(assigned_user_id, $2), handoff_at = coalesce(handoff_at, now()) where id = $1`, [c.id, req.user.id]);
  res.status(201).json(out);
});

r.post('/conversations/:id/status', need('agent_manage', 'agent_inbox'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(['humano', 'agente', 'encerrada']) }), req.body);
  const c = await loadConv(req, req.params.id);
  c.context = { ...(c.context || {}), awaiting: null };
  c.status = d.status;
  if (d.status === 'humano') { c.assigned_user_id = c.assigned_user_id || req.user.id; c.handoff_at = c.handoff_at || new Date().toISOString(); c.handoff_reason = c.handoff_reason || 'assumida pela equipe'; }
  if (d.status === 'agente') { c.handoff_reason = null; c.handoff_at = null; }
  await saveConversation(c);
  if (!c.simulated) await audit(null, req, { entity: 'wa_conversation', entityId: c.id, action: 'agent.conversation', summary: `Conversa do WhatsApp: ${d.status === 'humano' ? 'assumida pela equipe' : d.status === 'agente' ? 'devolvida ao assistente' : 'encerrada'}` });
  res.json({ ok: true });
});

// ---------------- simulador (nada sai do sistema) ----------------
r.post('/simulate', need('agent_manage', 'agent_inbox'), async (req, res) => {
  const d = parse(z.object({ client_id: z.string().uuid().nullable().optional(), phone: z.string().max(30).nullable().optional(), text: z.string().trim().min(1).max(1000) }), req.body);
  let phone = d.phone ? toWaId(d.phone) : null;
  if (d.client_id) {
    const cl = await one('select phone, owner_user_id from clients where id = $1 and company_id = $2', [d.client_id, req.companyId]);
    if (!cl) throw notFound();
    if (scopeOf(req, 'clients_view') === 'own' && cl.owner_user_id !== req.user.id) throw notFound();
    phone = toWaId(cl.phone);
    if (!phone) throw new HttpError(400, 'Este cliente não tem celular válido no cadastro.');
  }
  if (!phone) phone = '5500000000000';
  const agent = await loadAgent(req.companyId);
  const out = await processInbound(agent, { phone, text: d.text, simulated: true });
  res.json({ replies: out.replies, conversation_id: out.conversation.id, status: out.conversation.status });
});
r.delete('/simulate', need('agent_manage', 'agent_inbox'), async (req, res) => {
  await q('delete from wa_conversations where company_id = $1 and simulated', [req.companyId]);
  res.json({ ok: true });
});

export default r;
