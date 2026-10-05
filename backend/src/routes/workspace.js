// Busca global (4.1), central de pendências/notificações, automações idempotentes (20) e links do portal.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need, can, scopeOf } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, idParam, onlyDigits, maskDocument, sha256, randomToken, today, addDays } from '../util.js';
import { own, assertClientVisible, portfolioFilter } from '../lib/common.js';
import { overdueInstallmentTasks, expiringQuoteTasks } from '../lib/automations.js';
import { generateRenewalTasks } from './policies.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';

const r = Router();

/** Busca por nome, CPF/CNPJ parcial (resultado mascarado), apólice, proposta, placa e protocolo — respeitando permissões. */
r.get('/search', async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const like = `%${term.toLowerCase()}%`;
  const digits = onlyDigits(term);
  const own2 = scopeOf(req, 'clients_view') === 'own';
  const out = [];
  if (can(req, 'clients_view')) {
    const { rows } = await q(`select id, name, document, kind from clients where company_id = $1 and merged_into is null and (lower(name) like $2 ${digits.length >= 3 ? 'or document like $3' : ''})
       ${own2 ? `and owner_user_id = $${digits.length >= 3 ? 4 : 3}` : ''} limit 8`, [req.companyId, like, ...(digits.length >= 3 ? [`%${digits}%`] : []), ...(own2 ? [req.user.id] : [])]);
    out.push(...rows.map((c) => ({ type: 'client', id: c.id, title: c.name, subtitle: maskDocument(c.document) || (c.kind === 'pj' ? 'Pessoa jurídica' : 'Pessoa física') })));
  }
  if (can(req, 'policies_view')) {
    const { rows } = await q(`select distinct p.id, p.policy_number, p.branch, c.name as client_name, it.identifier from policies p join clients c on c.id = p.client_id
       left join policy_items it on it.policy_id = p.id and upper(coalesce(it.identifier,'')) like upper($2)
       where p.company_id = $1 and (upper(coalesce(p.policy_number,'')) like upper($2) or upper(coalesce(p.certificate_number,'')) like upper($2) or it.id is not null)
       ${scopeOf(req, 'policies_view') === 'own' ? 'and c.owner_user_id = $3' : ''} limit 8`, [req.companyId, `%${term}%`, ...(scopeOf(req, 'policies_view') === 'own' ? [req.user.id] : [])]);
    out.push(...rows.map((p) => ({ type: 'policy', id: p.id, title: `Apólice ${p.policy_number || '—'}`, subtitle: `${p.client_name}${p.identifier ? ` · ${p.identifier}` : ''}` })));
  }
  if (can(req, 'quotes_view') && /^\d+$/.test(term)) {
    const { rows } = await q(`select 'proposal' as type, id, number from proposals where company_id = $1 and number = $2 union all select 'quote', id, number from quote_requests where company_id = $1 and number = $2`, [req.companyId, Number(term)]);
    out.push(...rows.map((x) => ({ type: x.type, id: x.id, title: `${x.type === 'proposal' ? 'Proposta' : 'Cotação'} nº ${x.number}` })));
  }
  if (can(req, 'claims')) {
    const { rows } = await q(`select id, number, insurer_protocol from claims where company_id = $1 and (lower(coalesce(insurer_protocol,'')) like $2 ${/^\d+$/.test(term) ? 'or number = $3' : ''}) limit 5`,
      [req.companyId, like, ...(/^\d+$/.test(term) ? [Number(term)] : [])]);
    out.push(...rows.map((x) => ({ type: 'claim', id: x.id, title: `Sinistro nº ${x.number}`, subtitle: x.insurer_protocol ? `Protocolo ${x.insurer_protocol}` : null })));
  }
  res.json(out);
});

