// Rotinas que geram tarefas na Agenda (lembretes da equipe). Idempotentes: cada tarefa tem auto_key única,
// então rodar várias vezes no dia não duplica nada. ctx = { companyId, settings } (settings já com padrões).
import { q } from '../db.js';
import { today, BRANCHES } from '../util.js';
import { INSTALLMENT_AGG, installmentState } from './premium.js';
import { generateRenewalTasks } from '../routes/policies.js';
import { docNumber } from './common.js';

const br = (d) => String(d || '').slice(0, 10).split('-').reverse().join('/');

async function task(ctx, { title, kind, priority = 'normal', dueSql = 'now()', assignee = null, clientId = null, entity = null, entityId = null, key }) {
  const r = await q(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, auto_key)
     values ($1,$2,$3,$4,${dueSql},$5,$6,$7,$8,$9) on conflict do nothing`,
  [ctx.companyId, title, kind, priority, assignee, clientId, entity, entityId, key]);
  return r.rowCount;
}

/** Parcelas do seguro vencidas e ainda sem pagamento confirmado/informado. */
export async function overdueInstallmentTasks(ctx) {
  const ref = today(ctx.settings.timezone);
  const { rows } = await q(`select i.*, ${INSTALLMENT_AGG}, p.client_id, p.policy_number, c.owner_user_id from premium_installments i
       join policies p on p.id = i.policy_id join clients c on c.id = p.client_id
     where i.company_id = $1 and i.due_date < current_date and i.status_override is null and not i.reminders_paused`, [ctx.companyId]);
  let n = 0;
  for (const x of rows.map((y) => installmentState(y, ref)).filter((y) => y.status === 'vencida')) {
    n += await task(ctx, { title: `Parcela ${x.number} vencida — apólice ${x.policy_number || ''}: confirmar situação e orientar o cliente`, kind: 'parcela', priority: 'alta',
      assignee: x.owner_user_id, clientId: x.client_id, entity: 'premium_installment', entityId: x.id, key: `parcela-vencida:${x.id}` });
  }
  return n;
}

/** Ofertas válidas perto de vencer sem proposta. */
export async function expiringQuoteTasks(ctx) {
  const { rows } = await q(`select o.id, o.valid_until, qr.client_id, qr.number, qr.id as request_id, c.owner_user_id from quote_offers o
       join quote_rounds r on r.id = o.round_id join quote_requests qr on qr.id = r.request_id join clients c on c.id = qr.client_id
     where o.company_id = $1 and o.status = 'ativa' and o.valid_until between current_date and current_date + $2::int and qr.status not in ('cancelada')
       and not exists (select 1 from proposals p where p.offer_id = o.id)`, [ctx.companyId, Number(ctx.settings.quotes.expiringDays) || 3]);
  let n = 0;
  for (const o of rows) {
    n += await task(ctx, { title: `Cotação ${docNumber(ctx.settings, 'quote', o.number)} vence em ${br(o.valid_until)}: atualizar antes de propor`, kind: 'cotacao',
      dueSql: `'${o.valid_until}'::date`, assignee: o.owner_user_id, clientId: o.client_id, entity: 'quote_request', entityId: o.request_id, key: `cotacao-vence:${o.id}` });
  }
  return n;
}

/** Consultas assistidas sem resposta da seguradora há mais de N dias. */
export async function pendingAssistedTasks(ctx, days = 1) {
  const { rows } = await q(`select qr.id as request_id, qr.number, qr.client_id, c.owner_user_id, count(*)::int as n, string_agg(distinct i.name, ', ') as names
       from quote_tasks t join quote_rounds r on r.id = t.round_id join quote_requests qr on qr.id = r.request_id
       join clients c on c.id = qr.client_id join institutions i on i.id = t.institution_id
     where t.company_id = $1 and t.status = 'pendente_assistida' and t.created_at < now() - make_interval(days => $2::int) and qr.status not in ('cancelada', 'concluida')
     group by qr.id, qr.number, qr.client_id, c.owner_user_id`, [ctx.companyId, days]);
  let n = 0;
  for (const x of rows) {
    n += await task(ctx, { title: `Cotação ${docNumber(ctx.settings, 'quote', x.number)}: ${x.n} consulta(s) assistida(s) sem resposta (${x.names}) — cobrar a seguradora`, kind: 'cotacao',
      assignee: x.owner_user_id, clientId: x.client_id, entity: 'quote_request', entityId: x.request_id, key: `assistida:${x.request_id}:${today(ctx.settings.timezone)}` });
  }
  return n;
}

/** Comparativos enviados ao cliente e ainda sem escolha. */
export async function pendingComparisonTasks(ctx, days = 2) {
  const { rows } = await q(`select cp.id, cp.number, cp.client_id, c.owner_user_id, c.name from comparisons cp join clients c on c.id = cp.client_id
     where cp.company_id = $1 and cp.status = 'enviado' and cp.chosen_offer_id is null and cp.sent_at < now() - make_interval(days => $2::int)`, [ctx.companyId, days]);
  let n = 0;
  for (const x of rows) {
    n += await task(ctx, { title: `Comparativo ${docNumber(ctx.settings, 'comparison', x.number)} enviado a ${x.name} sem escolha: retomar o contato`, kind: 'cotacao',
      assignee: x.owner_user_id, clientId: x.client_id, entity: 'comparison', entityId: x.id, key: `comparativo-sem-escolha:${x.id}` });
  }
  return n;
}

/** Propostas transmitidas sem retorno da seguradora há mais de N dias. */
export async function stalledProposalTasks(ctx, days = 5) {
  const { rows } = await q(`select p.id, p.number, p.status, p.client_id, c.owner_user_id, i.name as institution from proposals p
       join clients c on c.id = p.client_id join institutions i on i.id = p.institution_id
     where p.company_id = $1 and p.status in ('transmitida', 'recepcionada', 'em_analise') and p.updated_at < now() - make_interval(days => $2::int)`, [ctx.companyId, days]);
  let n = 0;
  for (const x of rows) {
    n += await task(ctx, { title: `Proposta ${docNumber(ctx.settings, 'proposal', x.number)} (${x.institution}) sem retorno há mais de ${days} dia(s): consultar a seguradora`, kind: 'proposta',
      assignee: x.owner_user_id, clientId: x.client_id, entity: 'proposal', entityId: x.id, key: `proposta-parada:${x.id}:${x.status}` });
  }
  return n;
}

/** Apólices com documento recebido ou divergente aguardando conferência. */
export async function documentCheckTasks(ctx) {
  const { rows } = await q(`select p.id, p.policy_number, p.branch, p.doc_state, p.client_id, c.owner_user_id from policies p join clients c on c.id = p.client_id
     where p.company_id = $1 and p.doc_state in ('recebido', 'divergente') and p.contract_state = 'vigente'`, [ctx.companyId]);
  let n = 0;
  for (const x of rows) {
    n += await task(ctx, { title: `Conferir o documento da apólice ${x.policy_number || ''} (${BRANCHES[x.branch] || x.branch})${x.doc_state === 'divergente' ? ' — há divergência' : ''}`,
      kind: 'documento', priority: x.doc_state === 'divergente' ? 'alta' : 'normal', assignee: x.owner_user_id, clientId: x.client_id,
      entity: 'policy', entityId: x.id, key: `conferir:${x.id}:${x.doc_state}` });
  }
  return n;
}

/** Executa os lembretes escolhidos; devolve quantas tarefas novas cada um criou. */
export async function runTeamTasks(ctx, items = {}, stale = {}) {
  const on = (k) => items[k] !== false;
  const out = {};
  if (on('renovacoes')) out.renovacoes = await generateRenewalTasks(ctx);
  if (on('parcelas')) out.parcelas = await overdueInstallmentTasks(ctx);
  if (on('cotacoes')) out.cotacoes = await expiringQuoteTasks(ctx);
  if (on('assistidas')) out.assistidas = await pendingAssistedTasks(ctx, Number(stale.assistidas) || 1);
  if (on('comparativos')) out.comparativos = await pendingComparisonTasks(ctx, Number(stale.comparativos) || 2);
  if (on('propostas')) out.propostas = await stalledProposalTasks(ctx, Number(stale.propostas) || 5);
  if (on('documentos')) out.documentos = await documentCheckTasks(ctx);
  return out;
}
