// Propostas (9): comparativo ≠ proposta formal; autorização do cliente, transmissão, recepção, aceitação e emissão
// são fatos distintos com histórico. Transmissão idempotente e sem repetição cega (A10). Divergências bloqueiam conferência (A12).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, hashOf, today, BRANCHES } from '../util.js';
import { nextNumber, own, portfolioFilter, assertClientVisible, logActivity, docNumber } from '../lib/common.js';
import { templateBy, adapterFor, hasAutomaticAdapter } from '../lib/connectors.js';
import { activationBlockers } from './integrations.js';
import { createPolicyFromProposal } from './policies.js';

const r = Router();

export const PROPOSAL_STATUS = {
  rascunho: 'Rascunho', aprovada_internamente: 'Aprovada internamente', autorizada_cliente: 'Autorizada pelo cliente', transmitida: 'Transmitida',
  recepcionada: 'Recepcionada', em_analise: 'Em análise', aceita: 'Aceita', recusada: 'Recusada', retirada: 'Retirada',
  documento_recebido: 'Documento contratual recebido', conferida: 'Conferida',
};
const NEXT = {
  transmitida: ['recepcionada', 'em_analise', 'aceita', 'recusada', 'retirada'],
  recepcionada: ['em_analise', 'aceita', 'recusada', 'retirada'],
  em_analise: ['aceita', 'recusada', 'retirada'],
  aceita: ['documento_recebido', 'retirada'],
  autorizada_cliente: ['retirada'],
  aprovada_internamente: ['retirada'],
  rascunho: ['retirada'],
};

async function loadProposal(req, id, db = null) {
  const run = db ? (t, p) => db.query(t, p) : q;
  const { rows: [p] } = await run(`select p.*, c.name as client_name, i.name as institution_name from proposals p join clients c on c.id = p.client_id
     join institutions i on i.id = p.institution_id where p.id = $1 and p.company_id = $2`, [idParam(id), req.companyId]);
  if (!p) throw notFound();
  await assertClientVisible(req, 'quotes_view', p.client_id);
  return p;
}

async function setStatus(db, req, p, to, { source = 'manual', protocol = null, evidence = null, notes = null, occurredAt = null } = {}) {
  await db.query('update proposals set status = $3, updated_at = now() where id = $1 and company_id = $2', [p.id, req.companyId, to]);
  await db.query(`insert into proposal_status_events (company_id, proposal_id, from_status, to_status, source, protocol, evidence, occurred_at, user_id, user_name, notes)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, now()),$9,$10,$11)`,
  [req.companyId, p.id, p.status, to, source, protocol, evidence, occurredAt, req.user.id, req.user.name, notes]);
}

r.get('/', need('quotes_view'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'quotes_view', 'c', params);
  const where = ['p.company_id = $1', f.sql];
  if (req.query.status) { params.push(req.query.status); where.push(`p.status = $${params.length}`); }
  if (req.query.open === '1') where.push(`p.status not in ('recusada','retirada','conferida')`);
  const { rows } = await q(`select p.id, p.number, p.status, p.branch, p.mode, p.external_protocol, p.created_at, p.updated_at, p.policy_id,
       (p.offer_snapshot->>'total_premium_cents')::bigint as total_premium_cents, p.offer_snapshot->>'product_name' as product_name,
       c.name as client_name, i.name as institution_name
     from proposals p join clients c on c.id = p.client_id join institutions i on i.id = p.institution_id where ${where.join(' and ')} order by p.updated_at desc limit 300`, params);
  res.json(rows.map((x) => ({ ...x, status_label: PROPOSAL_STATUS[x.status] })));
});

