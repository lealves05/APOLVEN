// Rotinas do agente: avisos automáticos para clientes (modelos aprovados) e lembretes da equipe.
// Nunca envia em duplicidade (agent_dispatches), respeita consentimento, "SAIR", horário e fim de semana,
// e registra cada execução (agent_runs). A prévia lista os destinatários sem enviar nada.
import { q, one } from '../db.js';
import { today, addDays, BRANCHES } from '../util.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';
import { runTeamTasks } from '../lib/automations.js';
import { accessFor } from '../platform.js';
import { CLIENT_ROUTINES, TEAM_TEMPLATE, TEAM_ITEMS, render } from './config.js';
import { toWaId } from './whatsapp.js';
import { loadAgent, canSend, getConversation, deliver, portalLink } from './service.js';

const money = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (d) => String(d || '').slice(0, 10).split('-').reverse().join('/');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const days = (v) => [...new Set((Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 120))];

/** Hora local da corretora e dia da semana. */
function localNow(tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date());
  return { hour: Number(f.find((p) => p.type === 'hour').value), weekday: f.find((p) => p.type === 'weekday').value };
}

const CONSENT_SQL = (alias, purpose) => `exists (select 1 from consents k where k.company_id = ${alias}.company_id and k.client_id = ${alias}.id and k.purpose = '${purpose}' and k.granted and k.revoked_at is null)`;

