// Central de cotações e multicálculo (8) + comparativos ao cliente (9.1).
// O motor consulta as fontes elegíveis e autorizadas; sem conector ativo, a tarefa vira consulta ASSISTIDA:
// a equipe registra a resposta formal (com documento/protocolo, origem e validade). Nada é simulado.
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, BRANCH_KEYS, BRANCHES, hashOf, today, addDays, sha256, randomToken, isUuid } from '../util.js';
import { nextNumber, own, portfolioFilter, assertClientVisible, logActivity, docNumber } from '../lib/common.js';
import { validateRisk, schemaFor } from '../lib/risk.js';
import { eligibility } from './catalog.js';
import { hasConsent } from './clients.js';
import { scoreOffers, coverageSummary, TASK_STATUS, TASK_PENDING } from '../lib/compare.js';
import { templateBy, adapterFor, hasAutomaticAdapter } from '../lib/connectors.js';
import { activationBlockers } from './integrations.js';

const r = Router();

const minCoverageSchema = z.object({ code: z.string().max(60), name: z.string().max(160), min_limit_cents: z.number().int().nonnegative().nullable().optional(), required: z.boolean().default(true) });
const roundSchema = z.object({
  risk: z.record(z.any()).default({}),
  min_coverages: z.array(minCoverageSchema).max(40).default([]),
  preferences: z.object({ assistances: z.array(z.string().max(80)).max(20).optional(), deductible: z.string().max(200).optional(), payment: z.string().max(200).optional(), notes: z.string().max(2000).optional() }).default({}),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sources: z.array(z.string().uuid()).max(60).optional(),      // conexões escolhidas (vazio = todas as elegíveis)
  scenarios: z.array(z.enum(['minima', 'ampliada', 'franquia_reduzida', 'franquia_majorada'])).min(1).max(4).default(['minima']),
  sharing_basis: z.string().trim().min(3, 'informe a base para compartilhar os dados com as seguradoras').max(300),
});

async function sensitiveCheck(req, branch, clientId) {
  if (schemaFor(branch).sensitive && !(await hasConsent(null, req.companyId, clientId, 'dados_sensiveis'))) {
    throw new HttpError(409, 'Este ramo envolve dados sensíveis: registre a autorização específica do cliente antes de cotar.', { code: 'CONSENT_REQUIRED' });
  }
}
async function consentNotRevoked(req, clientId) {
  const rev = await one(`select 1 from consents where company_id = $1 and client_id = $2 and purpose = 'cotacao' and revoked_at is not null
     and not exists (select 1 from consents c2 where c2.company_id = $1 and c2.client_id = $2 and c2.purpose = 'cotacao' and c2.revoked_at is null and c2.granted_at > consents.revoked_at)`, [req.companyId, clientId]);
  if (rev) throw new HttpError(409, 'O cliente revogou a autorização para compartilhar dados em cotações.', { code: 'CONSENT_REVOKED' });
}

/** Cria uma rodada imutável e suas tarefas por fonte/cenário (8.1-8 / 8.3-1). */
async function createRound(db, req, request, d) {
  const { data: risk, missing, version } = validateRisk(request.branch, d.risk);
  if (missing.length) throw new HttpError(400, `Dados insuficientes para cotar: ${missing.join(', ')}.`, { code: 'INSUFFICIENT_DATA', missing });
  if (d.start_date && d.end_date && d.end_date <= d.start_date) throw new HttpError(400, 'Fim de vigência deve ser posterior ao início.');
  const el = await eligibility(req.companyId, request.branch);
  let chosen = el.eligible;
  if (d.sources?.length) {
    chosen = el.eligible.filter((e) => d.sources.includes(e.connection_id));
    if (chosen.length !== new Set(d.sources).size) throw new HttpError(400, 'Há fonte escolhida que não está elegível para este ramo.');
  }
  if (!chosen.length) throw new HttpError(409, 'Nenhuma seguradora elegível para este ramo. Cadastre o credenciamento em Seguradoras e Integrações.', { code: 'NO_ELIGIBLE_SOURCE', excluded: el.excluded });
  const { rows: [{ n }] } = await db.query('select coalesce(max(round_no),0)+1 as n from quote_rounds where company_id = $1 and request_id = $2', [req.companyId, request.id]);
  const snapshot = { risk, min_coverages: d.min_coverages, preferences: d.preferences, start_date: d.start_date || null, end_date: d.end_date || null, version, scoring: req.settings.scoring, sharing_basis: d.sharing_basis };
  const { rows: [round] } = await db.query(`insert into quote_rounds (company_id, request_id, round_no, risk_schema_version, risk_data, min_coverages, preferences, start_date, end_date, scoring, data_hash, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
  [req.companyId, request.id, n, version, risk, JSON.stringify(d.min_coverages), { ...d.preferences, sharing_basis: d.sharing_basis }, d.start_date || null, d.end_date || null,
    req.settings.scoring, hashOf(snapshot), req.user.id]);
  for (const e of chosen) {
    for (const sc of d.scenarios) {
      await db.query(`insert into quote_tasks (company_id, round_id, institution_id, connection_id, scenario, mode, status, assignee_user_id, due_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.companyId, round.id, e.institution_id, e.connection_id, sc, e.mode, e.mode === 'automatica' ? 'aguardando' : 'pendente_assistida', req.user.id,
        e.mode === 'assistida' ? new Date(Date.now() + 2 * 86400000).toISOString() : null]);
    }
  }
  await db.query(`update quote_requests set status = 'em_andamento', updated_at = now() where id = $1`, [request.id]);
  await emit(db, req.companyId, 'QuoteRequested', 'quote_round', round.id, { request: request.id, round: n, sources: chosen.length });
  return { round, eligible: chosen, excluded: el.excluded };
}