/** Proposta a partir da opção escolhida (snapshot exato da oferta e da forma de pagamento). */
r.post('/', need('proposals_manage'), async (req, res) => {
  const d = parse(z.object({ offer_id: z.string().uuid(), comparison_id: z.string().uuid().nullable().optional(), payment_option_id: z.string().max(30).nullable().optional() }), req.body);
  const o = await one(`select o.*, i.name as institution_name, rr.request_id from quote_offers o join institutions i on i.id = o.institution_id
     join quote_rounds rr on rr.id = o.round_id where o.id = $1 and o.company_id = $2`, [d.offer_id, req.companyId]);
  if (!o) throw notFound('Oferta não encontrada.');
  const qr = await one('select * from quote_requests where id = $1', [o.request_id]);
  await assertClientVisible(req, 'quotes_view', qr.client_id);
  if (o.status !== 'ativa') throw conflict('Oferta retirada ou vencida.');
  // 8.4: valor indicativo não serve para contratação — confirme com a seguradora e registre a cotação válida
  if (o.quote_kind !== 'cotacao_valida') throw conflict('Valor indicativo não pode virar proposta: registre a cotação válida confirmada pela seguradora.', { code: 'INDICATIVE_OFFER' });
  if (o.valid_until && o.valid_until < today(req.settings.timezone)) throw conflict('A cotação venceu: recalcule e obtenha nova autorização (A09).', { code: 'QUOTE_EXPIRED' });
  let comparison = null;
  if (d.comparison_id) {
    comparison = await own('comparisons', d.comparison_id, req.companyId);
    if (!comparison.offer_ids.includes(o.id)) throw new HttpError(400, 'A oferta não faz parte deste comparativo.');
  }
  const payId = d.payment_option_id || (comparison?.chosen_offer_id === o.id ? comparison.chosen_payment_option : null);
  const pay = payId ? (o.payment_options || []).find((x) => x.id === payId) : null;
  if (payId && !pay) throw new HttpError(400, 'Forma de pagamento inválida para esta oferta.');
  const { round_id: _r, task_id: _t, created_by: _c, ...snapshot } = o;
  const p = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'proposal');
    const hash = hashOf({ snapshot, pay });
    const { rows: [x] } = await db.query(`insert into proposals (company_id, number, client_id, request_id, comparison_id, offer_id, offer_snapshot, snapshot_hash, payment_option, institution_id, connection_id, branch, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [req.companyId, n, qr.client_id, qr.id, comparison?.id || null, o.id, snapshot, hash, pay, o.institution_id, o.connection_id, qr.branch, req.user.id]);
    await db.query(`insert into proposal_status_events (company_id, proposal_id, to_status, source, user_id, user_name) values ($1,$2,'rascunho','sistema',$3,$4)`, [req.companyId, x.id, req.user.id, req.user.name]);
    // escolha feita pelo próprio cliente no portal, com autorização expressa para esta opção exata
    if (comparison?.chosen_via === 'portal' && comparison.chosen_offer_id === o.id && !req.settings.approvals.internalProposalApproval) {
      await db.query(`insert into customer_authorizations (company_id, proposal_id, offer_id, snapshot_hash, payment_option_id, via, authorized_by_name, evidence, ip, authorized_at)
         values ($1,$2,$3,$4,$5,'portal',$6,$7,$8,$9)`,
      [req.companyId, x.id, o.id, hash, payId, comparison.chosen_by_name, `Escolha e autorização no comparativo ${comparison.number} (link temporário)`, comparison.chosen_ip, comparison.chosen_at]);
      await setStatus(db, req, x, 'autorizada_cliente', { source: 'sistema', notes: 'Autorização registrada pelo cliente no portal' });
      x.status = 'autorizada_cliente';
      await emit(db, req.companyId, 'ProposalAuthorized', 'proposal', x.id, { via: 'portal' });
    }
    await logActivity(db, req, { clientId: qr.client_id, entity: 'proposal', entityId: x.id, summary: `Proposta ${docNumber(req.settings, 'proposal', n)} criada: ${o.institution_name} — ${o.product_name}` });
    if (qr.opportunity_id) await db.query(`update opportunities set stage = 'autorizacao_cliente', updated_at = now() where id = $1 and stage not in ('ganho','perdido','transmissao','acompanhamento')`, [qr.opportunity_id]);
    return x;
  });
  res.status(201).json(p);
});

r.get('/:id', need('quotes_view'), async (req, res) => {
  const p = await loadProposal(req, req.params.id);
  const [events, ops, auths] = await Promise.all([
    q('select * from proposal_status_events where company_id = $1 and proposal_id = $2 order by id', [req.companyId, p.id]),
    q('select * from proposal_operations where company_id = $1 and proposal_id = $2 order by created_at', [req.companyId, p.id]),
    q('select * from customer_authorizations where company_id = $1 and proposal_id = $2 order by authorized_at', [req.companyId, p.id]),
  ]);
  const offer = await one('select status, valid_until from quote_offers where id = $1', [p.offer_id]);
  const snap = { ...p.offer_snapshot };
  if (!req.perms.commissions_view || req.perms.commissions_view === 'none') { snap.commission_rate = null; snap.commission_source = null; }
  res.json({ ...p, offer_snapshot: snap, number_label: docNumber(req.settings, 'proposal', p.number), status_label: PROPOSAL_STATUS[p.status], branch_label: BRANCHES[p.branch],
    offer_current: offer, events: events.rows, operations: ops.rows, authorizations: auths.rows, statuses: PROPOSAL_STATUS, next: NEXT[p.status] || [] });
});

r.post('/:id/approve-internal', need('proposals_approve'), async (req, res) => {
  const p = await loadProposal(req, req.params.id);
  if (p.status !== 'rascunho') throw conflict('Só propostas em rascunho recebem aprovação interna.');
  await tx(async (db) => {
    await setStatus(db, req, p, 'aprovada_internamente', { notes: 'Aprovação interna' });
    await audit(db, req, { entity: 'proposal', entityId: p.id, action: 'proposal.approve', summary: `Proposta ${p.number} aprovada internamente` });
  });
  res.json({ ok: true });
});

/** Autorização do cliente para a opção EXATA (vigência, coberturas, forma de pagamento). */
r.post('/:id/authorizations', need('proposals_manage'), async (req, res) => {
  const d = parse(z.object({
    via: z.enum(['presencial', 'email', 'whatsapp', 'telefone', 'assinatura_eletronica']),
    authorized_by_name: z.string().trim().min(2).max(160), evidence: z.string().trim().min(5, 'descreva a evidência').max(2000),
    evidence_document_id: z.string().uuid().nullable().optional(),
  }), req.body);
  const p = await loadProposal(req, req.params.id);
  const allowed = req.settings.approvals.internalProposalApproval ? ['aprovada_internamente'] : ['rascunho', 'aprovada_internamente'];
  if (!allowed.includes(p.status)) throw conflict(p.status === 'rascunho' ? 'A proposta precisa de aprovação interna antes da autorização do cliente.' : 'A proposta não está aguardando autorização.');
  const offer = await one('select status, valid_until from quote_offers where id = $1', [p.offer_id]);
  if (offer.status !== 'ativa' || (offer.valid_until && offer.valid_until < today(req.settings.timezone))) throw conflict('A cotação desta proposta venceu ou foi retirada: recalcule antes de pedir autorização.', { code: 'QUOTE_EXPIRED' });
  if (d.evidence_document_id) await own('documents', d.evidence_document_id, req.companyId, 'id');
  await tx(async (db) => {
    await db.query(`insert into customer_authorizations (company_id, proposal_id, offer_id, snapshot_hash, payment_option_id, via, authorized_by_name, evidence, evidence_document_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [req.companyId, p.id, p.offer_id, p.snapshot_hash, p.payment_option?.id || null, d.via, d.authorized_by_name, d.evidence, d.evidence_document_id || null, req.user.id]);
    await setStatus(db, req, p, 'autorizada_cliente', { evidence: d.evidence, notes: `Autorização por ${d.via}` });
    await emit(db, req.companyId, 'ProposalAuthorized', 'proposal', p.id, { via: d.via });
    await audit(db, req, { entity: 'proposal', entityId: p.id, action: 'proposal.authorize', summary: `Autorização do cliente registrada (${d.via}, modalidade descrita como informada — não é assinatura qualificada)` });
  });
  res.json({ ok: true });
});

