// Painéis (22.1/22.2), indicadores com denominador explícito (22.3), exportações protegidas (22.4),
// auditoria, eventos de negócio e importações com prévia (19.1).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can, scopeOf } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, today, addDays, toCsv, onlyDigits, validDocument, maskDocument, BRANCHES, BRANCH_KEYS } from '../util.js';
import { institutionFor, portfolioFilter } from '../lib/common.js';
import { RECEIVABLE_AGG, receivableState } from '../lib/finance.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';
import { parseCsv, moneyToCents, parseDate } from '../lib/csv.js';

const r = Router();

r.get('/dashboard', async (req, res) => {
  const ref = today(req.settings.timezone);
  const out = { generated_at: new Date().toISOString() };
  const own = (key) => scopeOf(req, key) === 'own';
  const params = [req.companyId];
  if (can(req, 'quotes_view')) {
    const f = portfolioFilter(req, 'quotes_view', 'c', [req.companyId]);
    const { rows: [x] } = await q(`select
        count(*) filter (where qr.status in ('em_andamento','parcial'))::int as quotes_open,
        (select count(*)::int from quote_tasks t join quote_rounds r on r.id = t.round_id join quote_requests q2 on q2.id = r.request_id join clients c2 on c2.id = q2.client_id
           where t.company_id = $1 and t.status in ('pendente_assistida','aguardando','tempo_excedido','fonte_indisponivel') and r.status <> 'cancelada' ${own('quotes_view') ? 'and c2.owner_user_id = $2' : ''}) as tasks_no_answer,
        (select count(*)::int from proposals p join clients c3 on c3.id = p.client_id where p.company_id = $1 and p.status = 'autorizada_cliente' ${own('quotes_view') ? 'and c3.owner_user_id = $2' : ''}) as authorized_not_sent,
        (select count(*)::int from proposals p join clients c3 on c3.id = p.client_id where p.company_id = $1 and p.status in ('transmitida','recepcionada','em_analise','aceita','documento_recebido') ${own('quotes_view') ? 'and c3.owner_user_id = $2' : ''}) as in_contracting
      from quote_requests qr join clients c on c.id = qr.client_id where qr.company_id = $1 and ${f.sql}`, f.params);
    out.quotes = x;
  }
  if (can(req, 'renewals') || can(req, 'policies_view')) {
    const f = portfolioFilter(req, 'policies_view', 'c', [req.companyId]);
    const { rows: [x] } = await q(`select count(*) filter (where p.contract_state = 'vigente' and p.end_date between current_date and current_date + 30 and not exists (select 1 from policies n where n.previous_policy_id = p.id))::int as renew_30,
        count(*) filter (where p.contract_state = 'vigente' and p.end_date between current_date and current_date + 90 and not exists (select 1 from policies n where n.previous_policy_id = p.id))::int as renew_90,
        count(*) filter (where p.contract_state = 'vigente')::int as active_policies,
        count(*) filter (where p.doc_state in ('aguardando_documento','recebido','divergente'))::int as docs_pending
      from policies p join clients c on c.id = p.client_id where p.company_id = $1 and ${f.sql}`, f.params);
    out.policies = x;
  }
  if (can(req, 'opportunities')) {
    const f = portfolioFilter(req, 'opportunities', 'c', [req.companyId]);
    const { rows: [x] } = await q(`select count(*) filter (where o.stage not in ('ganho','perdido'))::int as open,
        count(*) filter (where o.stage not in ('ganho','perdido') and (o.next_action_at is null))::int as no_next_action
      from opportunities o join clients c on c.id = o.client_id where o.company_id = $1 and ${f.sql}`, f.params);
    out.opportunities = x;
  }
  if (can(req, 'installments')) {
    const { rows } = await q(`select i.*, ${INSTALLMENT_AGG} from premium_installments i join policies p on p.id = i.policy_id join clients c on c.id = p.client_id
       where i.company_id = $1 and i.due_date <= current_date + 30 ${own('policies_view') ? 'and c.owner_user_id = $2' : ''}`, own('policies_view') ? [req.companyId, req.user.id] : params);
    const st = rows.map((x) => installmentState(x, ref, req.settings.installments.upcomingDays));
    out.installments = { overdue: st.filter((x) => x.status === 'vencida').length, overdue_cents: st.filter((x) => x.status === 'vencida').reduce((a, x) => a + x.balance_cents, 0),
      informed: st.filter((x) => x.status === 'pagamento_informado').length, upcoming: st.filter((x) => x.status === 'proxima_vencimento').length };
  }
  if (can(req, 'claims')) {
    const { rows: [x] } = await q(`select count(*) filter (where work_status not in ('encerrado','indenizado','negado'))::int as open,
        count(*) filter (where deadline_at < now() + interval '3 days' and work_status not in ('encerrado','indenizado','negado'))::int as deadline_near from claims where company_id = $1`, params);
    const { rows: [y] } = await q(`select count(*)::int as open from service_requests where company_id = $1 and status not in ('concluida','cancelada')`, params);
    out.claims = { ...x, requests_open: y.open };
  }
  if (can(req, 'commissions_view') && !own('commissions_view')) {
    const { rows } = await q(`select r.*, ${RECEIVABLE_AGG} from commission_receivables r where r.company_id = $1`, params);
    const st = rows.map((x) => receivableState(x, ref));
    out.commissions = {
      projected_cents: st.filter((x) => x.confirmed_cents == null).reduce((a, x) => a + x.expected_cents, 0),
      open_confirmed_cents: st.reduce((a, x) => a + (x.balance_cents > 0 ? x.balance_cents : 0), 0),
      overdue_cents: st.filter((x) => x.status === 'vencida').reduce((a, x) => a + x.balance_cents, 0),
      divergent: st.filter((x) => x.status === 'divergente').length,
      settled_month_cents: (await one(`select coalesce(sum(gross_cents),0)::bigint as v from commission_settlements where company_id = $1 and reversed_at is null and date_trunc('month', settled_date) = date_trunc('month', current_date)`, params)).v,
    };
  }
  if (can(req, 'splits_view') && !own('splits_view')) {
    const { rows: [x] } = await q(`select coalesce(sum(amount_cents) filter (where status = 'liberada' and kind <> 'recuperacao'),0)::bigint as released,
       coalesce(sum(-amount_cents) filter (where status = 'liberada' and kind = 'recuperacao'),0)::bigint as recoverable,
       coalesce(sum(amount_cents) filter (where status = 'paga'),0)::bigint as paid from split_accruals where company_id = $1`, params);
    out.splits = x;
  }
  const { rows: tasks } = await q(`select id, title, due_at, priority, kind, entity, entity_id from tasks where company_id = $1 and status = 'aberta' and (assignee_user_id = $2 or assignee_user_id is null)
     order by due_at nulls last limit 8`, [req.companyId, req.user.id]);
  out.my_tasks = tasks;
  res.json(out);
});

