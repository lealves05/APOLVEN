// Portal do cliente por link temporário, revogável e com finalidade única (23). CPF, placa ou número da apólice
// nunca servem de segredo de acesso. O cliente não vê comissão, notas internas, outros clientes ou dados restritos.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { parse, HttpError, notFound, sha256, today, withDefaults } from '../util.js';
import { limitByIp } from '../security.js';
import { comparisonData, clientComparison, registerChoice } from './quotes.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';
import { storeDocument, sendDocument } from './documents.js';
import { emit } from '../audit.js';

const r = Router();
const viewLimiter = limitByIp('public-view', 120, 15 * 60);
const actionLimiter = limitByIp('public-action', 20, 15 * 60);

async function resolve(req, purpose) {
  const token = String(req.params.token || '');
  if (!/^[0-9a-f]{48}$/.test(token)) throw notFound('Link inválido.');
  const link = await one(`select * from public_links where token_hash = $1 and purpose = $2`, [sha256(token), purpose]);
  if (!link || link.revoked_at || new Date(link.expires_at) < new Date()) throw new HttpError(410, 'Este link expirou ou foi revogado. Peça um novo link à corretora.');
  await q('update public_links set last_access_at = now(), access_count = access_count + 1 where id = $1', [link.id]);
  return link;
}

r.get('/comparativo/:token', viewLimiter, async (req, res) => {
  const link = await resolve(req, 'comparativo');
  const c = await one('select * from comparisons where id = $1 and company_id = $2', [link.entity_id, link.company_id]);
  if (!c || c.status === 'cancelado') throw notFound();
  const data = await comparisonData(link.company_id, c);
  res.json(clientComparison({ comparison: c, ...data, settings: withDefaults(data.company.settings) }));
});

/** Escolha e autorização do cliente para a opção exata. Manifestação ≠ aceite da seguradora (A11). */
r.post('/comparativo/:token/choose', actionLimiter, async (req, res) => {
  const d = parse(z.object({ offer_id: z.string().uuid(), payment_option: z.string().max(30).nullable().optional(), name: z.string().trim().min(3).max(160),
    authorize: z.literal(true, { errorMap: () => ({ message: 'marque a autorização para continuar' }) }) }), req.body);
  const link = await resolve(req, 'comparativo');
  const c = await one('select * from comparisons where id = $1 and company_id = $2', [link.entity_id, link.company_id]);
  if (!c) throw notFound();
  await tx(async (db) => {
    await registerChoice(db, link.company_id, c, { offer_id: d.offer_id, payment_option: d.payment_option, via: 'portal', by_name: d.name, ip: String(req.ip || '').slice(0, 64) });
    await db.query(`insert into tasks (company_id, title, kind, priority, due_at, client_id, entity, entity_id, auto_key) values ($1,$2,'proposta','alta',now() + interval '1 day',$3,'comparison',$4,$5) on conflict do nothing`,
      [link.company_id, `Cliente escolheu opção no comparativo ${c.number}: preparar proposta`, c.client_id, c.id, `escolha:${c.id}`]);
    await db.query(`insert into audit_log (company_id, user_name, entity, entity_id, action, summary, ip) values ($1,$2,'comparison',$3,'portal.choice',$4,$5)`,
      [link.company_id, `Cliente: ${d.name}`, c.id, 'Escolha e autorização registradas pelo cliente no link temporário', String(req.ip || '').slice(0, 64)]);
  });
  res.json({ ok: true, message: 'Recebemos sua escolha. A corretora vai preparar a proposta e enviar à seguradora; a contratação só vale depois da aceitação da seguradora.' });
});