/**
 * Transmissão (9.3): revalida cotação, autorização, consentimento, credenciamento e capacidade. Sem conector com a
 * capacidade "transmissao" ativa, a transmissão é ASSISTIDA: a equipe envia pelo canal oficial e registra o protocolo.
 * Operação com resultado indeterminado bloqueia nova tentativa até consultar o fornecedor (A10).
 */
r.post('/:id/submit', need('proposals_submit'), async (req, res) => {
  const d = parse(z.object({ protocol: z.string().trim().max(120).nullable().optional(), evidence: z.string().trim().max(2000).nullable().optional(), external_proposal_number: z.string().trim().max(120).nullable().optional() }), req.body);
  const key = String(req.headers['idempotency-key'] || '');
  const out = await tx(async (db) => {
    const p = await loadProposal(req, req.params.id, db);
    await db.query('select id from proposals where id = $1 for update', [p.id]);
    const { rows: [pending] } = await db.query(`select * from proposal_operations where company_id = $1 and proposal_id = $2 and kind = 'transmissao' and status in ('indeterminada','enviada')`, [req.companyId, p.id]);
    if (pending) throw conflict('Há uma transmissão com resultado indeterminado. Consulte a seguradora e registre o resultado antes de transmitir de novo.', { code: 'OPERATION_INDETERMINATE', operation_id: pending.id });
    const opKey = `tx:${p.id}:${p.snapshot_hash.slice(0, 16)}`;
    const { rows: [done] } = await db.query(`select * from proposal_operations where company_id = $1 and operation_key = $2`, [req.companyId, opKey]);
    if (done && ['confirmada', 'registrada_manual'].includes(done.status)) {
      if (key && done.detail === key) return { replayed: true, operation: done };
      throw conflict('Esta proposta já foi transmitida.', { code: 'ALREADY_SUBMITTED' });
    }
    if (p.status !== 'autorizada_cliente') throw conflict('Transmissão exige a autorização do cliente para esta versão.', { code: 'NOT_AUTHORIZED' });
    const { rows: [auth] } = await db.query(`select * from customer_authorizations where company_id = $1 and proposal_id = $2 and revoked_at is null order by authorized_at desc limit 1`, [req.companyId, p.id]);
    if (!auth || auth.snapshot_hash !== p.snapshot_hash) throw conflict('Preço/cobertura mudou desde a autorização: obtenha nova autorização.', { code: 'AUTHORIZATION_MISMATCH' });
    const { rows: [offer] } = await db.query('select status, valid_until from quote_offers where id = $1', [p.offer_id]);
    if (offer.status !== 'ativa' || (offer.valid_until && offer.valid_until < today(req.settings.timezone))) throw conflict('A cotação venceu: recalcule e obtenha nova autorização (A09).', { code: 'QUOTE_EXPIRED' });
    const { rows: [revoked] } = await db.query(`select 1 from consents where company_id = $1 and client_id = $2 and purpose = 'cotacao' and revoked_at > $3`, [req.companyId, p.client_id, auth.authorized_at]);
    if (revoked) throw conflict('O cliente revogou a autorização de compartilhamento depois da escolha.', { code: 'CONSENT_REVOKED' });
    // caminho automático só com conector e capacidade de transmissão ativa em produção
    let auto = false;
    if (p.connection_id) {
      const { rows: [c] } = await db.query('select * from provider_connections where id = $1', [p.connection_id]);
      auto = c && c.environment === 'producao' && hasAutomaticAdapter(templateBy(c.template_code)) && !(await activationBlockers(db, req, c, 'transmissao')).length
        && !!(await db.query(`select 1 from capability_validations where connection_id = $1 and capability = 'transmissao' and state = 'ativa'`, [c.id])).rows[0];
      if (auto) {
        const adapter = adapterFor(templateBy(c.template_code));
        const r2 = await adapter.submitProposal({ proposal: p });
        if (r2?.code === 'UNSUPPORTED_CAPABILITY') auto = false;
      }
    }
    if (!auto) {
      if (!d.protocol) throw new HttpError(400, 'Transmissão assistida: envie pelo canal oficial da seguradora e informe o protocolo de envio.', { code: 'ASSISTED_PROTOCOL_REQUIRED' });
    }
    const { rows: [op] } = await db.query(`insert into proposal_operations (company_id, proposal_id, kind, operation_key, status, protocol, detail, created_by)
       values ($1,$2,'transmissao',$3,$4,$5,$6,$7) on conflict (company_id, operation_key) do update set attempts = proposal_operations.attempts + 1, status = excluded.status, protocol = excluded.protocol, updated_at = now() returning *`,
    [req.companyId, p.id, opKey, 'registrada_manual', d.protocol, key || null, req.user.id]);
    await db.query('update proposals set mode = $3, external_protocol = $4, external_proposal_number = coalesce($5, external_proposal_number) where id = $1 and company_id = $2',
      [p.id, req.companyId, auto ? 'automatica' : 'assistida', d.protocol, d.external_proposal_number || null]);
    await setStatus(db, req, p, 'transmitida', { protocol: d.protocol, evidence: d.evidence, notes: auto ? 'Transmissão automática' : 'Transmissão assistida pelo canal oficial' });
    await emit(db, req.companyId, 'ProposalSubmitted', 'proposal', p.id, { mode: auto ? 'automatica' : 'assistida' });
    await audit(db, req, { entity: 'proposal', entityId: p.id, action: 'proposal.submit', summary: `Proposta ${p.number} transmitida (${auto ? 'automática' : 'assistida'}) — protocolo ${d.protocol || '—'}` });
    const { rows: [rq] } = await db.query('select opportunity_id from quote_requests where id = $1', [p.request_id]);
    if (rq?.opportunity_id) await db.query(`update opportunities set stage = 'acompanhamento', updated_at = now() where id = $1 and stage not in ('ganho','perdido')`, [rq.opportunity_id]);
    return { operation: op };
  });
  res.json(out);
});