/** Indicadores com definição operacional e denominador explícito (22.3). */
r.get('/indicators', need('reports'), async (req, res) => {
  const from = String(req.query.from || addDays(today(req.settings.timezone), -365));
  const to = String(req.query.to || today(req.settings.timezone));
  const P = [req.companyId, from, to];
  const one2 = async (sql) => (await q(sql, P)).rows[0];
  const opp = await one2(`select count(*) filter (where stage = 'ganho')::int as num, count(*) filter (where stage in ('ganho','perdido'))::int as den from opportunities where company_id = $1 and closed_at::date between $2 and $3`);
  const qconv = await one2(`select count(distinct qr.id) filter (where exists (select 1 from proposals p where p.request_id = qr.id and p.status in ('aceita','documento_recebido','conferida')))::int as num,
       count(distinct qr.id) filter (where exists (select 1 from quote_offers o join quote_rounds rr on rr.id = o.round_id where rr.request_id = qr.id))::int as den
     from quote_requests qr where qr.company_id = $1 and qr.created_at::date between $2 and $3`);
  const ren = await one2(`select count(*) filter (where exists (select 1 from policies n where n.previous_policy_id = p.id))::int as num, count(*)::int as den
     from policies p where p.company_id = $1 and p.end_date between $2 and $3 and p.contract_state <> 'cancelada'`);
  const cov = await one2(`select count(distinct (t.round_id, t.institution_id)) filter (where t.mode = 'automatica' and t.status not in ('aguardando','cancelada'))::int as num, count(distinct (t.round_id, t.institution_id))::int as den
     from quote_tasks t where t.company_id = $1 and t.created_at::date between $2 and $3`);
  const valid = await one2(`select count(*) filter (where status in ('cotacao_valida'))::int as num, count(*) filter (where status not in ('aguardando','cancelada','pendente_assistida'))::int as den,
       count(*) filter (where status = 'analise_subscricao')::int as analysis, count(*) filter (where status = 'recusa_informada')::int as refused from quote_tasks where company_id = $1 and created_at::date between $2 and $3`);
  const recon = await one2(`select count(*) filter (where status = 'conciliada')::int as num, count(*) filter (where status <> 'ignorada')::int as den from statement_lines where company_id = $1 and created_at::date between $2 and $3`);
  const ref = today(req.settings.timezone);
  const { rows: inst } = await q(`select i.*, ${INSTALLMENT_AGG} from premium_installments i where i.company_id = $1 and i.due_date <= $2 and i.status_override is null`, [req.companyId, to]);
  const ist = inst.map((x) => installmentState(x, ref));
  const prem = { num: ist.filter((x) => x.status === 'vencida').reduce((a, x) => a + x.balance_cents, 0), den: ist.reduce((a, x) => a + x.balance_cents, 0) };
  const { rows: recv } = await q(`select r.*, ${RECEIVABLE_AGG} from commission_receivables r where r.company_id = $1 and r.confirmed_cents is not null and r.due_date <= $2`, [req.companyId, to]);
  const rst = recv.map((x) => receivableState(x, ref));
  const late = { num: rst.filter((x) => x.status === 'vencida').reduce((a, x) => a + x.balance_cents, 0), den: rst.reduce((a, x) => a + Math.max(0, x.balance_cents), 0) };
  const prod = await q(`select p.branch, i.name as institution, count(*)::int as policies, sum(p.total_premium_cents)::bigint as premium_cents
     from policies p join institutions i on i.id = p.institution_id where p.company_id = $1 and p.start_date between $2 and $3 group by 1, 2 order by 4 desc`, P);
  const rate = (x) => (x.den ? Math.round((x.num / x.den) * 1000) / 10 : null);
  res.json({
    period: { from, to },
    indicators: [
      { key: 'conv_opp', label: 'Conversão de oportunidades', value: rate(opp), num: opp.num, den: opp.den, definition: 'Oportunidades ganhas / oportunidades encerradas (ganho ou perdido) no período.' },
      { key: 'conv_quote', label: 'Conversão de cotações', value: rate(qconv), num: qconv.num, den: qconv.den, definition: 'Pedidos de cotação com proposta aceita / pedidos com ao menos uma oferta (recálculos não contam como novos).' },
      { key: 'renewal', label: 'Renovação', value: rate(ren), num: ren.num, den: ren.den, definition: 'Contratos renovados / contratos não cancelados com vencimento no período (coorte de vencimento).' },
      { key: 'auto_coverage', label: 'Cobertura automática da pesquisa', value: rate(cov), num: cov.num, den: cov.den, definition: 'Seguradoras elegíveis consultadas automaticamente / seguradoras elegíveis por rodada.' },
      { key: 'valid_return', label: 'Retorno válido', value: rate(valid), num: valid.num, den: valid.den, definition: `Consultas com cotação válida / consultas concluídas (análise: ${valid.analysis}; recusas: ${valid.refused} — contadas à parte).` },
      { key: 'recon_auto', label: 'Conciliação de extratos', value: rate(recon), num: recon.num, den: recon.den, definition: 'Linhas conciliadas / linhas de extrato elegíveis processadas (ignoradas fora).' },
      { key: 'premium_default', label: 'Inadimplência de prêmio', value: rate(prem), num: prem.num, den: prem.den, money: true, definition: 'Saldo vencido confirmado / saldo exigível até a data final (informação da fonte; pagamento informado não conta como pago).' },
      { key: 'commission_late', label: 'Atraso de comissão', value: rate(late), num: late.num, den: late.den, money: true, definition: 'Saldo de comissão confirmada vencida / comissão confirmada exigível.' },
    ],
    production: prod.rows.map((x) => ({ ...x, branch_label: BRANCHES[x.branch] })),
    note: 'Prêmio intermediado (pago às seguradoras) não é receita da corretora. Valores mensais e anuais não são somados sem normalização.',
  });
});