r.get('/', need('quotes_view'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'quotes_view', 'c', params);
  const where = ['qr.company_id = $1', f.sql];
  if (req.query.status) { params.push(req.query.status); where.push(`qr.status = $${params.length}`); }
  if (req.query.client_id && isUuid(req.query.client_id)) { params.push(req.query.client_id); where.push(`qr.client_id = $${params.length}`); }
  const { rows } = await q(`select qr.*, c.name as client_name,
      (select count(*)::int from quote_offers o join quote_rounds rr on rr.id = o.round_id where rr.request_id = qr.id and o.status = 'ativa') as offers,
      (select count(*)::int from quote_tasks t join quote_rounds rr on rr.id = t.round_id where rr.request_id = qr.id and t.status = any($${params.length + 1})) as pending
    from quote_requests qr join clients c on c.id = qr.client_id where ${where.join(' and ')} order by qr.created_at desc limit 300`, [...params, TASK_PENDING]);
  res.json(rows);
});

r.post('/', need('quotes_manage'), async (req, res) => {
  const d = parse(roundSchema.extend({
    client_id: z.string().uuid(), branch: z.enum(BRANCH_KEYS), opportunity_id: z.string().uuid().nullable().optional(),
    renewal_of_policy_id: z.string().uuid().nullable().optional(), title: z.string().max(200).optional(),
  }), req.body);
  await own('clients', d.client_id, req.companyId, 'id');
  await assertClientVisible(req, 'clients_view', d.client_id);
  if (d.opportunity_id) await own('opportunities', d.opportunity_id, req.companyId, 'id');
  if (d.renewal_of_policy_id) await own('policies', d.renewal_of_policy_id, req.companyId, 'id');
  await consentNotRevoked(req, d.client_id);
  await sensitiveCheck(req, d.branch, d.client_id);
  const out = await tx(async (db) => {
    const number = await nextNumber(db, req.companyId, 'quote');
    const { rows: [request] } = await db.query(`insert into quote_requests (company_id, number, client_id, opportunity_id, renewal_of_policy_id, branch, title, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [req.companyId, number, d.client_id, d.opportunity_id || null, d.renewal_of_policy_id || null, d.branch, d.title || `${BRANCHES[d.branch]}`, req.user.id]);
    const round = await createRound(db, req, request, d);
    if (d.opportunity_id) await db.query(`update opportunities set stage = 'cotacao', updated_at = now() where id = $1 and company_id = $2 and stage in ('novo_contato','qualificacao','coleta_dados')`, [d.opportunity_id, req.companyId]);
    await logActivity(db, req, { clientId: d.client_id, opportunityId: d.opportunity_id || null, entity: 'quote_request', entityId: request.id,
      summary: `Cotação ${docNumber(req.settings, 'quote', number)} criada (${BRANCHES[d.branch]}): ${round.eligible.length} fonte(s). Base de compartilhamento: ${d.sharing_basis}` });
    await audit(db, req, { entity: 'quote_request', entityId: request.id, action: 'quote.create', summary: `Cotação ${number} — destinatários: ${round.eligible.map((e) => e.institution_name).join(', ')}` });
    return { request, ...round };
  });
  res.status(202).json(out);
});

async function loadRequest(req, id) {
  const qr = await one(`select qr.*, c.name as client_name, c.owner_user_id from quote_requests qr join clients c on c.id = qr.client_id where qr.id = $1 and qr.company_id = $2`, [idParam(id), req.companyId]);
  if (!qr) throw notFound();
  await assertClientVisible(req, 'quotes_view', qr.client_id);
  return qr;
}

/** Projeção da oferta: comissão só para quem pode ver comissões. */
const presentOffer = (req, o) => (can(req, 'commissions_view') ? o : { ...o, commission_rate: null, commission_source: null });

export async function roundView(req, round) {
  const [tasks, offers, insts] = await Promise.all([
    q(`select t.*, i.name as institution_name, i.cnpj, u.name as assignee_name from quote_tasks t join institutions i on i.id = t.institution_id
       left join users u on u.id = t.assignee_user_id where t.company_id = $1 and t.round_id = $2 order by i.name, t.scenario`, [req.companyId, round.id]),
    q(`select o.*, i.name as institution_name from quote_offers o join institutions i on i.id = o.institution_id where o.company_id = $1 and o.round_id = $2 order by o.total_premium_cents`, [req.companyId, round.id]),
    q('select id, cnpj, name from institutions where company_id is null or company_id = $1', [req.companyId]),
  ]);
  const summary = coverageSummary(tasks.rows, offers.rows, insts.rows);
  const scored = scoreOffers(offers.rows, round.min_coverages, round.scoring, round.preferences, today(req.settings.timezone));
  return { ...round, tasks: tasks.rows.map((t) => ({ ...t, status_label: TASK_STATUS[t.status] })), offers: scored.offers.map((o) => presentOffer(req, o)), badges: scored.badges, summary };
}

r.get('/:id', need('quotes_view'), async (req, res) => {
  const qr = await loadRequest(req, req.params.id);
  const { rows: rounds } = await q('select * from quote_rounds where company_id = $1 and request_id = $2 order by round_no desc', [req.companyId, qr.id]);
  const sel = req.query.round ? rounds.find((x) => x.id === req.query.round) : rounds[0];
  const { rows: comparisons } = await q('select id, number, status, round_id, offer_ids, chosen_offer_id, created_at from comparisons where company_id = $1 and request_id = $2 order by created_at desc', [req.companyId, qr.id]);
  const { rows: proposals } = await q('select id, number, status, offer_id, created_at from proposals where company_id = $1 and request_id = $2 order by created_at desc', [req.companyId, qr.id]);
  res.json({ ...qr, number_label: docNumber(req.settings, 'quote', qr.number), schema: schemaFor(qr.branch),
    rounds: rounds.map(({ risk_data, ...x }) => x), round: sel ? await roundView(req, sel) : null, comparisons, proposals });
});

/** Nova versão/recalcular (8.1-8): nova rodada; resultados tardios da rodada anterior continuam nela (A06). */
r.post('/:id/rounds', need('quotes_manage'), async (req, res) => {
  const qr = await loadRequest(req, req.params.id);
  if (qr.status === 'cancelada') throw conflict('Cotação cancelada.');
  const d = parse(roundSchema, req.body);
  await consentNotRevoked(req, qr.client_id);
  await sensitiveCheck(req, qr.branch, qr.client_id);
  const out = await tx(async (db) => createRound(db, req, qr, d));
  await audit(null, req, { entity: 'quote_request', entityId: qr.id, action: 'quote.round', summary: `Nova rodada ${out.round.round_no}` });
  res.status(202).json(out);
});

r.post('/:id/rounds/:rid/cancel', need('quotes_manage'), async (req, res) => {
  const qr = await loadRequest(req, req.params.id);
  const round = await own('quote_rounds', req.params.rid, req.companyId);
  if (round.request_id !== qr.id) throw notFound();
  const n = await tx(async (db) => {
    // tarefas ainda não iniciadas são canceladas; resultados já recebidos permanecem no histórico
    const { rowCount } = await db.query(`update quote_tasks set status = 'cancelada', reason = 'Rodada cancelada', updated_at = now()
       where company_id = $1 and round_id = $2 and status in ('aguardando','pendente_assistida')`, [req.companyId, round.id]);
    await db.query(`update quote_rounds set status = 'cancelada', cancelled_at = now() where id = $1`, [round.id]);
    return rowCount;
  });
  res.json({ ok: true, cancelled_tasks: n });
});

/**
 * Execução das tarefas automáticas (8.3): retomável (a tela chama de novo enquanto houver pendências), com lease para
 * impedir execução concorrente, consentimento e autorização verificados no momento da execução (A25/A37) e
 * repetição só de falhas transitórias. Resultado de cada tarefa fica preso à sua rodada (A06).
 */
r.post('/:id/rounds/:rid/run', need('quotes_manage'), async (req, res) => {
  const qr = await loadRequest(req, req.params.id);
  const round = await own('quote_rounds', req.params.rid, req.companyId);
  if (round.request_id !== qr.id) throw notFound();
  if (round.status === 'cancelada') return res.json(await roundView(req, round));
  const { rows: tasks } = await q(`update quote_tasks set status = 'executando', lease_until = now() + interval '60 seconds', started_at = coalesce(started_at, now()), attempts = attempts + 1, updated_at = now()
      where id in (select id from quote_tasks where company_id = $1 and round_id = $2 and mode = 'automatica'
                   and (status = 'aguardando' or (status = 'executando' and lease_until < now()) or (status = 'fonte_indisponivel' and attempts < 3)) limit 8 for update skip locked)
      returning *`, [req.companyId, round.id]);
  const consentOk = !(await one(`select 1 from consents where company_id = $1 and client_id = $2 and purpose = 'cotacao' and revoked_at is not null and revoked_at > $3
     and not exists (select 1 from consents c2 where c2.company_id = $1 and c2.client_id = $2 and c2.purpose = 'cotacao' and c2.revoked_at is null and c2.granted_at > consents.revoked_at)`,
  [req.companyId, qr.client_id, round.created_at]));
  await Promise.all(tasks.map(async (t) => {
    const finish = (status, reason = null, extra = {}) => q(`update quote_tasks set status = $3, reason = $4, finished_at = case when $3 = any($5) then now() else finished_at end, lease_until = null, protocol = coalesce($6, protocol), updated_at = now()
        where id = $1 and company_id = $2`, [t.id, req.companyId, status, reason, ['cotacao_valida', 'valor_indicativo', 'recusa_informada', 'analise_subscricao', 'dados_insuficientes', 'incompativel'], extra.protocol || null]);
    if (!consentOk) return finish('autorizacao_expirada', 'Autorização do cliente revogada antes da execução: nenhum dado foi compartilhado');
    const c = await one('select * from provider_connections where id = $1 and company_id = $2', [t.connection_id, req.companyId]);
    const tpl = templateBy(c?.template_code);
    const blockers = c ? await activationBlockers(null, req, c, 'cotacao') : ['conexão removida'];
    if (blockers.length || !hasAutomaticAdapter(tpl) || c.environment !== 'producao') return finish('autorizacao_expirada', `Fonte não autorizada no momento da execução: ${blockers.join('; ') || 'ambiente sem produção'}`);
    const cred = await one('select sealed from credential_versions where company_id = $1 and connection_id = $2 and revoked_at is null order by version desc limit 1', [req.companyId, c.id]);
    if (!cred) return finish('autorizacao_expirada', 'Credencial ausente ou revogada');
    let out;
    try {
      const { unseal } = await import('../secretbox.js');
      out = await Promise.race([
        adapterFor(tpl).quote({ round, task: t, connection: c, credentials: unseal(cred.sealed, `cred:${req.companyId}`) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
      ]);
    } catch (e) {
      // timeout depois do envio: não sabemos o que o fornecedor processou
      return finish(e.message === 'timeout' ? 'tempo_excedido' : 'indeterminado', e.message === 'timeout' ? 'Sem resposta dentro do tempo: pesquisa parcial' : 'Falha técnica: consultar antes de repetir');
    }
    if (!out?.ok) {
      if (out?.code === 'UNSUPPORTED_CAPABILITY') return finish('pendente_assistida', 'Conector não suporta cotação para este produto: consulta assistida');
      return finish(out?.status || 'fonte_indisponivel', out?.reason || 'Falha técnica — não é recusa da seguradora');
    }
    await tx(async (db) => {
      // resultado tardio de rodada cancelada continua preso a ela e não vira oferta ativa em outra rodada
      const { rows: [cur] } = await db.query('select status from quote_rounds where id = $1', [round.id]);
      const o = out.offer;
      await db.query(`insert into quote_offers (company_id, round_id, task_id, institution_id, connection_id, product_name, scenario, origin, quote_kind, external_id, valid_until,
          premium_net_cents, taxes_cents, total_premium_cents, fields_definition, coverages, assistances, payment_options, commission_source, status)
        values ($1,$2,$3,$4,$5,$6,$7,'api',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [req.companyId, round.id, t.id, t.institution_id, c.id, o.product_name, t.scenario, o.quote_kind, o.external_id, o.valid_until || addDays(today(), 7),
        o.premium_net_cents ?? null, o.taxes_cents ?? null, o.total_premium_cents, o.fields_definition || null, JSON.stringify(o.coverages || []),
        JSON.stringify(o.assistances || []), JSON.stringify(o.payment_options || []), o.commission_source || 'nao_informada', cur.status === 'cancelada' ? 'retirada' : 'ativa']);
      await db.query(`update quote_tasks set status = $3, finished_at = now(), lease_until = null, protocol = $4, updated_at = now() where id = $1 and company_id = $2`, [t.id, req.companyId, out.status, o.external_id]);
      await emit(db, req.companyId, 'ProviderQuoteReceived', 'quote_task', t.id, { round: round.id, institution: t.institution_id });
    });
  }));
  await refreshRoundStatus(req.companyId, round.id);
  res.json(await roundView(req, await one('select * from quote_rounds where id = $1', [round.id])));
});

