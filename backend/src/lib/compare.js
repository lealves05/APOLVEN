// Comparação técnica e comercial (8.6 / 8.7). Regras:
//  - primeiro os requisitos indispensáveis do cliente; só depois a pontuação;
//  - ofertas incompatíveis nunca são "melhor adequada" (A08), mesmo sendo as mais baratas;
//  - comissão NUNCA entra na pontuação (2.2-12);
//  - campo não informado fica "não informado" e é excluído da pontuação com aviso — nunca vira zero;
//  - seguradoras contadas por identidade jurídica: a mesma companhia por dois caminhos conta uma vez (A07/A36).
import { today } from '../util.js';

export const TASK_STATUS = {
  aguardando: 'Aguardando', executando: 'Executando', cotacao_valida: 'Cotação válida', valor_indicativo: 'Valor indicativo',
  dados_insuficientes: 'Dados insuficientes', analise_subscricao: 'Análise de subscrição', recusa_informada: 'Recusa informada',
  fonte_indisponivel: 'Fonte indisponível', tempo_excedido: 'Tempo excedido', autorizacao_expirada: 'Autorização expirada',
  indeterminado: 'Resultado indeterminado', incompativel: 'Incompatível', cancelada: 'Cancelada', pendente_assistida: 'Consulta assistida pendente',
};
export const TASK_FINAL = ['cotacao_valida', 'valor_indicativo', 'dados_insuficientes', 'analise_subscricao', 'recusa_informada', 'incompativel', 'cancelada'];
export const TASK_PENDING = ['aguardando', 'executando', 'pendente_assistida', 'fonte_indisponivel', 'tempo_excedido', 'indeterminado', 'autorizacao_expirada'];

export const institutionKey = (i) => (i?.cnpj ? `cnpj:${i.cnpj}` : `id:${i?.id || i}`);

/** Classifica uma oferta contra as coberturas mínimas da rodada. */
export function classifyOffer(offer, minCoverages, ref = today()) {
  const covs = offer.coverages || [];
  const issues = [];
  let requiredMet = 0;
  let requiredTotal = 0;
  let optionalMet = 0;
  let optionalTotal = 0;
  let incompatible = false;
  let partial = false;
  for (const m of minCoverages || []) {
    const c = covs.find((x) => x.code === m.code);
    if (m.required !== false) requiredTotal += 1; else optionalTotal += 1;
    if (!c) {
      if (m.required !== false) { incompatible = true; issues.push(`Não inclui ${m.name || m.code} (exigida pelo cliente)`); }
      else { partial = true; issues.push(`Não inclui ${m.name || m.code} (desejável)`); }
      continue;
    }
    if (m.min_limit_cents != null) {
      if (c.limit_cents == null) { partial = true; issues.push(`${m.name || m.code}: limite não informado pela fonte`); }
      else if (c.limit_cents < m.min_limit_cents) {
        if (m.required !== false) { incompatible = true; issues.push(`${m.name || m.code}: limite ${(c.limit_cents / 100).toFixed(2)} abaixo do mínimo ${(m.min_limit_cents / 100).toFixed(2)}`); }
        else { partial = true; issues.push(`${m.name || m.code}: limite abaixo do desejado`); }
        continue;
      }
    }
    if (m.required !== false) requiredMet += 1; else optionalMet += 1;
  }
  const expired = offer.valid_until && offer.valid_until < ref;
  if (expired) issues.push('Cotação vencida: recalcular antes de propor');
  if (offer.quote_kind === 'valor_indicativo') issues.push('Valor indicativo: confirmar com a seguradora antes da contratação');
  const klass = incompatible ? 'incompativel' : partial ? 'parcial' : 'equivalente';
  return { klass, issues, requiredMet, requiredTotal, optionalMet, optionalTotal, expired: !!expired };
}