/** Parcelas de uma apólice: estado, origem e data da última atualização; links oficiais de pagamento. */
r.get('/parcelas/:token', viewLimiter, async (req, res) => {
  const link = await resolve(req, 'parcelas');
  const p = await one(`select p.id, p.policy_number, p.branch, p.start_date, p.end_date, i.name as institution_name, i.assistance_phone, c.name as client_name, co.trade_name, co.name as company_name, co.phone as company_phone, co.settings
     from policies p join institutions i on i.id = p.institution_id join clients c on c.id = p.client_id join companies co on co.id = p.company_id
     where p.id = $1 and p.company_id = $2`, [link.entity_id, link.company_id]);
  if (!p) throw notFound();
  const { rows } = await q(`select i.*, ${INSTALLMENT_AGG} from premium_installments i where i.company_id = $1 and i.policy_id = $2 order by i.number`, [link.company_id, p.id]);
  const s = withDefaults(p.settings);
  res.json({ policy: { policy_number: p.policy_number, institution: p.institution_name, assistance_phone: p.assistance_phone, start_date: p.start_date, end_date: p.end_date, client: p.client_name },
    broker: { name: p.trade_name || p.company_name, phone: p.company_phone },
    installments: rows.map((x) => installmentState(x, today(s.timezone), s.installments.upcomingDays)).map((x) => ({ id: x.id, number: x.number, total_count: x.total_count, due_date: x.due_date,
      amount_cents: x.due_total_cents, balance_cents: x.balance_cents, status: x.status, charge_url: x.charge_url, last_update_at: x.last_update_at, source: x.source })),
    notice: 'Os pagamentos são feitos diretamente à seguradora pelos canais oficiais. Comprovantes enviados aqui ficam em conferência até a confirmação da seguradora.' });
});

/** Envio de comprovante: vira "pagamento informado" em conferência — nunca confirmação (A24). */
r.post('/parcelas/:token/comprovante', actionLimiter, async (req, res) => {
  const d = parse(z.object({ installment_id: z.string().uuid(), amount_cents: z.number().int().positive(), paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    filename: z.string().max(200), mime: z.string().max(120), data: z.string().max(12_000_000) }), req.body);
  const link = await resolve(req, 'parcelas');
  const inst = await one('select i.*, p.client_id from premium_installments i join policies p on p.id = i.policy_id where i.id = $1 and i.company_id = $2 and i.policy_id = $3', [d.installment_id, link.company_id, link.entity_id]);
  if (!inst) throw notFound();
  const co = await one(`select settings->>'timezone' as tz from companies where id = $1`, [link.company_id]);
  if (d.paid_date > today(co?.tz || undefined)) throw new HttpError(400, 'Data de pagamento no futuro.');
  await tx(async (db) => {
    const doc = await storeDocument(db, { companyId: link.company_id, entity: 'premium_installment', entityId: inst.id, clientId: inst.client_id, kind: 'comprovante',
      filename: d.filename, mime: d.mime, base64: d.data, origin: 'cliente' });
    const { rows: [pay] } = await db.query(`insert into premium_payments (company_id, installment_id, kind, amount_cents, paid_date, source, evidence, document_id) values ($1,$2,'informado',$3,$4,'cliente','Comprovante enviado pelo cliente no portal',$5) returning id`,
      [link.company_id, inst.id, d.amount_cents, d.paid_date, doc.id]);
    await db.query('update premium_installments set reminders_paused = true, last_update_at = now() where id = $1', [inst.id]);
    await db.query(`insert into tasks (company_id, title, kind, priority, due_at, client_id, entity, entity_id, auto_key) values ($1,$2,'parcela','normal',now() + interval '2 days',$3,'premium_installment',$4,$5) on conflict do nothing`,
      [link.company_id, `Conferir comprovante enviado pelo cliente (parcela ${inst.number})`, inst.client_id, inst.id, `conferir-pagto:${pay.id}`]);
    await emit(db, link.company_id, 'PremiumPaymentReported', 'premium_installment', inst.id, { source: 'cliente' });
  });
  res.status(201).json({ ok: true, message: 'Comprovante recebido. Ele fica em conferência até a confirmação da seguradora.' });
});

r.get('/documento/:token', viewLimiter, async (req, res) => {
  const link = await resolve(req, 'documento');
  const doc = await one(`select * from documents where id = $1 and company_id = $2 and access_level = 'normal'`, [link.entity_id, link.company_id]);
  if (!doc) throw notFound();
  await sendDocument(res, doc);
});

export default r;