/** Notificações calculadas a partir dos dados (nada é enviado para fora). */
r.get('/notifications', async (req, res) => {
  const ref = today(req.settings.timezone);
  const items = [];
  const { rows: [t] } = await q(`select count(*) filter (where due_at < now())::int as overdue, count(*) filter (where due_at::date = current_date)::int as today
     from tasks where company_id = $1 and status = 'aberta' and (assignee_user_id = $2 or (assignee_user_id is null and $3))`, [req.companyId, req.user.id, can(req, 'tasks')]);
  if (t.overdue) items.push({ level: 'danger', text: `${t.overdue} tarefa(s) atrasada(s)`, to: '/agenda' });
  if (t.today) items.push({ level: 'info', text: `${t.today} tarefa(s) para hoje`, to: '/agenda' });
  if (can(req, 'quotes_view')) {
    const { rows: [x] } = await q(`select count(*)::int as n from quote_tasks qt join quote_rounds r on r.id = qt.round_id where qt.company_id = $1 and qt.status = 'pendente_assistida' and r.status <> 'cancelada'`, [req.companyId]);
    if (x.n) items.push({ level: 'warn', text: `${x.n} consulta(s) assistida(s) aguardando resposta`, to: '/cotacoes' });
    const { rows: [e] } = await q(`select count(*)::int as n from quote_offers where company_id = $1 and status = 'ativa' and valid_until between current_date and current_date + $2::int`, [req.companyId, req.settings.quotes.expiringDays]);
    if (e.n) items.push({ level: 'warn', text: `${e.n} cotação(ões) perto de vencer`, to: '/cotacoes' });
    const { rows: [p] } = await q(`select count(*)::int as n from proposals where company_id = $1 and status = 'autorizada_cliente'`, [req.companyId]);
    if (p.n) items.push({ level: 'warn', text: `${p.n} proposta(s) autorizada(s) ainda não transmitida(s)`, to: '/propostas' });
  }
  if (can(req, 'renewals')) {
    const { rows: [x] } = await q(`select count(*)::int as n from policies p where company_id = $1 and contract_state = 'vigente' and end_date between current_date and current_date + 30
       and not exists (select 1 from policies n where n.previous_policy_id = p.id) and not exists (select 1 from opportunities o where o.renewal_of_policy_id = p.id)`, [req.companyId]);
    if (x.n) items.push({ level: 'warn', text: `${x.n} apólice(s) vencem em 30 dias sem renovação iniciada`, to: '/renovacoes' });
  }
  if (can(req, 'installments')) {
    const { rows } = await q(`select i.*, ${INSTALLMENT_AGG} from premium_installments i where i.company_id = $1 and i.due_date < current_date and i.status_override is null`, [req.companyId]);
    const overdue = rows.map((x) => installmentState(x, ref)).filter((x) => x.status === 'vencida').length;
    const informed = rows.map((x) => installmentState(x, ref)).filter((x) => x.status === 'pagamento_informado').length;
    if (overdue) items.push({ level: 'danger', text: `${overdue} parcela(s) do seguro vencida(s)`, to: '/parcelas?status=vencida' });
    if (informed) items.push({ level: 'info', text: `${informed} pagamento(s) informado(s) aguardando conferência`, to: '/parcelas?status=pagamento_informado' });
  }
  if (can(req, 'claims')) {
    const { rows: [x] } = await q(`select count(*)::int as n from claims where company_id = $1 and deadline_at < now() + interval '3 days' and work_status not in ('encerrado','indenizado','negado')`, [req.companyId]);
    if (x.n) items.push({ level: 'danger', text: `${x.n} sinistro(s) com prazo próximo`, to: '/sinistros' });
  }
  if (can(req, 'integrations_view')) {
    const { rows: [x] } = await q(`select count(*)::int as n from credential_versions where company_id = $1 and revoked_at is null and expires_at < now() + interval '30 days'`, [req.companyId]);
    if (x.n) items.push({ level: 'warn', text: `${x.n} credencial(is) de integração vencendo`, to: '/integracoes?tab=pendencias' });
  }
  if (can(req, 'commissions_view')) {
    const { rows: [x] } = await q(`select count(*)::int as n from statement_lines where company_id = $1 and status = 'divergente'`, [req.companyId]);
    if (x.n) items.push({ level: 'warn', text: `${x.n} linha(s) de extrato com divergência`, to: '/comissoes?tab=extratos' });
  }
  if (can(req, 'agent_inbox') || can(req, 'agent_manage')) {
    const { rows: [x] } = await q(`select count(*)::int as n from wa_conversations cv left join clients c on c.id = cv.client_id where cv.company_id = $1 and not cv.simulated
        and cv.status = 'humano' and cv.unread > 0 and ($2 or cv.assigned_user_id = $3 or c.owner_user_id = $3 or cv.assigned_user_id is null)`, [req.companyId, scopeOf(req, 'clients_view') === 'all', req.user.id]);
    if (x.n) items.push({ level: 'warn', text: `${x.n} conversa(s) no WhatsApp aguardando um corretor`, to: '/agente-whatsapp?tab=conversas' });
  }
  res.json(items);
});