/** Resultado de operação indeterminada, depois de consultar o fornecedor (A10). */
r.post('/:id/operations/:oid/resolve', need('proposals_submit'), async (req, res) => {
  const d = parse(z.object({ result: z.enum(['confirmada', 'falhou']), protocol: z.string().max(120).nullable().optional(), evidence: z.string().trim().min(5).max(2000) }), req.body);
  const p = await loadProposal(req, req.params.id);
  const op = await one(`update proposal_operations set status = $4, protocol = coalesce($5, protocol), detail = $6, updated_at = now()
     where id = $1 and company_id = $2 and proposal_id = $3 and status in ('indeterminada','enviada') returning *`,
  [idParam(req.params.oid), req.companyId, p.id, d.result, d.protocol || null, d.evidence]);
  if (!op) throw notFound('Operação pendente não encontrada.');
  await audit(null, req, { entity: 'proposal', entityId: p.id, action: 'proposal.operation_resolve', summary: `Operação ${op.kind}: ${d.result} após consulta`, reason: d.evidence });
  res.json(op);
});

/** Andamento informado pela seguradora (recepção, análise, aceite, recusa, retirada). Aceite exige evidência. */
r.post('/:id/status', need('proposals_manage'), async (req, res) => {
  const d = parse(z.object({
    status: z.enum(['recepcionada', 'em_analise', 'aceita', 'recusada', 'retirada']),
    protocol: z.string().max(120).nullable().optional(), evidence: z.string().trim().max(2000).nullable().optional(),
    occurred_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/)).nullable().optional(), source: z.enum(['manual', 'fornecedor']).default('fornecedor'), notes: z.string().max(1000).nullable().optional(),
  }), req.body);
  const p = await loadProposal(req, req.params.id);
  if (!(NEXT[p.status] || []).includes(d.status)) throw conflict(`Não é possível passar de "${PROPOSAL_STATUS[p.status]}" para "${PROPOSAL_STATUS[d.status]}".`);
  if (['aceita', 'recusada'].includes(d.status) && !d.evidence) throw new HttpError(400, 'Registre a evidência (aceite expresso, comunicação da seguradora ou fato documentado).');
  await tx(async (db) => {
    await setStatus(db, req, p, d.status, { source: d.source, protocol: d.protocol || null, evidence: d.evidence || null, notes: d.notes || null, occurredAt: d.occurred_at || null });
    if (d.status === 'aceita') await emit(db, req.companyId, 'ContractAcceptanceRecorded', 'proposal', p.id, { source: d.source }, { occurredAt: d.occurred_at || null });
    if (d.status === 'recepcionada') await emit(db, req.companyId, 'ProposalReceptionConfirmed', 'proposal', p.id, null);
    const { rows: [rq] } = await db.query('select opportunity_id from quote_requests where id = $1', [p.request_id]);
    if (rq?.opportunity_id && ['aceita'].includes(d.status)) await db.query(`update opportunities set stage = 'ganho', closed_at = now(), updated_at = now() where id = $1 and stage <> 'ganho'`, [rq.opportunity_id]);
    if (rq?.opportunity_id && d.status === 'recusada') await db.query(`update opportunities set stage = 'perdido', lost_reason = coalesce(lost_reason, 'Recusa da seguradora'), closed_at = now(), updated_at = now() where id = $1`, [rq.opportunity_id]);
    await logActivity(db, req, { clientId: p.client_id, entity: 'proposal', entityId: p.id, summary: `Proposta ${p.number}: ${PROPOSAL_STATUS[d.status]}` });
  });
  res.json({ ok: true });
});

/**
 * Documento contratual recebido: cria a apólice a partir do documento emitido e compara com a versão autorizada.
 * Divergências (prêmio, vigência, coberturas, franquias, segurado) ficam pendentes antes da conferência (A12).
 */
r.post('/:id/policy', need('policies_manage'), async (req, res) => {
  const p = await loadProposal(req, req.params.id);
  if (p.status !== 'aceita') throw conflict('Registre o aceite da seguradora antes do documento contratual.');
  const out = await tx(async (db) => createPolicyFromProposal(db, req, p, req.body));
  res.status(201).json(out);
});

export default r;
