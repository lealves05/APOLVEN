// Catálogo: metadados (ramos, formulários de risco, coberturas), produtos versionados (6.2) e elegibilidade (8.1).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, idParam, BRANCHES, BRANCH_KEYS } from '../util.js';
import { RISK_SCHEMAS, COVERAGE_CATALOG, schemaFor } from '../lib/risk.js';
import { institutionFor, own } from '../lib/common.js';
import { RELATIONS, PURPOSES } from './clients.js';
import { STAGES } from './crm.js';
import { templateBy, hasAutomaticAdapter } from '../lib/connectors.js';
import { TASK_STATUS } from '../lib/compare.js';

const r = Router();

r.get('/meta', (_req, res) => res.json({
  branches: BRANCHES,
  risk_schemas: Object.fromEntries(BRANCH_KEYS.map((b) => [b, schemaFor(b)])),
  coverage_catalog: Object.fromEntries(Object.entries(COVERAGE_CATALOG).map(([b, l]) => [b, l.map(([code, name]) => ({ code, name }))])),
  relations: RELATIONS, purposes: PURPOSES, stages: STAGES, task_status: TASK_STATUS,
}));

r.get('/institutions', async (req, res) => {
  const { rows } = await q(`select id, company_id, code, kind, name, legal_name, cnpj, official_code, assistance_phone, active from institutions
     where (company_id is null or company_id = $1) and active order by name`, [req.companyId]);
  res.json(rows);
});

const coverageItem = z.object({ code: z.string().max(60), name: z.string().max(160), basic: z.boolean().optional(), limit_cents: z.number().int().nonnegative().nullable().optional(), deductible: z.string().max(200).nullable().optional() });
const productSchema = z.object({
  institution_id: z.string().uuid(),
  branch: z.enum(BRANCH_KEYS),
  name: z.string().trim().min(2).max(200),
  provider_code: z.string().max(80).nullable().optional(),
  official_process: z.string().max(80).nullable().optional(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  coverages: z.array(coverageItem).max(80).default([]),
  assistances: z.array(z.object({ code: z.string().max(60).optional(), name: z.string().max(160) })).max(40).default([]),
  payment_terms: z.string().max(1000).nullable().optional(),
  eligibility: z.string().max(2000).nullable().optional(),
  territory: z.string().max(300).nullable().optional(),
  required_documents: z.string().max(1000).nullable().optional(),
  conditions_url: z.string().url().max(500).nullable().optional(),
  source: z.string().trim().min(3, 'informe a origem da informação').max(300),
});

r.get('/products', async (req, res) => {
  const params = [req.companyId];
  let cond = '';
  if (req.query.branch) { params.push(req.query.branch); cond += ` and p.branch = $${params.length}`; }
  if (req.query.institution_id) { params.push(idParam(req.query.institution_id)); cond += ` and p.institution_id = $${params.length}`; }
  const { rows } = await q(`select p.*, i.name as institution_name from products p join institutions i on i.id = p.institution_id where p.company_id = $1${cond} order by i.name, p.name, p.version desc`, params);
  res.json(rows);
});

r.post('/products', need('products'), async (req, res) => {
  const d = parse(productSchema, req.body);
  await institutionFor(null, req.companyId, d.institution_id);
  const p = await one(`insert into products (company_id, institution_id, branch, name, provider_code, official_process, valid_from, valid_to, coverages, assistances,
      payment_terms, eligibility, territory, required_documents, conditions_url, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
  [req.companyId, d.institution_id, d.branch, d.name, d.provider_code || null, d.official_process || null, d.valid_from || null, d.valid_to || null,
    JSON.stringify(d.coverages), JSON.stringify(d.assistances), d.payment_terms || null, d.eligibility || null, d.territory || null, d.required_documents || null, d.conditions_url || null, d.source]);
  await audit(null, req, { entity: 'product', entityId: p.id, action: 'product.create', summary: `Produto ${d.name} cadastrado (rascunho)` });
  res.status(201).json(p);
});

/** Produto validado/ativo não é sobrescrito: a alteração gera nova versão pendente de revisão. */
r.put('/products/:id', need('products'), async (req, res) => {
  const cur = await own('products', req.params.id, req.companyId);
  const d = parse(productSchema.partial(), req.body);
  if (d.institution_id) await institutionFor(null, req.companyId, d.institution_id);
  const merged = { ...cur, ...d };
  const out = await tx(async (db) => {
    if (['validado', 'ativo'].includes(cur.status)) {
      const nextVersion = String((parseInt(cur.version, 10) || 1) + 1);
      const { rows: [x] } = await db.query(`insert into products (company_id, institution_id, branch, name, provider_code, official_process, version, valid_from, valid_to, status, coverages, assistances,
          payment_terms, eligibility, territory, required_documents, conditions_url, source)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendente_revisao',$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
      [req.companyId, merged.institution_id, merged.branch, merged.name, merged.provider_code, merged.official_process, nextVersion, merged.valid_from, merged.valid_to,
        JSON.stringify(merged.coverages), JSON.stringify(merged.assistances), merged.payment_terms, merged.eligibility, merged.territory, merged.required_documents, merged.conditions_url, merged.source]);
      await audit(db, req, { entity: 'product', entityId: x.id, action: 'product.version', summary: `Nova versão ${nextVersion} de ${merged.name} (pendente de revisão)` });
      return x;
    }
    const keys = Object.keys(d);
    const vals = keys.map((k) => (['coverages', 'assistances'].includes(k) ? JSON.stringify(d[k]) : d[k] ?? null));
    const { rows: [x] } = await db.query(`update products set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ') || 'name = name'}, updated_at = now() where id = $1 and company_id = $2 returning *`,
      [cur.id, req.companyId, ...vals]);
    return x;
  });
  res.json(out);
});