/**
 * Automações padrão (20.2), idempotentes por regra/entidade/marco: tarefas de renovação, de parcela vencida e de
 * cotação perto de vencer. Nenhuma mensagem externa é enviada; o corretor decide e envia pelo próprio aparelho.
 */
r.post('/automations/run', async (req, res) => {
  const out = { renewals: 0, installments: 0, quotes: 0 };
  const ctx = { companyId: req.companyId, settings: req.settings };
  if (can(req, 'renewals')) out.renewals = await generateRenewalTasks(ctx);
  if (can(req, 'installments')) out.installments = await overdueInstallmentTasks(ctx);
  if (can(req, 'quotes_view')) out.quotes = await expiringQuoteTasks(ctx);
  res.json(out);
});

/** Link do portal com as parcelas de uma apólice (finalidade única, temporário, revogável). */
r.post('/portal-links', async (req, res) => {
  const d = parse(z.object({ policy_id: z.string().uuid(), days: z.number().int().min(1).max(60).default(15) }), req.body);
  if (!can(req, 'installments')) throw new HttpError(403, 'Sem permissão.');
  const p = await own('policies', d.policy_id, req.companyId, 'id, client_id, policy_number');
  await assertClientVisible(req, 'policies_view', p.client_id);
  const token = randomToken(24);
  await q(`insert into public_links (company_id, purpose, entity, entity_id, client_id, token_hash, expires_at, created_by) values ($1,'parcelas','policy',$2,$3,$4, now() + make_interval(days => $5), $6)`,
    [req.companyId, p.id, p.client_id, sha256(token), d.days, req.user.id]);
  await audit(null, req, { entity: 'policy', entityId: p.id, action: 'portal.link', summary: `Link de parcelas da apólice ${p.policy_number || ''} (${d.days} dias)` });
  res.status(201).json({ token, path: `/p/parcelas/${token}` });
});

/** Mensagens preparadas (o envio acontece no aparelho do usuário). */
r.get('/messages', async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'clients_view', 'c', params);
  let cond = ` and (m.client_id is null or ${f.sql})`;
  if (req.query.client_id) { params.push(idParam(req.query.client_id)); cond += ` and m.client_id = $${params.length}`; }
  const { rows } = await q(`select m.*, c.name as client_name from messages m left join clients c on c.id = m.client_id where m.company_id = $1${cond} order by m.created_at desc limit 200`, params);
  res.json(rows);
});
r.post('/messages', async (req, res) => {
  const d = parse(z.object({ client_id: z.string().uuid(), channel: z.enum(['whatsapp', 'email', 'telefone']), purpose: z.enum(['relacionamento', 'marketing', 'comparativo', 'parcela', 'renovacao', 'sinistro', 'outro']),
    body: z.string().trim().min(2).max(4000), entity: z.string().max(40).nullable().optional(), entity_id: z.string().uuid().nullable().optional() }), req.body);
  const c = await own('clients', d.client_id, req.companyId, 'id, marketing_opt_out, phone, email');
  await assertClientVisible(req, 'clients_view', c.id);
  // campanhas só para contatos habilitados (5.3 / 20.1)
  if (d.purpose === 'marketing') {
    if (c.marketing_opt_out) throw new HttpError(409, 'Cliente bloqueou comunicações de marketing.');
    const ok = await one(`select 1 from consents where company_id = $1 and client_id = $2 and purpose = 'marketing' and revoked_at is null`, [req.companyId, c.id]);
    if (!ok) throw new HttpError(409, 'Sem autorização de marketing registrada para este cliente.');
  }
  const m = await one(`insert into messages (company_id, client_id, channel, purpose, body, entity, entity_id, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [req.companyId, c.id, d.channel, d.purpose, d.body, d.entity || null, d.entity_id || null, req.user.id, req.user.name]);
  await q(`insert into activities (company_id, client_id, kind, summary, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6)`,
    [req.companyId, c.id, d.channel === 'telefone' ? 'ligacao' : d.channel, `Mensagem (${d.purpose}) preparada para envio pelo aparelho`, req.user.id, req.user.name]);
  res.status(201).json({ ...m, phone: c.phone, email: c.email });
});

export default r;