/** Exportações CSV: autorização conferida na geração, fórmulas neutralizadas, documentos mascarados sem permissão. */
r.get('/export/:what', need('data_export'), async (req, res) => {
  const ref = today(req.settings.timezone);
  let rows = [];
  if (req.params.what === 'apolices') {
    rows = (await q(`select p.policy_number, p.branch, i.name as seguradora, c.name as cliente, c.document, p.start_date, p.end_date, p.contract_state, p.doc_state, p.total_premium_cents
      from policies p join institutions i on i.id = p.institution_id join clients c on c.id = p.client_id where p.company_id = $1 order by p.end_date`, [req.companyId])).rows
      .map((x) => ({ apolice: x.policy_number, ramo: BRANCHES[x.branch], seguradora: x.seguradora, cliente: x.cliente, documento: can(req, 'clients_sensitive') ? x.document : maskDocument(x.document),
        inicio: x.start_date, fim: x.end_date, estado_contratual: x.contract_state, estado_documental: x.doc_state, premio_total: (x.total_premium_cents / 100).toFixed(2).replace('.', ',') }));
  } else if (req.params.what === 'parcelas') {
    rows = (await q(`select i.*, ${INSTALLMENT_AGG}, p.policy_number, c.name as cliente from premium_installments i join policies p on p.id = i.policy_id join clients c on c.id = p.client_id where i.company_id = $1 order by i.due_date`, [req.companyId])).rows
      .map((x) => installmentState(x, ref)).map((x) => ({ apolice: x.policy_number, cliente: x.cliente, parcela: x.number, vencimento: x.due_date, valor: (x.due_total_cents / 100).toFixed(2).replace('.', ','),
        saldo: (x.balance_cents / 100).toFixed(2).replace('.', ','), situacao: x.status, origem: x.source, atualizado_em: new Date(x.last_update_at).toISOString() }));
  } else if (req.params.what === 'comissoes') {
    if (!can(req, 'commissions_view') || scopeOf(req, 'commissions_view') !== 'all') throw new HttpError(403, 'Sem permissão para exportar comissões.');
    rows = (await q(`select r.*, ${RECEIVABLE_AGG}, p.policy_number, i.name as seguradora from commission_receivables r join policies p on p.id = r.policy_id join institutions i on i.id = p.institution_id where r.company_id = $1`, [req.companyId])).rows
      .map((x) => receivableState(x, ref)).map((x) => ({ apolice: x.policy_number, seguradora: x.seguradora, parcela: x.installment_no, previsto: (x.expected_cents / 100).toFixed(2).replace('.', ','),
        confirmado: x.confirmed_cents == null ? '' : (x.confirmed_cents / 100).toFixed(2).replace('.', ','), liquidado: (x.allocated_cents / 100).toFixed(2).replace('.', ','), situacao: x.status, vencimento: x.due_date }));
  } else throw new HttpError(404, 'Exportação desconhecida.');
  await audit(null, req, { entity: 'export', action: `export.${req.params.what}`, summary: `Exportação ${req.params.what}: ${rows.length} linha(s)` });
  res.set('Content-Disposition', `attachment; filename="apolven-${req.params.what}-${ref}.csv"`);
  res.type('text/csv').send(`${toCsv(rows)}\n\n"Gerado em ${new Date().toISOString()} por ${req.user.name.replaceAll('"', '')}; dados conforme a última atualização das fontes"`);
});