/** Destinatários de uma rotina para clientes (sem enviar). */
async function targets(agent, key) {
  const def = CLIENT_ROUTINES[key];
  const r = agent.cfg.routines[key];
  const cid = agent.company.id;
  const ref = today(agent.company.settings.timezone);
  const marketingGuard = def.consent === 'marketing' ? 'and not c.marketing_opt_out' : '';
  const base = { corretora: agent.brand };
  const out = [];
  if (key === 'parcela_a_vencer' || key === 'parcela_vencida') {
    for (const d of days(r.days)) {
      const due = key === 'parcela_a_vencer' ? addDays(ref, d) : addDays(ref, -d);
      const { rows } = await q(`select i.*, ${INSTALLMENT_AGG}, p.id as pid, p.policy_number, ins.name as institution, c.id as client_id, c.name, c.phone
           from premium_installments i join policies p on p.id = i.policy_id join institutions ins on ins.id = p.institution_id
           join clients c on c.id = coalesce(i.payer_client_id, p.payer_client_id, p.client_id)
         where i.company_id = $1 and i.due_date = $2 and i.status_override is null and not i.reminders_paused and p.contract_state = 'vigente'
           and c.active and c.merged_into is null and ${CONSENT_SQL('c', def.consent)}`, [cid, due]);
      for (const x of rows.map((y) => installmentState(y, ref))) {
        if (!['aberta', 'proxima_vencimento', 'vencida'].includes(x.status)) continue;
        const vars = { ...base, cliente: firstName(x.name), parcela: `${x.number}/${x.total_count}`, seguradora: x.institution, vencimento: br(x.due_date), valor: money(x.balance_cents), link: '{link}' };
        out.push({ ref: x.id, milestone: `d${d}`, client_id: x.client_id, name: x.name, phone: x.phone, vars, entity: 'premium_installment', entity_id: x.id,
          link: { purpose: 'parcelas', entity: 'policy', entityId: x.pid, days: 15 } });
      }
    }
  } else if (key === 'renovacao') {
    const marks = days(r.days).sort((a, b) => b - a);
    if (marks.length) {
      const { rows } = await q(`select p.id, p.branch, p.end_date, (p.end_date - $2::date) as left, ins.name as institution, c.id as client_id, c.name, c.phone
           from policies p join institutions ins on ins.id = p.institution_id join clients c on c.id = p.client_id
         where p.company_id = $1 and p.contract_state = 'vigente' and p.end_date between $2::date and $2::date + $3::int
           and not exists (select 1 from policies n where n.previous_policy_id = p.id) and c.active and c.merged_into is null and ${CONSENT_SQL('c', def.consent)}`,
      [cid, ref, marks[0]]);
      for (const x of rows) {
        const mark = marks.filter((m) => x.left <= m).pop();
        if (mark == null) continue;
        out.push({ ref: x.id, milestone: `d${mark}`, client_id: x.client_id, name: x.name, phone: x.phone, entity: 'policy', entity_id: x.id,
          vars: { ...base, cliente: firstName(x.name), ramo: BRANCHES[x.branch] || x.branch, seguradora: x.institution, vencimento: br(x.end_date) } });
      }
    }
  } else if (key === 'cotacao_vencendo') {
    const d = Math.max(...days(r.days), 0);
    const { rows } = await q(`select cp.id, cp.client_id, c.name, c.phone, qr.branch, min(o.valid_until) as valid_until
         from comparisons cp join clients c on c.id = cp.client_id join quote_requests qr on qr.id = cp.request_id
         join quote_offers o on o.id = any(cp.offer_ids) and o.status = 'ativa' and o.quote_kind = 'cotacao_valida'
       where cp.company_id = $1 and cp.status = 'enviado' and cp.chosen_offer_id is null and c.active and ${CONSENT_SQL('c', def.consent)}
       group by cp.id, cp.client_id, c.name, c.phone, qr.branch having min(o.valid_until) between $2::date and $2::date + $3::int`, [cid, ref, d]);
    for (const x of rows) {
      out.push({ ref: x.id, milestone: `v${String(x.valid_until).slice(0, 10)}`, client_id: x.client_id, name: x.name, phone: x.phone, entity: 'comparison', entity_id: x.id,
        vars: { ...base, cliente: firstName(x.name), ramo: BRANCHES[x.branch] || x.branch, validade: br(x.valid_until), link: '{link}' },
        link: { purpose: 'comparativo', entity: 'comparison', entityId: x.id, days: Number(agent.company.settings.quotes.comparisonLinkDays) || 7 } });
    }
  } else if (key === 'aniversario') {
    const { rows } = await q(`select c.id as client_id, c.name, c.phone from clients c
       where c.company_id = $1 and c.birth_date is not null and to_char(c.birth_date, 'MM-DD') = to_char($2::date, 'MM-DD')
         and c.active and c.merged_into is null ${marketingGuard} and ${CONSENT_SQL('c', def.consent)}`, [cid, ref]);
    for (const x of rows) {
      out.push({ ref: x.client_id, milestone: ref.slice(0, 4), client_id: x.client_id, name: x.name, phone: x.phone, entity: 'client', entity_id: x.client_id,
        vars: { ...base, cliente: firstName(x.name) } });
    }
  }
  // telefone válido e sem pedido de SAIR
  const result = [];
  for (const t of out) {
    t.wa = toWaId(t.phone);
    if (!t.wa) { result.push({ ...t, skip: 'telefone inválido ou ausente' }); continue; }
    const conv = await one('select opted_out_at, status from wa_conversations where company_id = $1 and phone = $2 and not simulated', [cid, t.wa]);
    if (conv?.opted_out_at) { result.push({ ...t, skip: 'cliente pediu para não receber (SAIR)' }); continue; }
    const sent = await one(`select status from agent_dispatches where company_id = $1 and routine = $2 and ref_id = $3 and milestone = $4`, [cid, key, t.ref, t.milestone]);
    if (sent && (sent.status === 'enviada' || sent.status === 'ignorada')) { result.push({ ...t, skip: 'já enviado' }); continue; }
    result.push(t);
  }
  return result;
}

const maskPhone = (w) => (w ? `+${w.slice(0, 4)} ••••-${w.slice(-4)}` : '—');

/** Prévia: quem receberia hoje e com qual texto. */
export async function previewRoutine(companyId, key) {
  const agent = await loadAgent(companyId);
  const def = CLIENT_ROUTINES[key];
  const list = await targets(agent, key);
  return list.map((t) => ({ client_id: t.client_id, name: t.name, phone: maskPhone(t.wa), milestone: t.milestone, skip: t.skip || null,
    text: render(def.text, { ...t.vars, link: t.link ? '(link temporário gerado no envio)' : '' }) }));
}