async function refreshRoundStatus(companyId, roundId) {
  const { rows: [s] } = await q(`select count(*) filter (where status = any($3))::int as pending, count(*)::int as total from quote_tasks where company_id = $1 and round_id = $2`, [companyId, roundId, TASK_PENDING]);
  await q(`update quote_rounds set status = case when status = 'cancelada' then status when $3 = 0 then 'concluida' else 'parcial' end where id = $1 and company_id = $2`, [roundId, companyId, s.pending]);
  const r2 = await one('select request_id, status from quote_rounds where id = $1', [roundId]);
  if (r2) await q(`update quote_requests set status = case when status = 'cancelada' then status when $3 = 'concluida' then 'concluida' else 'parcial' end, updated_at = now() where id = $1 and company_id = $2`, [r2.request_id, companyId, r2.status]);
  if (r2?.status === 'concluida') await emit(null, companyId, 'QuoteRoundCompleted', 'quote_round', roundId, null);
}

// ---------------- Tarefas assistidas e ofertas ----------------
const MANUAL_STATUS = ['pendente_assistida', 'analise_subscricao', 'recusa_informada', 'dados_insuficientes', 'fonte_indisponivel', 'tempo_excedido', 'incompativel', 'cancelada'];
r.put('/tasks/:tid', need('quotes_manage'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(MANUAL_STATUS), reason: z.string().max(1000).nullable().optional(), protocol: z.string().max(120).nullable().optional(), assignee_user_id: z.string().uuid().nullable().optional() }), req.body);
  const t = await own('quote_tasks', req.params.tid, req.companyId);
  const round = await own('quote_rounds', t.round_id, req.companyId);
  const qr = await loadRequest(req, round.request_id);
  // recusa só com resposta expressa do fornecedor (motivo e protocolo); falha técnica nunca vira recusa (8.4)
  if (d.status === 'recusa_informada' && (!d.reason || !d.protocol)) throw new HttpError(400, 'Recusa exige o motivo informado pela seguradora e o protocolo da resposta.');
  if (['cotacao_valida', 'valor_indicativo'].includes(t.status) && d.status !== 'cancelada') throw conflict('Tarefa já tem oferta registrada; retire a oferta antes.');
  if (t.mode === 'automatica' && !['analise_subscricao', 'recusa_informada', 'cancelada', 'pendente_assistida'].includes(d.status)) throw conflict('Tarefas automáticas só aceitam registro manual de análise, recusa formal, cancelamento ou passagem para consulta assistida.');
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  const out = await one(`update quote_tasks set status = $3, reason = $4, protocol = coalesce($5, protocol), assignee_user_id = coalesce($6, assignee_user_id),
      mode = case when $3 = 'pendente_assistida' then 'assistida' else mode end, finished_at = case when $3 = any($7) then now() else null end, updated_at = now()
      where id = $1 and company_id = $2 returning *`,
  [t.id, req.companyId, d.status, d.reason || null, d.protocol || null, d.assignee_user_id || null, ['analise_subscricao', 'recusa_informada', 'dados_insuficientes', 'incompativel', 'cancelada']]);
  if (d.status === 'analise_subscricao') {
    await q(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, auto_key, created_by)
       values ($1,$2,'cotacao','alta',now() + interval '2 days',$3,$4,'quote_request',$5,$6,$3) on conflict do nothing`,
    [req.companyId, `Acompanhar análise de subscrição — cotação ${qr.number}`, req.user.id, qr.client_id, qr.id, `subscricao:${t.id}`]);
  }
  await refreshRoundStatus(req.companyId, round.id);
  res.json(out);
});

const coverageOfferSchema = z.object({ code: z.string().max(60), name: z.string().max(160), limit_cents: z.number().int().nonnegative().nullable().optional(),
  deductible_text: z.string().max(300).nullable().optional(), deductible_cents: z.number().int().nonnegative().nullable().optional() });
const paymentOptionSchema = z.object({ id: z.string().max(30).optional(), method: z.string().max(40), installments: z.number().int().min(1).max(24),
  first_cents: z.number().int().positive().nullable().optional(), installment_cents: z.number().int().positive().nullable().optional(), total_cents: z.number().int().positive(), note: z.string().max(200).nullable().optional() });
export const offerSchema = z.object({
  product_name: z.string().trim().min(2).max(200),
  product_id: z.string().uuid().nullable().optional(),
  quote_kind: z.enum(['cotacao_valida', 'valor_indicativo']),
  origin: z.enum(['documento_formal', 'informada_pela_seguradora']),
  external_id: z.string().trim().max(120).nullable().optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  premium_net_cents: z.number().int().nonnegative().nullable().optional(),
  taxes_cents: z.number().int().nonnegative().nullable().optional(),
  fees_cents: z.number().int().nonnegative().nullable().optional(),
  total_premium_cents: z.number().int().positive(),
  fields_definition: z.string().max(500).nullable().optional(),
  coverages: z.array(coverageOfferSchema).max(60).default([]),
  assistances: z.array(z.object({ code: z.string().max(60).optional(), name: z.string().max(160) })).max(30).default([]),
  payment_options: z.array(paymentOptionSchema).max(20).default([]),
  commission_rate: z.number().min(0).max(100).nullable().optional(),
  commission_source: z.enum(['retornada', 'condicao_interna', 'nao_informada']).default('nao_informada'),
  requirements: z.string().max(1000).nullable().optional(),
  conditions: z.string().max(2000).nullable().optional(),
  document_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** Registro de resposta formal na consulta assistida, com origem identificada (8.3-12). */
r.post('/tasks/:tid/offers', need('quotes_manage'), async (req, res) => {
  const d = parse(offerSchema, req.body);
  const t = await own('quote_tasks', req.params.tid, req.companyId);
  const round = await own('quote_rounds', t.round_id, req.companyId);
  await loadRequest(req, round.request_id);
  if (round.status === 'cancelada' || t.status === 'cancelada') throw conflict('Rodada/tarefa cancelada: registre a oferta em uma nova rodada.');
  if (t.mode !== 'assistida' && t.status !== 'pendente_assistida') throw conflict('Tarefa automática: o resultado vem do conector.');
  if (d.quote_kind === 'cotacao_valida') {
    // preço personalizado só é cotação com retorno válido ou cotação formal anexada (6.2)
    if (d.origin === 'documento_formal' && !d.document_id) throw new HttpError(400, 'Anexe a cotação formal da seguradora para registrar como cotação válida.');
    if (d.origin === 'informada_pela_seguradora' && !d.external_id) throw new HttpError(400, 'Informe o número/protocolo da cotação na seguradora.');
    if (!d.valid_until) throw new HttpError(400, 'Informe a validade da cotação.');
  }
  if (d.valid_until && d.valid_until < today(req.settings.timezone)) throw new HttpError(400, 'A cotação já está vencida.');
  if (d.premium_net_cents != null && d.taxes_cents != null && d.fees_cents != null && d.premium_net_cents + d.taxes_cents + d.fees_cents !== d.total_premium_cents) {
    throw new HttpError(400, 'Prêmio líquido + tributos + custos não fecha com o prêmio total informado. Confira os campos da fonte (ou deixe em branco o que não foi informado).');
  }
  for (const p of d.payment_options) {
    if (p.installments > 1 && p.first_cents && p.installment_cents && p.first_cents + p.installment_cents * (p.installments - 1) !== p.total_cents) {
      throw new HttpError(400, `Opção ${p.method} ${p.installments}x: entrada + parcelas não fecha com o total da opção.`);
    }
  }
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id');
  if (d.product_id) await own('products', d.product_id, req.companyId, 'id');
  const opts = d.payment_options.map((p, i) => ({ ...p, id: p.id || `op${i + 1}` }));
  const offer = await tx(async (db) => {
    const { rows: [o] } = await db.query(`insert into quote_offers (company_id, round_id, task_id, institution_id, connection_id, product_name, product_id, scenario, origin, quote_kind, external_id,
        valid_until, premium_net_cents, taxes_cents, fees_cents, total_premium_cents, fields_definition, coverages, assistances, payment_options, commission_rate, commission_source,
        requirements, conditions, document_id, notes, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) returning *`,
    [req.companyId, round.id, t.id, t.institution_id, t.connection_id, d.product_name, d.product_id || null, t.scenario, d.origin, d.quote_kind, d.external_id || null,
      d.valid_until || null, d.premium_net_cents ?? null, d.taxes_cents ?? null, d.fees_cents ?? null, d.total_premium_cents, d.fields_definition || null,
      JSON.stringify(d.coverages), JSON.stringify(d.assistances), JSON.stringify(opts), d.commission_rate ?? null, d.commission_source,
      d.requirements || null, d.conditions || null, d.document_id || null, d.notes || null, req.user.id]);
    await db.query(`update quote_tasks set status = $3, finished_at = now(), protocol = coalesce($4, protocol), updated_at = now() where id = $1 and company_id = $2`,
      [t.id, req.companyId, d.quote_kind, d.external_id || null]);
    await emit(db, req.companyId, 'ProviderQuoteReceived', 'quote_task', t.id, { origin: d.origin, kind: d.quote_kind });
    await audit(db, req, { entity: 'quote_offer', entityId: o.id, action: 'offer.register', summary: `Oferta registrada (${d.origin}): ${d.product_name} — total ${(d.total_premium_cents / 100).toFixed(2)}` });
    return o;
  });
  await refreshRoundStatus(req.companyId, round.id);
  res.status(201).json(presentOffer(req, offer));
});

r.post('/offers/:oid/withdraw', need('quotes_manage'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const o = await own('quote_offers', req.params.oid, req.companyId);
  const out = await one(`update quote_offers set status = 'retirada', notes = coalesce(notes || ' · ', '') || $3 where id = $1 and company_id = $2 returning *`, [o.id, req.companyId, `Retirada: ${d.reason}`]);
  await q(`update quote_tasks set status = 'pendente_assistida', finished_at = null where id = $1 and company_id = $2 and mode = 'assistida'
     and not exists (select 1 from quote_offers x where x.task_id = $1 and x.status = 'ativa')`, [o.task_id, req.companyId]);
  await audit(null, req, { entity: 'quote_offer', entityId: o.id, action: 'offer.withdraw', summary: 'Oferta retirada', reason: d.reason });
  res.json(out);
});

// ---------------- Comparativos ao cliente (9.1) ----------------
export const comparisons = Router();

/** Visão do comparativo para o cliente: sem comissão, credenciais, notas internas ou retorno bruto. */
export function clientComparison({ comparison, offers, company, client, round, settings }) {
  const scored = scoreOffers(offers, round.min_coverages, round.scoring, round.preferences, today(settings?.timezone));
  return {
    number: docNumber(settings, 'comparison', comparison.number), status: comparison.status, created_at: comparison.created_at,
    message: comparison.message, chosen_offer_id: comparison.chosen_offer_id, chosen_payment_option: comparison.chosen_payment_option, chosen_at: comparison.chosen_at,
    broker: { name: company.trade_name || company.name, document: company.document, susep_code: company.susep_code, phone: company.phone, email: company.email },
    client: { name: client.name },
    branch: BRANCHES[round.branch] || null,
    period: { start: round.start_date, end: round.end_date },
    min_coverages: round.min_coverages,
    offers: scored.offers.map((o) => ({
      id: o.id, institution_name: o.institution_name, product_name: o.product_name, quote_kind: o.quote_kind, valid_until: o.valid_until, quoted_at: o.quoted_at,
      external_reference: o.external_id, total_premium_cents: o.total_premium_cents, premium_net_cents: o.premium_net_cents, taxes_cents: o.taxes_cents,
      coverages: o.coverages, assistances: o.assistances, payment_options: o.payment_options, requirements: o.requirements, conditions: o.conditions,
      classification: o.comparison.klass, issues: o.comparison.issues, expired: o.comparison.expired,
    })),
    badges: scored.badges,
    notice: 'Comparativo elaborado pela corretora com base nas cotações recebidas. Não é proposta formal nem garantia de cobertura: a contratação depende da aceitação da seguradora e das condições gerais/especiais do produto.',
  };
}

async function loadComparison(req, id) {
  const c = await one('select * from comparisons where id = $1 and company_id = $2', [idParam(id), req.companyId]);
  if (!c) throw notFound();
  await assertClientVisible(req, 'quotes_view', c.client_id);
  return c;
}
export async function comparisonData(companyId, c) {
  const [{ rows: offers }, round, company, client, request] = await Promise.all([
    q(`select o.*, i.name as institution_name from quote_offers o join institutions i on i.id = o.institution_id where o.company_id = $1 and o.id = any($2)`, [companyId, c.offer_ids]),
    one('select * from quote_rounds where id = $1', [c.round_id]),
    one('select name, trade_name, document, susep_code, phone, email, settings from companies where id = $1', [companyId]),
    one('select id, name, phone, email from clients where id = $1', [c.client_id]),
    one('select branch from quote_requests where id = $1', [c.request_id]),
  ]);
  return { offers, round: { ...round, branch: request.branch }, company, client };
}

comparisons.post('/', need('quotes_manage'), async (req, res) => {
  const d = parse(z.object({ round_id: z.string().uuid(), offer_ids: z.array(z.string().uuid()).min(1).max(8), message: z.string().max(3000).nullable().optional() }), req.body);
  const round = await own('quote_rounds', d.round_id, req.companyId);
  const qr = await loadRequest(req, round.request_id);
  const { rows: offers } = await q('select id, status, valid_until, round_id from quote_offers where company_id = $1 and id = any($2)', [req.companyId, d.offer_ids]);
  if (offers.length !== new Set(d.offer_ids).size || offers.some((o) => o.round_id !== round.id)) throw new HttpError(400, 'Ofertas inválidas para esta rodada.');
  if (offers.some((o) => o.status !== 'ativa')) throw conflict('Há oferta retirada ou vencida na seleção.');
  // cotação vencida não vai ao cliente: recalcular primeiro (A09)
  if (offers.some((o) => o.valid_until && o.valid_until < today(req.settings.timezone))) throw conflict('Há cotação vencida na seleção: faça uma nova rodada antes de enviar.', { code: 'QUOTE_EXPIRED' });
  const c = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'comparison');
    const needApproval = req.settings.approvals.comparisonApproval;
    const { rows: [x] } = await db.query(`insert into comparisons (company_id, number, request_id, round_id, client_id, offer_ids, message, status, approved_by, approved_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [req.companyId, n, qr.id, round.id, qr.client_id, d.offer_ids, d.message || null, needApproval ? 'rascunho' : 'aprovado', needApproval ? null : req.user.id, needApproval ? null : new Date(), req.user.id]);
    if (qr.opportunity_id) await db.query(`update opportunities set stage = 'comparativo', updated_at = now() where id = $1 and stage in ('novo_contato','qualificacao','coleta_dados','cotacao')`, [qr.opportunity_id]);
    await logActivity(db, req, { clientId: qr.client_id, entity: 'comparison', entityId: x.id, summary: `Comparativo ${docNumber(req.settings, 'comparison', n)} preparado com ${d.offer_ids.length} oferta(s)` });
    return x;
  });
  res.status(201).json(c);
});