/** Cópia completa em JSON (sem senhas, segredos, tokens ou arquivos) — disponível mesmo com a assinatura restrita. */
export async function exportAll(req, res) {
  const tables = ['clients', 'client_contacts', 'client_relationships', 'consents', 'opportunities', 'activities', 'tasks', 'quote_requests', 'quote_rounds', 'quote_tasks', 'quote_offers',
    'comparisons', 'proposals', 'customer_authorizations', 'proposal_status_events', 'policies', 'policy_items', 'policy_versions', 'endorsements', 'cancellations',
    'premium_installments', 'premium_payments', 'commission_agreements', 'commission_rule_versions', 'commission_receivables', 'commission_settlements', 'commission_allocations',
    'commission_adjustments', 'partners', 'split_rule_versions', 'policy_splits', 'split_accruals', 'split_payment_batches', 'bank_accounts', 'bank_transactions', 'cash_entries',
    'claims', 'claim_events', 'service_requests', 'products', 'provider_connections', 'integration_requirements', 'capability_validations'];
  const out = { exported_at: new Date().toISOString(), company_id: req.companyId };
  for (const t of tables) {
    const { rows } = await q(`select * from ${t} where company_id = $1`, [req.companyId]);
    out[t] = rows.map((x) => { const { sealed: _s, bank_info: _b, ...rest } = x; return rest; });
  }
  await audit(null, req, { entity: 'export', action: 'export.all', summary: 'Cópia completa dos dados (sem segredos/arquivos)' });
  res.set('Content-Disposition', `attachment; filename="apolven-dados-${today()}.json"`);
  res.json(out);
}
r.get('/export-all', need('data_export'), exportAll);