async function logRun(agent, routine, trig, res, userId = null) {
  await q(`insert into agent_runs (company_id, routine, trigger, sent, failed, skipped, note, details, user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [agent.company.id, routine, trig, res.sent || 0, res.failed || 0, res.skipped || 0, res.note || null, JSON.stringify((res.details || []).slice(0, 60)), userId]);
}

/** Executa uma rotina para clientes. */
export async function runRoutine(companyId, key, { manual = false, userId = null } = {}) {
  const agent = await loadAgent(companyId);
  const def = CLIENT_ROUTINES[key];
  const r = agent.cfg.routines[key];
  const res = { routine: key, sent: 0, failed: 0, skipped: 0, details: [] };
  const stop = async (note) => { res.note = note; if (manual) await logRun(agent, key, 'manual', res, userId); return res; };
  if (!canSend(agent)) return stop('agente desligado ou WhatsApp não configurado');
  if (!manual && !r.enabled) return { ...res, note: 'rotina desligada' };
  if (!r.template) return stop('sem modelo aprovado informado — cadastre o modelo na Meta e informe o nome');
  const now = localNow(agent.company.settings.timezone);
  if (!manual && now.hour < agent.cfg.sendHour) return { ...res, note: 'antes do horário de envio' };
  if (now.hour < agent.cfg.windowStart || now.hour >= agent.cfg.windowEnd) return stop(`fora do horário permitido (${agent.cfg.windowStart}h às ${agent.cfg.windowEnd}h)`);
  if (!agent.cfg.weekends && ['Sat', 'Sun'].includes(now.weekday)) return stop('fim de semana sem avisos automáticos');
  const list = await targets(agent, key);
  let budget = Math.max(1, Math.min(1000, Number(agent.cfg.maxPerRun) || 150));
  for (const t of list) {
    if (t.skip) { if (t.skip !== 'já enviado') res.skipped += 1; continue; }
    if (budget <= 0) { res.skipped += 1; continue; }
    // reserva o envio: só segue quem conseguiu a reserva (evita duplicidade entre execuções simultâneas)
    const claim = await one(`insert into agent_dispatches (company_id, routine, ref_id, milestone, recipient, status, attempts) values ($1,$2,$3,$4,$5,'pendente',1)
       on conflict (company_id, routine, ref_id, milestone) do update set attempts = agent_dispatches.attempts + 1, status = 'pendente', updated_at = now()
         where agent_dispatches.status = 'falhou' and agent_dispatches.attempts < 3
       returning id`, [agent.company.id, key, t.ref, t.milestone, t.wa]);
    if (!claim) continue;
    budget -= 1;
    const conv = await getConversation(agent.company.id, t.wa, { name: t.name });
    if (t.client_id && !conv.client_id) await q('update wa_conversations set client_id = $2 where id = $1', [conv.id, t.client_id]);
    const vars = { ...t.vars };
    if (t.link) vars.link = await portalLink(agent, { ...t.link, clientId: t.client_id });
    const params = def.params.map((p) => vars[p]);
    const text = render(def.text, vars);
    const out = await deliver(agent, conv, { text, template: { name: r.template, lang: r.template_lang || agent.cfg.templateLang, params } },
      { routine: key, entity: t.entity, entity_id: t.entity_id });
    await q(`update agent_dispatches set status = $2, reason = $3, message_id = $4, updated_at = now() where id = $1`, [claim.id, out.ok ? 'enviada' : 'falhou', out.error || null, out.message_id]);
    if (out.ok) {
      res.sent += 1;
      await q(`insert into activities (company_id, client_id, entity, entity_id, kind, summary, created_by_name) values ($1,$2,$3,$4,'whatsapp',$5,$6)`,
        [agent.company.id, t.client_id, t.entity, t.entity_id, `WhatsApp automático: ${def.label.toLowerCase()}`, agent.name]);
    } else res.failed += 1;
    res.details.push({ name: t.name, ok: out.ok, error: out.error || undefined });
  }
  if (res.sent || res.failed || manual) await logRun(agent, key, manual ? 'manual' : 'agendado', res, userId);
  return res;
}

/** Lembretes da equipe: tarefas na Agenda e, para quem pediu, um resumo diário no WhatsApp. */
export async function runTeam(companyId, { manual = false, userId = null } = {}) {
  const agent = await loadAgent(companyId);
  const t = agent.cfg.team;
  const res = { routine: 'equipe', sent: 0, failed: 0, skipped: 0, details: [], tasks: {} };
  if (!manual && !t.enabled) return { ...res, note: 'lembretes desligados' };
  const now = localNow(agent.company.settings.timezone);
  if (!manual && now.hour < Number(t.hour ?? 8)) return { ...res, note: 'antes do horário dos lembretes' };
  const ctx = { companyId, settings: agent.company.settings };
  if (t.tasks !== false) res.tasks = await runTeamTasks(ctx, t.items, t.staleDays);
  if (t.whatsapp !== false && canSend(agent) && t.template) {
    const ref = today(agent.company.settings.timezone);
    const { rows: users } = await q(`select id, name, phone, role from users where company_id = $1 and active and wa_reminders and phone is not null`, [companyId]);
    const LABEL = { renovacao: ['renovação', 'renovações'], parcela: ['parcela vencida', 'parcelas vencidas'], cotacao: ['cotação', 'cotações'],
      proposta: ['proposta parada', 'propostas paradas'], documento: ['documento a conferir', 'documentos a conferir'], whatsapp: ['conversa no WhatsApp', 'conversas no WhatsApp'] };
    for (const u of users) {
      const wa = toWaId(u.phone);
      if (!wa) { res.skipped += 1; continue; }
      const own = ['owner', 'admin'].includes(u.role) ? 'or assignee_user_id is null' : '';
      const { rows } = await q(`select kind, count(*)::int as n from tasks where company_id = $1 and status = 'aberta' and (assignee_user_id = $2 ${own})
          and (due_at is null or due_at < $3::date + 1) group by kind`, [companyId, u.id, ref]);
      const parts = rows.filter((x) => x.n > 0).map((x) => `${x.n} ${(LABEL[x.kind] || ['tarefa', 'tarefas'])[x.n === 1 ? 0 : 1]}`);
      if (!parts.length) continue;
      const claim = await one(`insert into agent_dispatches (company_id, routine, ref_id, milestone, recipient, status, attempts) values ($1,'equipe',$2,$3,$4,'pendente',1)
         on conflict (company_id, routine, ref_id, milestone) do update set attempts = agent_dispatches.attempts + 1, status = 'pendente', updated_at = now()
           where agent_dispatches.status = 'falhou' and agent_dispatches.attempts < 3 returning id`, [companyId, u.id, ref, wa]);
      if (!claim) continue;
      const conv = await getConversation(companyId, wa, { name: u.name });
      if (!conv.user_id) await q('update wa_conversations set user_id = $2 where id = $1', [conv.id, u.id]);
      const vars = { nome: firstName(u.name), corretora: agent.brand, resumo: parts.join(', ') };
      const out = await deliver(agent, conv, { text: render(TEAM_TEMPLATE.text, vars), template: { name: t.template, lang: agent.cfg.templateLang, params: TEAM_TEMPLATE.params.map((p) => vars[p]) } },
        { routine: 'equipe' });
      await q('update agent_dispatches set status = $2, reason = $3, message_id = $4, updated_at = now() where id = $1', [claim.id, out.ok ? 'enviada' : 'falhou', out.error || null, out.message_id]);
      if (out.ok) res.sent += 1; else res.failed += 1;
      res.details.push({ name: u.name, ok: out.ok, error: out.error || undefined });
    }
  }
  const created = Object.values(res.tasks).reduce((a, b) => a + b, 0);
  res.note = `${created} tarefa(s) nova(s) na Agenda`;
  if (manual || created || res.sent || res.failed) await logRun(agent, 'equipe', manual ? 'manual' : 'agendado', res, userId);
  return res;
}

/** Agendador (de hora em hora): todas as corretoras ativas. Cada rotina decide se é hora e evita duplicidade. */
export async function runAll() {
  const { rows } = await q(`select c.id from companies c where not c.is_demo`);
  const report = [];
  for (const { id } of rows) {
    try {
      const acc = await accessFor(id).catch(() => null);
      if (acc?.blocked) { report.push({ company: id, skipped: 'empresa bloqueada' }); continue; }
      if (acc?.features && acc.features.whatsapp === false) { report.push({ company: id, skipped: 'módulo fora do plano' }); continue; }
      report.push({ company: id, ...(await runTeam(id)) });
      for (const key of Object.keys(CLIENT_ROUTINES)) report.push({ company: id, ...(await runRoutine(id, key)) });
    } catch (e) {
      console.error('[agente] rotina falhou', id, e.message);
      report.push({ company: id, error: 'falhou' });
    }
  }
  return report.map(({ details, ...x }) => x);
}

export { TEAM_ITEMS };