comparisons.get('/:id', need('quotes_view'), async (req, res) => {
  const c = await loadComparison(req, req.params.id);
  const data = await comparisonData(req.companyId, c);
  const { rows: links } = await q(`select id, purpose, expires_at, revoked_at, created_at, last_access_at, access_count from public_links where company_id = $1 and entity = 'comparison' and entity_id = $2 order by created_at desc`, [req.companyId, c.id]);
  res.json({ ...c, view: clientComparison({ comparison: c, ...data, settings: req.settings }), client_name: data.client?.name, client_phone: data.client?.phone, client_email: data.client?.email, internal_offers: data.offers.map((o) => presentOffer(req, o)), links });
});

comparisons.post('/:id/approve', need('comparisons_send'), async (req, res) => {
  const c = await loadComparison(req, req.params.id);
  if (c.status !== 'rascunho') throw conflict('Comparativo já aprovado.');
  const out = await one(`update comparisons set status = 'aprovado', approved_by = $3, approved_at = now() where id = $1 and company_id = $2 returning *`, [c.id, req.companyId, req.user.id]);
  await audit(null, req, { entity: 'comparison', entityId: c.id, action: 'comparison.approve', summary: `Comparativo ${c.number} aprovado para envio` });
  res.json(out);
});

/** Link temporário, revogável e com finalidade única (23). O token só é exibido agora. */
comparisons.post('/:id/link', need('comparisons_send'), async (req, res) => {
  const c = await loadComparison(req, req.params.id);
  if (!['aprovado', 'enviado'].includes(c.status)) throw conflict(c.status === 'rascunho' ? 'Aprove o comparativo antes de enviar.' : 'Comparativo já concluído.');
  const token = randomToken(24);
  const days = Number(req.settings.quotes.comparisonLinkDays) || 7;
  await tx(async (db) => {
    await db.query(`insert into public_links (company_id, purpose, entity, entity_id, client_id, token_hash, expires_at, created_by) values ($1,'comparativo','comparison',$2,$3,$4, now() + make_interval(days => $5), $6)`,
      [req.companyId, c.id, c.client_id, sha256(token), days, req.user.id]);
    await db.query(`update comparisons set status = 'enviado', sent_at = coalesce(sent_at, now()) where id = $1`, [c.id]);
    await logActivity(db, req, { clientId: c.client_id, entity: 'comparison', entityId: c.id, summary: `Link do comparativo gerado (validade ${days} dias)` });
  });
  res.status(201).json({ token, path: `/p/comparativo/${token}`, expires_days: days });
});