r.post('/products/:id/status', need('products'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(['rascunho', 'validado', 'ativo', 'vencido', 'retirado', 'pendente_revisao']) }), req.body);
  const cur = await own('products', req.params.id, req.companyId);
  const p = await one(`update products set status = $3, validated_by = case when $3 in ('validado','ativo') then $4::uuid else validated_by end,
      validated_at = case when $3 in ('validado','ativo') then now() else validated_at end, updated_at = now() where id = $1 and company_id = $2 returning *`,
  [cur.id, req.companyId, d.status, req.user.id]);
  await audit(null, req, { entity: 'product', entityId: p.id, action: 'product.status', summary: `${p.name} v${p.version}: ${cur.status} → ${d.status}` });
  res.json(p);
});

/**
 * Seguradoras elegíveis para um ramo (8.1-5): mostra quem entra (automática ou assistida) e o motivo de quem fica fora
 * (credenciamento, produto não habilitado, integração pausada, capacidade ausente).
 */
export async function eligibility(companyId, branch) {
  const { rows: conns } = await q(`select pc.*, i.name as institution_name, i.cnpj, i.kind as institution_kind,
      exists (select 1 from capability_validations v where v.company_id = pc.company_id and v.connection_id = pc.id and v.capability = 'cotacao' and v.state = 'ativa' and v.environment = 'producao' and pc.environment = 'producao') as auto_active
    from provider_connections pc join institutions i on i.id = pc.institution_id
    where pc.company_id = $1 and pc.revoked_at is null and i.kind <> 'parceiro_tecnologico'`, [companyId]);
  const { rows: prods } = await q(`select p.id, p.name, p.institution_id, i.name as institution_name from products p join institutions i on i.id = p.institution_id
     where p.company_id = $1 and p.branch = $2 and p.status in ('validado','ativo') and (p.valid_to is null or p.valid_to >= current_date)`, [companyId, branch]);
  const eligible = [];
  const excluded = [];
  for (const c of conns) {
    const label = `${c.institution_name}`;
    if (c.products.length && !c.products.includes(branch)) { excluded.push({ institution_id: c.institution_id, institution_name: label, connection_id: c.id, reason: 'Produto/ramo não habilitado nesta conexão' }); continue; }
    if (c.paused) { excluded.push({ institution_id: c.institution_id, institution_name: label, connection_id: c.id, reason: 'Integração pausada' }); continue; }
    if (c.accreditation !== 'sim') { excluded.push({ institution_id: c.institution_id, institution_name: label, connection_id: c.id, reason: 'Credenciamento comercial não confirmado' }); continue; }
    const t = templateBy(c.template_code);
    const auto = c.auto_active && hasAutomaticAdapter(t);
    eligible.push({ institution_id: c.institution_id, institution_name: label, cnpj: c.cnpj, connection_id: c.id, method: c.method, mode: auto ? 'automatica' : 'assistida',
      reason: auto ? 'Cotação automática ativa em produção' : 'Sem cotação automática ativa: consulta assistida',
      products: prods.filter((p) => p.institution_id === c.institution_id).map((p) => ({ id: p.id, name: p.name })) });
  }
  // catálogo sem conexão/credenciamento cadastrado
  for (const p of prods) {
    if (!conns.some((c) => c.institution_id === p.institution_id) && !excluded.some((e) => e.institution_id === p.institution_id && !e.connection_id)) {
      excluded.push({ institution_id: p.institution_id, institution_name: p.institution_name, connection_id: null, reason: 'Sem credenciamento/conexão cadastrada em Seguradoras e Integrações' });
    }
  }
  return { eligible, excluded };
}

r.get('/eligible', need('quotes_view'), async (req, res) => {
  const branch = String(req.query.branch || '');
  if (!BRANCHES[branch]) throw new HttpError(400, 'Ramo inválido.');
  res.json(await eligibility(req.companyId, branch));
});

export default r;