/** Pontuação configurável (pesos da rodada), só para ofertas não incompatíveis e não vencidas. */
export function scoreOffers(offers, minCoverages, weights, preferences = {}, ref = today()) {
  const rows = offers.map((o) => ({ ...o, comparison: classifyOffer(o, minCoverages, ref) }));
  const eligible = rows.filter((o) => o.comparison.klass !== 'incompativel' && !o.comparison.expired && o.status === 'ativa');
  const minCost = Math.min(...eligible.map((o) => o.total_premium_cents));
  const wantedAssist = (preferences.assistances || []).map(String);
  for (const o of rows) {
    const unknown = [];
    if (!eligible.includes(o)) { o.score = null; o.score_detail = null; continue; }
    const c = o.comparison;
    const parts = {};
    const totalReq = c.requiredTotal + c.optionalTotal;
    parts.coverage = totalReq ? ((c.requiredMet + c.optionalMet) / totalReq) * 100 : 100;
    parts.cost = (minCost / o.total_premium_cents) * 100;
    // franquias: compara as franquias numéricas das coberturas mínimas; sem número, fica fora com aviso
    const ded = [];
    for (const m of minCoverages || []) {
      const cov = (o.coverages || []).find((x) => x.code === m.code);
      if (!cov) continue;
      if (cov.deductible_cents == null) { unknown.push(`Franquia de ${m.name || m.code}`); continue; }
      const best = Math.min(...eligible.map((x) => (x.coverages || []).find((y) => y.code === m.code)?.deductible_cents).filter((v) => v != null));
      ded.push(cov.deductible_cents === 0 ? 100 : (best / cov.deductible_cents) * 100);
    }
    if (ded.length) parts.deductible = ded.reduce((a, b) => a + b, 0) / ded.length;
    if (wantedAssist.length) {
      const have = (o.assistances || []).map((a) => String(a.code || a.name || a).toLowerCase());
      parts.assistance = (wantedAssist.filter((w) => have.some((h) => h.includes(w.toLowerCase()))).length / wantedAssist.length) * 100;
    }
    let wsum = 0;
    let total = 0;
    for (const [k, w] of Object.entries(weights)) {
      if (parts[k] == null) continue;
      wsum += Number(w);
      total += parts[k] * Number(w);
    }
    o.score = wsum ? Math.round((total / wsum) * 10) / 10 : null;
    o.score_detail = { parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])), weights_used: wsum, unknown };
  }
  // destaques só com evidência suficiente
  const pickBy = (list, fn) => list.reduce((best, x) => (best == null || fn(x) > fn(best) ? x : best), null);
  const equivalents = rows.filter((o) => eligible.includes(o));
  const badges = {};
  if (equivalents.length) {
    badges.lowest_cost = pickBy(equivalents, (o) => -o.total_premium_cents)?.id || null;
    badges.best_fit = pickBy(equivalents, (o) => (o.comparison.requiredMet + o.comparison.optionalMet) * 1e6 + (o.score || 0))?.id || null;
    const protection = (o) => (o.coverages || []).reduce((a, c) => a + (c.limit_cents || 0), 0);
    if (equivalents.every((o) => (o.coverages || []).every((c) => c.limit_cents != null))) badges.highest_protection = pickBy(equivalents, protection)?.id || null;
  }
  return { offers: rows, badges };
}

/** Resumo de abrangência da pesquisa (8.6): contagens separadas e deduplicadas por identidade jurídica. */
export function coverageSummary(tasks, offers, institutions) {
  const byId = Object.fromEntries(institutions.map((i) => [i.id, i]));
  const key = (id) => institutionKey(byId[id] || id);
  const set = (list) => new Set(list.map((t) => key(t.institution_id)));
  const eligible = set(tasks);
  const autoConsulted = set(tasks.filter((t) => t.mode === 'automatica' && !['aguardando', 'cancelada'].includes(t.status)));
  const valid = set(offers.filter((o) => o.quote_kind === 'cotacao_valida' && o.status === 'ativa'));
  const indicative = set(offers.filter((o) => o.quote_kind === 'valor_indicativo' && o.status === 'ativa'));
  const analysis = set(tasks.filter((t) => t.status === 'analise_subscricao'));
  const refused = set(tasks.filter((t) => t.status === 'recusa_informada'));
  const noAnswer = set(tasks.filter((t) => ['aguardando', 'executando', 'fonte_indisponivel', 'tempo_excedido', 'indeterminado'].includes(t.status)));
  const assisted = set(tasks.filter((t) => t.mode === 'assistida' && !['cotacao_valida', 'valor_indicativo', 'recusa_informada', 'analise_subscricao', 'cancelada', 'incompativel'].includes(t.status)));
  const pending = tasks.some((t) => TASK_PENDING.includes(t.status));
  return {
    eligible: eligible.size,
    consulted_automatically: autoConsulted.size,
    valid_quotes: valid.size,
    indicative: indicative.size,
    underwriting: analysis.size,
    refused: refused.size,
    no_answer: noAnswer.size,
    assisted_pending: assisted.size,
    technical_providers: new Set(tasks.map((t) => t.connection_id).filter(Boolean)).size,
    offers: offers.filter((o) => o.status === 'ativa').length,
    scenarios: new Set(tasks.map((t) => t.scenario)).size,
    partial: pending,
    text: `${eligible.size} seguradora(s) elegível(is); ${autoConsulted.size} consultada(s) automaticamente; ${valid.size} com cotação válida`
      + `${indicative.size ? `; ${indicative.size} com valor indicativo` : ''}; ${analysis.size} exige(m) análise; ${noAnswer.size} sem resposta; ${assisted.size} em consulta assistida.`
      + (pending ? ' Comparação parcial.' : ''),
  };
}