comparisons.post('/:id/links/:lid/revoke', need('comparisons_send'), async (req, res) => {
  const c = await loadComparison(req, req.params.id);
  const r2 = await q(`update public_links set revoked_at = now() where id = $1 and company_id = $2 and entity_id = $3 and revoked_at is null`, [idParam(req.params.lid), req.companyId, c.id]);
  if (!r2.rowCount) throw notFound();
  res.json({ ok: true });
});

/** Escolha do cliente registrada pela equipe (canal e evidência). Manifestação ≠ aceite da seguradora (A11). */
export async function registerChoice(db, companyId, c, { offer_id, payment_option, via, by_name, ip = null, actor = null }) {
  if (!c.offer_ids.includes(offer_id)) throw new HttpError(400, 'Oferta não pertence a este comparativo.');
  if (['escolhido', 'cancelado', 'expirado'].includes(c.status)) throw conflict('Este comparativo já foi concluído.');
  const { rows: [o] } = await db.query('select status, quote_kind, valid_until, payment_options from quote_offers where id = $1 and company_id = $2', [offer_id, companyId]);
  if (o.status !== 'ativa') throw conflict('Esta opção não está mais disponível.');
  const { rows: [co] } = await db.query(`select settings->>'timezone' as tz from companies where id = $1`, [companyId]);
  if (o.quote_kind && o.quote_kind !== 'cotacao_valida') throw conflict('Esta opção é um valor indicativo: a corretora precisa confirmá-la com a seguradora antes da escolha.', { code: 'INDICATIVE_OFFER' });
  if (o.valid_until && o.valid_until < today(co?.tz || undefined)) throw conflict('A cotação desta opção venceu. A corretora vai atualizar os valores.', { code: 'QUOTE_EXPIRED' });
  if (payment_option && !(o.payment_options || []).some((p) => p.id === payment_option)) throw new HttpError(400, 'Forma de pagamento inválida.');
  const { rows: [x] } = await db.query(`update comparisons set status = 'escolhido', chosen_offer_id = $3, chosen_payment_option = $4, chosen_at = now(), chosen_via = $5, chosen_by_name = $6, chosen_ip = $7
     where id = $1 and company_id = $2 returning *`, [c.id, companyId, offer_id, payment_option || null, via, by_name, ip]);
  await db.query(`insert into activities (company_id, client_id, entity, entity_id, kind, summary, created_by, created_by_name) values ($1,$2,'comparison',$3,'sistema',$4,$5,$6)`,
    [companyId, c.client_id, c.id, `Cliente escolheu uma opção do comparativo (${via}) — ainda não é aceite da seguradora`, actor?.id || null, actor?.name || by_name]);
  return x;
}

comparisons.post('/:id/choose', need('quotes_manage'), async (req, res) => {
  const d = parse(z.object({ offer_id: z.string().uuid(), payment_option: z.string().max(30).nullable().optional(), via: z.enum(['presencial', 'telefone', 'whatsapp', 'email']), by_name: z.string().trim().min(2).max(160) }), req.body);
  const c = await loadComparison(req, req.params.id);
  const out = await tx(async (db) => registerChoice(db, req.companyId, c, { ...d, actor: req.user }));
  await audit(null, req, { entity: 'comparison', entityId: c.id, action: 'comparison.choice', summary: `Escolha registrada (${d.via}) por ${d.by_name}` });
  res.json(out);
});

export default r;