r.get('/audit', need('audit_view'), async (req, res) => {
  const params = [req.companyId];
  let cond = '';
  if (req.query.entity) { params.push(req.query.entity); cond += ` and entity = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).toLowerCase()}%`); cond += ` and (lower(coalesce(summary,'')) like $${params.length} or lower(coalesce(user_name,'')) like $${params.length})`; }
  const { rows } = await q(`select id, user_name, entity, entity_id, action, summary, reason, data, ip, created_at from audit_log where company_id = $1${cond} order by created_at desc limit 500`, params);
  res.json(rows);
});

r.get('/events', need('audit_view'), async (req, res) => {
  const { rows } = await q('select * from business_events where company_id = $1 order by occurred_at desc limit 300', [req.companyId]);
  res.json(rows);
});

// ---------------- Importações com prévia (19.1) ----------------
/** Clientes: nome; tipo (pf/pj); documento; email; telefone; origem. Duplicidade por documento normalizado. */
function readClients(text) {
  const { rows } = parseCsv(text);
  return rows.map((x) => {
    const doc = onlyDigits(x.documento || x.cpf_cnpj || x.cpf || x.cnpj);
    const kind = (x.tipo || '').toLowerCase().startsWith('j') || doc.length === 14 ? 'pj' : 'pf';
    const errors = [];
    if (!x.nome || x.nome.length < 2) errors.push('nome obrigatório');
    if (doc && !validDocument(doc)) errors.push('CPF/CNPJ inválido');
    return { line: x.__line, name: x.nome, kind, document: doc || null, email: x.email || null, phone: x.telefone || x.celular || null, origin: x.origem || 'importacao', errors };
  });
}
r.post('/imports/clients', need('imports'), async (req, res) => {
  const d = parse(z.object({ content: z.string().max(5_000_000), commit: z.boolean().default(false) }), req.body);
  const list = readClients(d.content);
  const docs = list.filter((x) => x.document).map((x) => x.document);
  const { rows: existing } = await q('select document from clients where company_id = $1 and document = any($2) and merged_into is null', [req.companyId, docs]);
  const seen = new Set();
  for (const x of list) {
    if (x.document && existing.some((e) => e.document === x.document)) x.errors.push('já cadastrado (documento)');
    if (x.document && seen.has(x.document)) x.errors.push('duplicado no arquivo');
    if (x.document) seen.add(x.document);
  }
  const ok = list.filter((x) => !x.errors.length);
  const rejected = list.filter((x) => x.errors.length);
  if (!d.commit) return res.json({ accepted: ok.length, rejected: rejected.map((x) => ({ line: x.line, name: x.name, errors: x.errors })), preview: ok.slice(0, 50) });
  const n = await tx(async (db) => {
    for (const x of ok) {
      await db.query(`insert into clients (company_id, kind, name, document, email, phone, origin, owner_user_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [req.companyId, x.kind, x.name, x.document, x.email, x.phone, x.origin, req.user.id]);
    }
    await audit(db, req, { entity: 'import', action: 'import.clients', summary: `Importação de clientes: ${ok.length} aceito(s), ${rejected.length} rejeitado(s)` });
    return ok.length;
  });
  res.status(201).json({ inserted: n, rejected: rejected.map((x) => ({ line: x.line, name: x.name, errors: x.errors })),
    rejected_csv: toCsv(rejected.map((x) => ({ linha: x.line, nome: x.name, documento: x.document, erros: x.errors.join(', ') }))) });
});

/**
 * Apólices: apolice; documento_cliente; seguradora (nome cadastrado); ramo (código); inicio; fim; premio_total; produto.
 * Correlaciona por número + seguradora + ramo sem duplicar; revisão humana pela prévia.
 */
r.post('/imports/policies', need('imports'), async (req, res) => {
  const d = parse(z.object({ content: z.string().max(5_000_000), commit: z.boolean().default(false) }), req.body);
  const { rows } = parseCsv(d.content);
  const { rows: insts } = await q('select id, name from institutions where company_id is null or company_id = $1', [req.companyId]);
  const list = [];
  for (const x of rows) {
    const errors = [];
    const doc = onlyDigits(x.documento_cliente || x.cpf_cnpj || x.documento);
    const client = doc ? await one('select id from clients where company_id = $1 and document = $2 and merged_into is null', [req.companyId, doc]) : null;
    const inst = insts.find((i) => i.name.toLowerCase() === String(x.seguradora || '').toLowerCase());
    const branch = BRANCH_KEYS.includes(String(x.ramo || '').toLowerCase()) ? String(x.ramo).toLowerCase() : null;
    const premium = moneyToCents(x.premio_total || x.premio);
    const start = parseDate(x.inicio || x.inicio_vigencia);
    const end = parseDate(x.fim || x.fim_vigencia);
    if (!x.apolice) errors.push('número da apólice obrigatório');
    if (!client) errors.push('cliente não encontrado (importe os clientes antes)');
    if (!inst) errors.push('seguradora não cadastrada');
    if (!branch) errors.push('ramo inválido');
    if (!Number.isFinite(premium) || premium < 0) errors.push('prêmio inválido');
    if (!start || !end || end <= start) errors.push('vigência inválida');
    if (!errors.length && await one('select 1 from policies where company_id = $1 and institution_id = $2 and branch = $3 and policy_number = $4', [req.companyId, inst.id, branch, x.apolice])) errors.push('apólice já cadastrada');
    list.push({ line: x.__line, policy_number: x.apolice, client_id: client?.id, institution_id: inst?.id, branch, premium, start, end, product: x.produto || BRANCHES[branch] || 'Produto', errors });
  }
  const ok = list.filter((x) => !x.errors.length);
  const rejected = list.filter((x) => x.errors.length).map((x) => ({ line: x.line, policy_number: x.policy_number, errors: x.errors }));
  if (!d.commit) return res.json({ accepted: ok.length, rejected, preview: ok.slice(0, 50) });
  await tx(async (db) => {
    for (const x of ok) {
      const { rows: [p] } = await db.query(`insert into policies (company_id, client_id, insured_client_id, payer_client_id, institution_id, product_name, branch, policy_number, start_date, end_date,
          total_premium_cents, source, notes, owner_user_id, created_by) values ($1,$2,$2,$2,$3,$4,$5,$6,$7,$8,$9,'importacao','Importado de planilha: conferir com o documento',(select owner_user_id from clients where id = $2),$10) returning id`,
      [req.companyId, x.client_id, x.institution_id, x.product, x.branch, x.policy_number, x.start, x.end, x.premium, req.user.id]);
      await db.query(`insert into policy_versions (company_id, policy_id, version, snapshot, reason, created_by, created_by_name) values ($1,$2,1,'{}'::jsonb,'Importação de planilha',$3,$4)`, [req.companyId, p.id, req.user.id, req.user.name]);
    }
    await audit(db, req, { entity: 'import', action: 'import.policies', summary: `Importação de apólices: ${ok.length} aceita(s), ${rejected.length} rejeitada(s)` });
  });
  res.status(201).json({ inserted: ok.length, rejected });
});

export default r;
