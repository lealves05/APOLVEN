// Endpoints públicos do agente:
//   GET  /api/whatsapp/webhook — verificação do webhook pela Meta (hub.verify_token)
//   POST /api/whatsapp/webhook — mensagens e status (assinatura X-Hub-Signature-256 obrigatória)
//   GET  /api/agent/cron        — agendador (Cron Trigger do Worker, Authorization: Bearer <segredo>)
import crypto from 'node:crypto';
import { Router } from 'express';
import { q, one } from '../db.js';
import { HttpError } from '../util.js';
import { limitByIp } from '../security.js';
import { accessFor } from '../platform.js';
import { validSignature, parseWebhook, credentials } from '../agent/whatsapp.js';
import { loadAgent, processInbound } from '../agent/service.js';
import { runAll } from '../agent/routines.js';

export const whatsappWebhook = Router();

whatsappWebhook.get('/webhook', limitByIp('wa-verify', 30, 15 * 60), async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  if (mode !== 'subscribe' || token.length < 16) throw new HttpError(403, 'Verificação inválida.');
  const a = await one('select company_id from wa_agents where verify_token = $1', [token]);
  if (!a) throw new HttpError(403, 'Token de verificação inválido.');
  await q(`update wa_agents set webhook_verified_at = now(), connection_status = case when connection_status in ('configurado', 'nao_configurado') then 'verificado' else connection_status end
     where company_id = $1`, [a.company_id]);
  res.type('text/plain').send(challenge.replace(/[^\w.-]/g, '').slice(0, 200));
});

const STATUS = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

whatsappWebhook.post('/webhook', async (req, res) => {
  const { messages, statuses } = parseWebhook(req.body);
  const pnid = messages[0]?.phoneNumberId || statuses[0]?.phoneNumberId;
  if (!pnid) return res.json({ ok: true });
  const row = await one('select * from wa_agents where phone_number_id = $1', [pnid]);
  if (!row) return res.json({ ok: true }); // número não cadastrado: ignora
  if (!validSignature(req.rawBody, req.get('x-hub-signature-256'), credentials(row).appSecret)) {
    console.warn('[whatsapp] assinatura inválida', row.company_id);
    throw new HttpError(401, 'Assinatura inválida.');
  }
  await q('update wa_agents set last_webhook_at = now() where company_id = $1', [row.company_id]);
  for (const s of statuses) {
    if (STATUS[s.status]) {
      await q(`update wa_messages set status = $3, error = coalesce($4, error) where company_id = $1 and wa_message_id = $2
          and not (status = 'lida' and $3 in ('enviada', 'entregue')) and not (status = 'entregue' and $3 = 'enviada')`,
      [row.company_id, s.id, STATUS[s.status], s.error]);
    }
  }
  if (messages.length) {
    const agent = await loadAgent(row.company_id);
    // empresa bloqueada ou sem o módulo: as mensagens ficam registradas, mas o agente não responde
    const acc = await accessFor(row.company_id).catch(() => null);
    if (acc?.blocked || (acc?.features && acc.features.whatsapp === false)) agent.row.enabled = false;
    for (const m of messages) {
      try {
        await processInbound(agent, { phone: m.from, name: m.name, text: m.text, type: m.text != null ? 'text' : m.type, waMessageId: m.id });
      } catch (e) {
        // responde 200 mesmo assim (a Meta reenviaria em loop); o erro fica no log
        console.error('[whatsapp] falha ao processar mensagem', row.company_id, e.message);
      }
    }
  }
  res.json({ ok: true });
});

/** Segredo do agendador: APOLVEN_CRON_SECRET (variável/segredo da função) ou _secrets.cron_secret. */
async function cronSecret() {
  if (process.env.APOLVEN_CRON_SECRET) return process.env.APOLVEN_CRON_SECRET;
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try { return (await one("select value from _secrets where key = 'cron_secret'"))?.value || null; } catch { return null; }
}

export const agentCron = Router();
agentCron.get('/cron', limitByIp('agent-cron', 20, 60 * 60), async (req, res) => {
  const want = await cronSecret();
  if (!want || want.length < 24) throw new HttpError(503, 'Agendador não configurado.');
  const got = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw new HttpError(401, 'Não autorizado.');
  const report = await runAll();
  res.json({ ok: true, companies: new Set(report.map((r) => r.company)).size, sent: report.reduce((a, r) => a + (r.sent || 0), 0), failed: report.reduce((a, r) => a + (r.failed || 0), 0) });
});
