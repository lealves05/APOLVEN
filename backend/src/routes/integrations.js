// Seguradoras e Integrações (Anexo C): catálogo, "Adicionar empresa", assistente em 5 etapas, checklist dinâmico,
// credenciais protegidas, teste seguro, estados independentes e ativação por capacidade — sempre imposta no servidor.
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, reauth } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, onlyDigits, validDocument, BRANCH_KEYS, BRANCHES, isUuid } from '../util.js';
import { seal, unseal, mask } from '../secretbox.js';
import {
  TEMPLATES, templateBy, publicTemplate, adapterFor, hasAutomaticAdapter, CAPABILITIES, METHODS, ERROR_MESSAGES,
} from '../lib/connectors.js';
import { institutionFor, own } from '../lib/common.js';
import { hit } from '../security.js';
import { validateApiUrl, resolvePublic, safeHeaderName, SafeHttpError } from '../lib/safeHttp.js';
import { CONTRACT, PATHS, AUTH_TYPES, REQUEST_SCHEMA, RESPONSE_SCHEMA, STATUS_SCHEMA, EXAMPLES } from '../lib/quoteApi.js';
import { MAX_RESPONSE } from '../lib/apolvenApiAdapter.js';

const r = Router();
const EVT = async (db, req, connectionId, kind, summary, data = null) => db.query(
  `insert into integration_events (company_id, connection_id, kind, summary, data, user_id, user_name) values ($1,$2,$3,$4,$5,$6,$7)`,
  [req.companyId, connectionId, kind, summary, data ? JSON.stringify(data) : null, req.user.id, req.user.name]);

/**
 * Templates aplicáveis a uma instituição: parceiro tecnológico só se conecta como parceiro de multicálculo;
 * seguradora/operadora aceita os caminhos próprios dela + caminhos genéricos (via parceiro, assistida, arquivo…).
 */
function templatesFor(inst) {
  if (inst.kind === 'parceiro_tecnologico') return TEMPLATES.filter((t) => t.method === 'multicalculo_parceiro');
  return TEMPLATES.filter((t) => (t.institution_code ? t.institution_code === inst.code : true));
}

r.get('/catalog', need('integrations_view'), async (req, res) => {
  const term = String(req.query.q || '').trim().toLowerCase();
  const params = [req.companyId];
  let cond = '';
  if (term) {
    params.push(`%${term}%`);
    cond = ` and (lower(name) like $2 or lower(coalesce(legal_name,'')) like $2 or coalesce(cnpj,'') like $2 or lower(coalesce(brand_group,'')) like $2)`;
  }
  const { rows: insts } = await q(`select * from institutions where (company_id is null or company_id = $1) and active${cond} order by company_id nulls first, name`, params);
  const { rows: conns } = await q(`select institution_id, template_code, count(*)::int as n from provider_connections where company_id = $1 and revoked_at is null group by 1, 2`, [req.companyId]);
  res.json({
    institutions: insts.map((i) => ({
      ...i, scope: i.company_id ? 'corretora' : 'plataforma',
      paths: templatesFor(i).map((t) => ({ ...publicTemplate(t), connections: conns.find((c) => c.institution_id === i.id && c.template_code === t.code)?.n || 0 })),
    })),
    methods: METHODS, capabilities: CAPABILITIES, branches: BRANCHES,
  });
});

r.get('/templates/:code', need('integrations_view'), (req, res) => {
  const t = templateBy(req.params.code);
  if (!t) throw notFound('Template não encontrado.');
  res.json(publicTemplate(t));
});

/** "Cadastrar empresa não encontrada" (C.3): cadastro comercial/assistido — jamais "API conectada". */
r.post('/institutions', need('integrations_manage'), async (req, res) => {
  const d = parse(z.object({
    kind: z.enum(['seguradora', 'operadora', 'administradora', 'previdencia', 'parceiro_tecnologico']),
    name: z.string().trim().min(2).max(160),
    legal_name: z.string().trim().max(200).nullable().optional(),
    cnpj: z.string().trim().nullable().optional(),
    official_code: z.string().trim().max(40).nullable().optional(),
    assistance_phone: z.string().trim().max(40).nullable().optional(),
    contact: z.string().trim().max(300).nullable().optional(),
    branches: z.array(z.enum(BRANCH_KEYS)).max(20).optional(),
  }), req.body);
  let cnpj = null;
  if (d.cnpj) { cnpj = onlyDigits(d.cnpj); if (cnpj.length !== 14 || !validDocument(cnpj)) throw new HttpError(400, 'CNPJ inválido.'); }
  if (cnpj && await one('select 1 from institutions where cnpj = $1 and (company_id is null or company_id = $2)', [cnpj, req.companyId])) {
    throw conflict('Esta instituição já está cadastrada. Pesquise pelo nome ou CNPJ.');
  }
  const i = await one(`insert into institutions (company_id, kind, name, legal_name, cnpj, official_code, assistance_phone, contacts, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
  [req.companyId, d.kind, d.name, d.legal_name || null, cnpj, d.official_code || null, d.assistance_phone || null,
    { oficial: d.contact || null, ramos: d.branches || [] }, 'Cadastrada pela corretora (dados não validados pela plataforma).']);
  await audit(null, req, { entity: 'institution', entityId: i.id, action: 'institution.create', summary: `Empresa cadastrada: ${d.name} (fluxo assistido)` });
  res.status(201).json(i);
});

r.put('/institutions/:id', need('integrations_manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const i = await one('select * from institutions where id = $1 and company_id = $2', [id, req.companyId]);
  if (!i) throw new HttpError(404, 'Só empresas cadastradas pela corretora podem ser editadas aqui.');
  const d = parse(z.object({ name: z.string().trim().min(2).max(160).optional(), legal_name: z.string().max(200).nullable().optional(), assistance_phone: z.string().max(40).nullable().optional(), active: z.boolean().optional() }), req.body);
  const out = await one(`update institutions set name = coalesce($3, name), legal_name = coalesce($4, legal_name), assistance_phone = coalesce($5, assistance_phone), active = coalesce($6, active)
     where id = $1 and company_id = $2 returning *`, [id, req.companyId, d.name ?? null, d.legal_name ?? null, d.assistance_phone ?? null, d.active ?? null]);
  res.json(out);
});

// ---------------- Conexões ----------------
const CONN_LIST = `select pc.*, i.name as institution_name, i.kind as institution_kind, i.cnpj as institution_cnpj, u.name as unit_name,
    (select count(*)::int from integration_requirements x where x.company_id = pc.company_id and x.connection_id = pc.id and x.required and x.status <> 'confirmado') as pending_requirements,
    (select json_agg(json_build_object('capability', v.capability, 'state', v.state, 'environment', v.environment, 'reason', v.reason)) from capability_validations v where v.company_id = pc.company_id and v.connection_id = pc.id) as capabilities,
    (select json_build_object('version', cv.version, 'expires_at', cv.expires_at, 'created_at', cv.created_at) from credential_versions cv where cv.company_id = pc.company_id and cv.connection_id = pc.id and cv.revoked_at is null order by cv.version desc limit 1) as credential
  from provider_connections pc join institutions i on i.id = pc.institution_id left join units u on u.id = pc.unit_id`;

/** Próximo passo em linguagem simples (C.2): nunca reduz tudo a um único sinal verde. */
export function nextStep(c, t) {
  if (c.revoked_at) return 'Integração revogada. Cadastre de novo se precisar voltar a usar.';
  if (c.paused) return `Integração pausada${c.paused_reason ? `: ${c.paused_reason}` : ''}.`;
  if (!t?.adapter || !hasAutomaticAdapter(t)) {
    if (c.accreditation !== 'sim') return 'Seu cadastro foi salvo. Falta confirmar o credenciamento comercial nesta empresa.';
    return 'Sem conector automático disponível: cotações seguem em consulta assistida. Você pode solicitar avaliação de integração.';
  }
  if (c.accreditation !== 'sim') return 'Falta confirmar seu credenciamento para este produto.';
  if (c.pending_requirements > 0) return `Há ${c.pending_requirements} requisito(s) obrigatório(s) pendente(s) no checklist.`;
  if (t.api_config && (!c.api_config || !c.credential)) return 'Configure a API de cotação (endereço, autenticação e credenciais) na etapa 3.';
  if (!c.credential) return 'Cadastre os dados de acesso indicados para continuar.';
  if (c.technical_state === 'erro') return 'O último teste falhou. Confira ambiente, validade e credenciais e teste de novo.';
  if (!c.last_test_at) return 'Execute "Testar conexão".';
  const active = (c.capabilities || []).filter((x) => x.state === 'ativa');
  if (!active.length) return 'Ative as funções liberadas na etapa 5.';
  if (c.environment === 'testes') return 'A conexão está validada somente no ambiente de testes. Obtenha a liberação e valide produção.';
  return `Funções ativas: ${active.map((x) => CAPABILITIES[x.capability]).join(', ')}.`;
}

r.get('/connections', need('integrations_view'), async (req, res) => {
  const { rows } = await q(`${CONN_LIST} where pc.company_id = $1 order by pc.revoked_at nulls first, i.name`, [req.companyId]);
  res.json(rows.map((c) => {
    const t = templateBy(c.template_code);
    return { ...c, template_name: t?.name, method_label: METHODS[c.method], adapter_available: hasAutomaticAdapter(t), next_step: nextStep(c, t) };
  }));
});

const connSchema = z.object({
  institution_id: z.string().uuid(),
  template_code: z.string().max(60),
  unit_id: z.string().uuid().nullable().optional(),
  products: z.array(z.enum(BRANCH_KEYS)).max(20).default([]),
  accreditation: z.enum(['sim', 'em_analise', 'nao']).default('nao'),
  partner_connection_id: z.string().uuid().nullable().optional(),
  environment: z.enum(['testes', 'producao']).default('testes'),
  broker_code: z.string().trim().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** Etapa 1 — cadastro idempotente da conexão (C.5). Duplicação idêntica por clique repetido é recusada. */
r.post('/connections', need('integrations_manage'), async (req, res) => {
  const d = parse(connSchema, req.body);
  const inst = await institutionFor(null, req.companyId, d.institution_id);
  const t = templateBy(d.template_code);
  // A41: o template é validado no servidor; nada do formulário escolhe destino
  if (!t || !templatesFor(inst).includes(t)) throw new HttpError(400, 'Caminho de integração inválido para esta empresa.');
  if (t.status === 'indisponivel') throw conflict('Este caminho está indisponível no momento.', { code: 'CONNECTOR_NOT_AVAILABLE' });
  if (d.unit_id) await own('units', d.unit_id, req.companyId, 'id');
  // via parceiro (C.12): o vínculo da companhia fica preso à conexão com o parceiro; requisitos são os do parceiro
  if (t.method === 'multicalculo_parceiro' && inst.kind !== 'parceiro_tecnologico' && !d.partner_connection_id) {
    throw new HttpError(400, 'Escolha a conexão com o parceiro de multicálculo pelo qual esta companhia será consultada.');
  }
  if (d.partner_connection_id) {
    if (inst.kind === 'parceiro_tecnologico' || t.method !== 'multicalculo_parceiro') throw new HttpError(400, 'Vínculo via parceiro só se aplica a seguradoras pelo caminho de multicálculo.');
    const p = await one(`select pc.method, pc.revoked_at, i.kind from provider_connections pc join institutions i on i.id = pc.institution_id where pc.id = $1 and pc.company_id = $2`, [d.partner_connection_id, req.companyId]);
    if (!p || p.method !== 'multicalculo_parceiro' || p.revoked_at || p.kind !== 'parceiro_tecnologico') throw new HttpError(400, 'Selecione uma conexão ativa com um parceiro de multicálculo.');
  }
  const bad = d.products.filter((p) => t.products.length && !t.products.includes(p));
  if (bad.length) throw new HttpError(400, `Produtos não suportados por este caminho: ${bad.map((p) => BRANCHES[p]).join(', ')}.`);
  const exists = await one(`select id from provider_connections where company_id = $1 and institution_id = $2 and template_code = $3
     and unit_id is not distinct from $4 and environment = $5 and partner_connection_id is not distinct from $6 and revoked_at is null`,
  [req.companyId, inst.id, t.code, d.unit_id || null, d.environment, d.partner_connection_id || null]);
  if (exists) throw conflict('Esta empresa já tem uma conexão por este caminho, unidade e ambiente. Continue a configuração existente.', { code: 'CONNECTION_EXISTS', id: exists.id });
  const c = await tx(async (db) => {
    const auto = hasAutomaticAdapter(t);
    const { rows: [x] } = await db.query(`insert into provider_connections (company_id, institution_id, template_code, template_version, method, unit_id, partner_connection_id,
        products, accreditation, broker_code, environment, technical_state, commercial_state, step, notes, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
    [req.companyId, inst.id, t.code, t.version, t.method, d.unit_id || null, d.partner_connection_id || null, d.products, d.accreditation, d.broker_code || null,
      d.environment, auto ? 'aguardando_credencial' : 'sem_conector', d.accreditation === 'sim' ? 'aprovado' : d.accreditation === 'em_analise' ? 'em_analise' : 'nao_solicitado',
      2, d.notes || null, req.user.id]);
    for (const rq of t.requirements) {
      const status = rq.code === 'credenciamento' && d.accreditation === 'sim' ? 'preenchido' : 'nao_iniciado';
      await db.query(`insert into integration_requirements (company_id, connection_id, code, label, why, provided_by, resolved_by, required, blocks, link, status, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.companyId, x.id, rq.code, rq.label, rq.why, rq.provided_by, rq.resolved_by, rq.required, rq.blocks, rq.link || null, status, req.user.id]);
    }
    for (const cap of t.capabilities) {
      await db.query(`insert into capability_validations (company_id, connection_id, capability, environment, state, reason) values ($1,$2,$3,$4,$5,$6)`,
        [req.companyId, x.id, cap, d.environment, auto ? 'pendente' : 'indisponivel', auto ? 'Aguardando credencial e teste' : ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[0]]);
    }
    await EVT(db, req, x.id, 'criada', `Conexão cadastrada: ${inst.name} — ${t.name}${auto ? '' : ' (sem conector automático: fluxo assistido)'}`);
    await audit(db, req, { entity: 'provider_connection', entityId: x.id, action: 'integration.create', summary: `Adicionar empresa: ${inst.name} via ${t.name}` });
    return x;
  });
  res.status(201).json({ ...c, adapter_available: hasAutomaticAdapter(t),
    message: hasAutomaticAdapter(t) ? null : `${ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[0]} ${ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[1]}.` });
});

async function loadConnection(req, id, db = null) {
  const run = db ? (t2, p) => db.query(t2, p) : q;
  const { rows: [c] } = await run(`${CONN_LIST} where pc.id = $1 and pc.company_id = $2`, [idParam(id), req.companyId]);
  if (!c) throw notFound('Conexão não encontrada.');
  return c;
}

r.get('/connections/:id', need('integrations_view'), async (req, res) => {
  const c = await loadConnection(req, req.params.id);
  const t = templateBy(c.template_code);
  const [reqs, creds, tests, caps, events, company] = await Promise.all([
    q(`select x.*, d.filename as evidence_filename from integration_requirements x left join documents d on d.id = x.evidence_document_id
       where x.company_id = $1 and x.connection_id = $2 order by x.required desc, x.label`, [req.companyId, c.id]),
    // A34: só estado, versão, datas e identificação não secreta
    q(`select id, version, public_info, owner, environment, expires_at, revoked_at, revoked_reason, created_at from credential_versions where company_id = $1 and connection_id = $2 order by version desc`, [req.companyId, c.id]),
    q(`select id, credential_version_id, template_version, environment, status, code, results, duration_ms, correlation_id, created_at from connection_test_runs where company_id = $1 and connection_id = $2 order by created_at desc limit 20`, [req.companyId, c.id]),
    q('select * from capability_validations where company_id = $1 and connection_id = $2 order by capability', [req.companyId, c.id]),
    q('select * from integration_events where company_id = $1 and connection_id = $2 order by created_at desc limit 100', [req.companyId, c.id]),
    one('select name, trade_name, document, susep_code, tech_responsible_name, tech_responsible_document, email, phone, city, uf, segments from companies where id = $1', [req.companyId]),
  ]);
  res.json({ ...c, template: publicTemplate(t), adapter_available: hasAutomaticAdapter(t), next_step: nextStep(c, t), requirements: reqs.rows,
    credentials: creds.rows, tests: tests.rows, capability_list: caps.rows.map((x) => ({ ...x, label: CAPABILITIES[x.capability] })), events: events.rows, company,
    errors: ERROR_MESSAGES });
});

r.patch('/connections/:id', need('integrations_manage'), async (req, res) => {
  const d = parse(z.object({
    version: z.number().int(),
    broker_code: z.string().trim().max(60).nullable().optional(), branch_code: z.string().trim().max(60).nullable().optional(), producer_code: z.string().trim().max(60).nullable().optional(),
    products: z.array(z.enum(BRANCH_KEYS)).max(20).optional(), accreditation: z.enum(['sim', 'em_analise', 'nao']).optional(),
    commercial_state: z.enum(['nao_solicitado', 'em_analise', 'aprovado', 'recusado', 'suspenso', 'vencido']).optional(),
    commercial_evidence: z.string().max(1000).optional(),
    environment: z.enum(['testes', 'producao']).optional(), unit_id: z.string().uuid().nullable().optional(),
    step: z.number().int().min(1).max(5).optional(), notes: z.string().max(2000).nullable().optional(),
  }), req.body);
  const c = await loadConnection(req, req.params.id);
  if (c.revoked_at) throw conflict('Conexão revogada.');
  if (d.commercial_state === 'aprovado' && !d.commercial_evidence) throw new HttpError(400, 'Informe a evidência formal da aprovação comercial (protocolo, e-mail, contrato).');
  if (d.unit_id) await own('units', d.unit_id, req.companyId, 'id');
  const out = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update provider_connections set
        broker_code = coalesce($4, broker_code), branch_code = coalesce($5, branch_code), producer_code = coalesce($6, producer_code),
        products = coalesce($7, products), accreditation = coalesce($8, accreditation), commercial_state = coalesce($9, commercial_state),
        environment = coalesce($10, environment), unit_id = coalesce($11, unit_id), step = coalesce($12, step), notes = coalesce($13, notes),
        version = version + 1, updated_at = now()
      where id = $1 and company_id = $2 and version = $3 returning *`,
    [c.id, req.companyId, d.version, d.broker_code ?? null, d.branch_code ?? null, d.producer_code ?? null, d.products ?? null, d.accreditation ?? null,
      d.commercial_state ?? null, d.environment ?? null, d.unit_id ?? null, d.step ?? null, d.notes ?? null]);
    if (!x) throw conflict('A configuração foi alterada por outra pessoa. Recarregue.', { code: 'VERSION_CONFLICT' });
    // troca de ambiente, código comercial ou unidade invalida testes/validações daquele escopo (C.14) — evidências antigas ficam
    const scopeChanged = (d.environment && d.environment !== c.environment) || (d.broker_code !== undefined && d.broker_code !== c.broker_code) || (d.unit_id && d.unit_id !== c.unit_id);
    if (scopeChanged) {
      await db.query(`update capability_validations set state = case when state = 'indisponivel' then state else 'pendente' end, environment = $3,
          reason = 'Escopo alterado: teste novamente', updated_at = now(), validated_at = null, activated_at = null where company_id = $1 and connection_id = $2`,
      [req.companyId, c.id, x.environment]);
      await db.query(`update provider_connections set technical_state = case when technical_state in ('autenticacao_valida','homologado') then 'nao_configurado' else technical_state end where id = $1`, [c.id]);
    }
    if (d.accreditation === 'sim') await db.query(`update integration_requirements set status = 'preenchido', updated_at = now() where company_id = $1 and connection_id = $2 and code = 'credenciamento' and status = 'nao_iniciado'`, [req.companyId, c.id]);
    await EVT(db, req, c.id, 'configuracao', `Configuração alterada${scopeChanged ? ' — testes e funções do escopo afetado voltaram a pendente' : ''}${d.commercial_state ? ` · comercial: ${d.commercial_state}` : ''}`,
      d.commercial_evidence ? { evidencia_comercial: d.commercial_evidence } : null);
    await audit(db, req, { entity: 'provider_connection', entityId: c.id, action: 'integration.update', summary: `Conexão ${c.institution_name} alterada`, data: d });
    return x;
  });
  res.json(out);
});

r.put('/connections/:id/requirements/:code', need('integrations_manage'), async (req, res) => {
  const d = parse(z.object({
    status: z.enum(['nao_iniciado', 'preenchido', 'enviado', 'aguardando_analise', 'confirmado', 'recusado', 'vencido']),
    protocol: z.string().max(120).nullable().optional(), evidence_document_id: z.string().uuid().nullable().optional(),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), notes: z.string().max(1000).nullable().optional(),
  }), req.body);
  const c = await loadConnection(req, req.params.id);
  if (d.evidence_document_id) await own('documents', d.evidence_document_id, req.companyId, 'id');
  if (d.status === 'confirmado' && !d.evidence_document_id && !d.protocol) throw new HttpError(400, 'Para confirmar, anexe a evidência ou informe o protocolo.');
  const row = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update integration_requirements set status = $4, protocol = coalesce($5, protocol), evidence_document_id = coalesce($6, evidence_document_id),
        valid_until = coalesce($7, valid_until), notes = coalesce($8, notes), updated_by = $9, updated_at = now()
      where company_id = $1 and connection_id = $2 and code = $3 returning *`,
    [req.companyId, c.id, req.params.code, d.status, d.protocol ?? null, d.evidence_document_id ?? null, d.valid_until ?? null, d.notes ?? null, req.user.id]);
    if (!x) throw notFound('Requisito não encontrado.');
    // recusa/vencimento de requisito bloqueia as capacidades que dependem dele, sem apagar aprovações anteriores
    if (['recusado', 'vencido'].includes(d.status) && x.blocks.length) {
      await db.query(`update capability_validations set state = 'bloqueada', reason = $4, updated_at = now() where company_id = $1 and connection_id = $2 and capability = any($3) and state <> 'indisponivel'`,
        [req.companyId, c.id, x.blocks, `Requisito ${x.label}: ${d.status}`]);
    }
    await EVT(db, req, c.id, 'requisito', `${x.label}: ${d.status}${d.protocol ? ` (protocolo ${d.protocol})` : ''}`);
    return x;
  });
  res.json(row);
});

/** "Preparar solicitação de acesso" (C.6): texto revisável, sem senha, token ou chave. Nada é enviado automaticamente. */
r.post('/connections/:id/request-text', need('integrations_manage'), async (req, res) => {
  const c = await loadConnection(req, req.params.id);
  const t = templateBy(c.template_code);
  const co = await one('select name, document, susep_code, tech_responsible_name, email, phone from companies where id = $1', [req.companyId]);
  const pend = (await q(`select label from integration_requirements where company_id = $1 and connection_id = $2 and status <> 'confirmado' and required`, [req.companyId, c.id])).rows.map((x) => `- ${x.label}`);
  const text = `Prezados(as),

A ${co.name}${co.document ? ` (CNPJ ${co.document})` : ''}${co.susep_code ? `, registro SUSEP ${co.susep_code}` : ''}, solicita orientação para ${t.method === 'api_direta' ? 'liberação de acesso à integração por API' : 'credenciamento e acesso'} junto à ${c.institution_name}, para os produtos: ${c.products.map((p) => BRANCHES[p]).join(', ') || 'a definir'}.

Itens que precisamos concluir:
${pend.join('\n') || '- (nenhum pendente)'}

Responsável técnico: ${co.tech_responsible_name || '—'}
Contato: ${co.email || '—'} · ${co.phone || '—'}

Atenciosamente.`;
  await one(`insert into integration_events (company_id, connection_id, kind, summary, user_id, user_name) values ($1,$2,'solicitacao','Texto de solicitação de acesso preparado (não enviado)',$3,$4) returning id`, [req.companyId, c.id, req.user.id, req.user.name]);
  res.json({ text });
});

r.post('/connections/:id/request-evaluation', need('integrations_manage'), async (req, res) => {
  const c = await loadConnection(req, req.params.id);
  await tx(async (db) => {
    await db.query('update provider_connections set evaluation_requested_at = now() where id = $1 and company_id = $2', [c.id, req.companyId]);
    await EVT(db, req, c.id, 'avaliacao', 'Avaliação de integração solicitada à plataforma');
  });
  res.json({ ok: true, message: 'Pedido registrado. Enquanto isso, a empresa segue em consulta assistida.' });
});

/** Etapa 3 — credenciais (C.7): exigem MFA ativo + reautenticação; só campos do template; resposta sem segredo. */
r.put('/connections/:id/credentials', need('credentials_manage'), async (req, res) => {
  const body = parse(z.object({ values: z.record(z.string().max(8000)), owner: z.enum(['corretora', 'filial', 'produtor', 'parceiro']).default('corretora'),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), mfa_code: z.string().optional(), password: z.string().optional() }), req.body);
  const u = await one('select mfa_enabled from users where id = $1', [req.user.id]);
  if (!u.mfa_enabled && !req.isDemo) throw new HttpError(403, 'Ative a verificação em duas etapas para administrar credenciais.', { code: 'MFA_REQUIRED' });
  await reauth(req, { code: body.mfa_code, password: body.password });
  const c = await loadConnection(req, req.params.id);
  if (c.revoked_at) throw conflict('Conexão revogada.');
  const t = templateBy(c.template_code);
  // antes de pedir segredo, o adaptador precisa existir (C.5 / A32)
  if (!hasAutomaticAdapter(t)) throw conflict(ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[0], { code: 'CONNECTOR_NOT_AVAILABLE' });
  const allowed = new Set(t.fields.map((f) => f.key));
  const unknown = Object.keys(body.values).filter((k) => !allowed.has(k));
  if (unknown.length) throw new HttpError(400, 'Campos não previstos para este conector.');
  const missing = t.fields.filter((f) => !String(body.values[f.key] || '').trim());
  if (missing.length) throw new HttpError(400, `${ERROR_MESSAGES.CREDENTIAL_MISSING[0]} (${missing.map((f) => f.label).join(', ')})`, { code: 'CREDENTIAL_MISSING' });
  const publicInfo = Object.fromEntries(t.fields.filter((f) => !f.secret).map((f) => [f.key, mask(body.values[f.key])]));
  const out = await tx(async (db) => {
    await db.query('select id from provider_connections where id = $1 for update', [c.id]);
    const { rows: [v] } = await db.query('select coalesce(max(version),0)+1 as n from credential_versions where company_id = $1 and connection_id = $2', [req.companyId, c.id]);
    // a versão anterior é revogada; tarefas que dependiam dela não executam com a autorização antiga (A37)
    await db.query(`update credential_versions set revoked_at = now(), revoked_reason = 'substituída por nova versão' where company_id = $1 and connection_id = $2 and revoked_at is null`, [req.companyId, c.id]);
    const { rows: [cv] } = await db.query(`insert into credential_versions (company_id, connection_id, version, sealed, public_info, owner, environment, expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, version, public_info, owner, environment, expires_at, created_at`,
    [req.companyId, c.id, v.n, seal(body.values, `cred:${req.companyId}`), publicInfo, body.owner, c.environment, body.expires_at || null, req.user.id]);
    await db.query(`update capability_validations set state = case when state = 'indisponivel' then state else 'pendente' end, reason = 'Nova credencial: teste novamente',
        validated_at = null, activated_at = null, credential_version_id = null, updated_at = now() where company_id = $1 and connection_id = $2`, [req.companyId, c.id]);
    await db.query(`update provider_connections set technical_state = 'nao_configurado', step = greatest(step, 4), updated_at = now(), version = version + 1 where id = $1`, [c.id]);
    await db.query(`update quote_tasks set status = 'autorizacao_expirada', reason = 'Credencial substituída: execute de novo', updated_at = now()
       where company_id = $1 and connection_id = $2 and status = 'aguardando'`, [req.companyId, c.id]);
    await EVT(db, req, c.id, 'credencial', `Credencial versão ${cv.version} cadastrada (${body.owner})`);
    await audit(db, req, { entity: 'provider_connection', entityId: c.id, action: 'integration.credentials', summary: `Credencial v${cv.version} cadastrada (conteúdo não registrado)` });
    return cv;
  });
  res.json(out);
});

// ---------------- API de cotação — padrão APOLVEN ----------------
const RATE_TESTS = 10; // testes de conexão por minuto por corretora

/** Contrato público (JSON Schema e exemplos) para seguradoras, parceiros de multicálculo e middlewares. */
r.get('/api-contract', need('integrations_view'), (req, res) => {
  res.json({
    contract: CONTRACT, paths: PATHS, auth_types: AUTH_TYPES,
    request_schema: REQUEST_SCHEMA, response_schema: RESPONSE_SCHEMA, status_schema: STATUS_SCHEMA, examples: EXAMPLES,
    limits: { timeout_ms_max: 30000, response_max_bytes: MAX_RESPONSE, rate_per_minute: Math.max(1, Number(process.env.APOLVEN_QUOTE_API_RATE) || 120), retries: 2 },
  });
});

/** Confere endereço (https, sem IP/rede interna) — no cadastro também resolve o DNS e confere todos os IPs. */
async function checkApiUrl(value, label) {
  try {
    const v = validateApiUrl(value, { label });
    await resolvePublic(v.host, { local: v.local });
    return v.url.toString().replace(/\/+$/, '');
  } catch (e) {
    if (e instanceof SafeHttpError) throw new HttpError(400, e.message, { code: e.code });
    throw e;
  }
}

const SECRET_KEYS = { bearer: ['token'], api_key: ['api_key'], oauth2_cc: ['client_id', 'client_secret'] };

/**
 * Etapa 3 (API padrão APOLVEN) — endereço, autenticação, tempo e credenciais. Mesmas exigências das credenciais:
 * MFA ativo + reautenticação; segredos cifrados no cofre (nunca voltam ao navegador); auditado sem conteúdo secreto.
 */
r.put('/connections/:id/api-config', need('credentials_manage'), async (req, res) => {
  const body = parse(z.object({
    base_url: z.string().trim().min(8).max(500),
    auth_type: z.enum(['bearer', 'api_key', 'oauth2_cc']),
    header_name: z.string().trim().max(64).nullable().optional(),
    token_url: z.string().trim().max(500).nullable().optional(),
    scope: z.string().trim().max(300).nullable().optional(),
    timeout_ms: z.number().int().min(2000).max(30000).default(15000),
    secrets: z.object({ token: z.string().max(8000).optional(), api_key: z.string().max(8000).optional(), client_id: z.string().max(500).optional(), client_secret: z.string().max(8000).optional() }).strict().default({}),
    keep_secrets: z.boolean().default(false),
    owner: z.enum(['corretora', 'filial', 'produtor', 'parceiro']).default('corretora'),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    mfa_code: z.string().optional(), password: z.string().optional(),
  }), req.body);
  const u = await one('select mfa_enabled from users where id = $1', [req.user.id]);
  if (!u.mfa_enabled && !req.isDemo) throw new HttpError(403, 'Ative a verificação em duas etapas para administrar credenciais.', { code: 'MFA_REQUIRED' });
  await reauth(req, { code: body.mfa_code, password: body.password });
  const c = await loadConnection(req, req.params.id);
  if (c.revoked_at) throw conflict('Conexão revogada.');
  const t = templateBy(c.template_code);
  if (!t?.api_config) throw new HttpError(400, 'Esta conexão não usa API de cotação no padrão APOLVEN.');
  const cfg = { base_url: await checkApiUrl(body.base_url, 'Endereço da API'), auth_type: body.auth_type, timeout_ms: body.timeout_ms, contract: CONTRACT };
  if (body.auth_type === 'api_key') {
    cfg.header_name = safeHeaderName(body.header_name || 'X-API-Key');
    if (!cfg.header_name) throw new HttpError(400, 'Nome do cabeçalho inválido (use letras, números e hífen; cabeçalhos de protocolo não são permitidos).');
  }
  if (body.auth_type === 'oauth2_cc') {
    if (!body.token_url) throw new HttpError(400, 'Informe o endereço do token (OAuth2).');
    cfg.token_url = await checkApiUrl(body.token_url, 'Endereço do token');
    if (body.scope) {
      if (!/^[\x21\x23-\x5B\x5D-\x7E ]{1,300}$/.test(body.scope)) throw new HttpError(400, 'Escopo inválido.');
      cfg.scope = body.scope;
    }
  }
  // segredos: novos, ou mantidos da versão atual quando o tipo de autenticação não mudou
  let secrets = {};
  const need2 = SECRET_KEYS[body.auth_type];
  if (body.keep_secrets && !need2.some((k) => String(body.secrets[k] || '').trim())) {
    const cur = await one('select sealed from credential_versions where company_id = $1 and connection_id = $2 and revoked_at is null order by version desc limit 1', [req.companyId, c.id]);
    const old = cur ? unseal(cur.sealed, `cred:${req.companyId}`) : {};
    if (old.auth_type !== body.auth_type) throw new HttpError(400, 'O tipo de autenticação mudou: informe as novas credenciais.', { code: 'CREDENTIAL_MISSING' });
    secrets = Object.fromEntries(need2.map((k) => [k, old[k]]));
  } else {
    for (const k of need2) secrets[k] = String(body.secrets[k] || '').trim();
  }
  const missing = need2.filter((k) => !secrets[k]);
  if (missing.length) throw new HttpError(400, `${ERROR_MESSAGES.CREDENTIAL_MISSING[0]} (${missing.map((k) => ({ token: 'token', api_key: 'chave de API', client_id: 'client ID', client_secret: 'client secret' })[k]).join(', ')})`, { code: 'CREDENTIAL_MISSING' });
  if (Object.values(secrets).some((v) => /[\r\n]/.test(v))) throw new HttpError(400, 'Credencial com quebra de linha não é aceita.');
  const host = new URL(cfg.base_url).host;
  const publicInfo = { autenticacao: AUTH_TYPES[body.auth_type], servidor: host, ...(secrets.client_id ? { client_id: mask(secrets.client_id) } : {}) };
  const out = await tx(async (db) => {
    await db.query('select id from provider_connections where id = $1 for update', [c.id]);
    const { rows: [v] } = await db.query('select coalesce(max(version),0)+1 as n from credential_versions where company_id = $1 and connection_id = $2', [req.companyId, c.id]);
    await db.query(`update credential_versions set revoked_at = now(), revoked_reason = 'substituída por nova configuração da API' where company_id = $1 and connection_id = $2 and revoked_at is null`, [req.companyId, c.id]);
    const { rows: [cv] } = await db.query(`insert into credential_versions (company_id, connection_id, version, sealed, public_info, owner, environment, expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, version, public_info, owner, environment, expires_at, created_at`,
    [req.companyId, c.id, v.n, seal({ auth_type: body.auth_type, ...secrets }, `cred:${req.companyId}`), publicInfo, body.owner, c.environment, body.expires_at || null, req.user.id]);
    await db.query(`update capability_validations set state = case when state = 'indisponivel' then state else 'pendente' end, reason = 'Configuração da API alterada: teste novamente',
        validated_at = null, activated_at = null, credential_version_id = null, updated_at = now() where company_id = $1 and connection_id = $2`, [req.companyId, c.id]);
    await db.query(`update provider_connections set api_config = $3, technical_state = 'nao_configurado', step = greatest(step, 4), updated_at = now(), version = version + 1 where id = $1 and company_id = $2`,
      [c.id, req.companyId, cfg]);
    await db.query(`update quote_tasks set status = 'autorizacao_expirada', reason = 'Configuração da API alterada: execute de novo', updated_at = now()
       where company_id = $1 and connection_id = $2 and status = 'aguardando'`, [req.companyId, c.id]);
    await EVT(db, req, c.id, 'credencial', `API de cotação configurada: ${host} · ${AUTH_TYPES[body.auth_type]} · tempo máximo ${Math.round(body.timeout_ms / 1000)} s (credencial versão ${cv.version})`);
    await audit(db, req, { entity: 'provider_connection', entityId: c.id, action: 'integration.api_config',
      summary: `API de cotação de ${c.institution_name} configurada (${host}, ${AUTH_TYPES[body.auth_type]}) — conteúdo das credenciais não registrado`,
      data: { servidor: host, autenticacao: body.auth_type, tempo_ms: body.timeout_ms } });
    return cv;
  });
  res.json({ api_config: cfg, credential: out });
});

/** Etapa 4 — Testar conexão (C.8): somente operações seguras; nunca transmite, cobra, cancela ou abre sinistro (A40). */
r.post('/connections/:id/connection-tests', need('integrations_manage'), async (req, res) => {
  const c = await loadConnection(req, req.params.id);
  const t = templateBy(c.template_code);
  const correlation = crypto.randomUUID();
  if (t?.api_config) {
    const lim = await hit(`apitest:${req.companyId}`, RATE_TESTS, 60);
    if (lim.blocked) throw new HttpError(429, `Muitos testes de conexão seguidos. Aguarde ${lim.retryAfter} s.`, { code: 'RATE_LIMITED' });
  }
  const started = Date.now();
  const reqs = (await q('select * from integration_requirements where company_id = $1 and connection_id = $2', [req.companyId, c.id])).rows;
  const results = {
    cadastro: reqs.every((x) => !x.required || x.status === 'confirmado') ? 'confirmado' : reqs.some((x) => x.status === 'vencido') ? 'vencido' : 'pendente',
    autenticacao: 'nao_verificada', vinculo: 'nao_consultavel', ambiente: c.environment, capacidades: {}, limitacoes: [],
  };
  let code = null;
  let status = 'concluido';
  const adapter = adapterFor(t);
  let out = null;
  const cred = await one(`select id, sealed, version from credential_versions where company_id = $1 and connection_id = $2 and revoked_at is null order by version desc limit 1`, [req.companyId, c.id]);
  if (!hasAutomaticAdapter(t)) {
    code = 'CONNECTOR_NOT_AVAILABLE';
    results.limitacoes.push(ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[0]);
  } else if (!cred) {
    code = 'CREDENTIAL_MISSING';
  } else {
    try {
      out = await Promise.race([
        adapter.testConnection({ credentials: unseal(cred.sealed, `cred:${req.companyId}`), connection: c, environment: c.environment }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), Math.max(15000, (Number(c.api_config?.timeout_ms) || 0) + 8000))),
      ]);
    } catch { out = { auth: 'indisponivel', code: 'PROVIDER_TEMPORARILY_UNAVAILABLE' }; }
    results.autenticacao = out.auth || 'nao_verificada';
    code = out.code || null;
    if (out.detail) results.limitacoes.push(out.detail);
    if (out.exchange) results.http = { status: out.exchange.http_status ?? null, duracao_ms: out.exchange.duration_ms ?? null };
    if (out.auth === 'valida') {
      if (out.broker_code == null) results.vinculo = 'nao_consultavel';
      else if (c.broker_code && out.broker_code !== c.broker_code) { results.vinculo = 'divergente'; code = 'BROKER_IDENTITY_MISMATCH'; }
      else results.vinculo = 'compativel';
      for (const cap of t.capabilities) results.capacidades[cap] = out.capabilities?.[cap] || 'nao_verificada';
      results.limitacoes.push(...(out.limitations || []));
      if (c.environment === 'testes') results.limitacoes.push(ERROR_MESSAGES.TEST_ONLY_CONNECTION[0]);
    } else status = 'erro';
  }
  const duration = Date.now() - started;
  const run = await tx(async (db) => {
    const { rows: [x] } = await db.query(`insert into connection_test_runs (company_id, connection_id, credential_version_id, template_version, environment, status, code, results, duration_ms, correlation_id, started_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [req.companyId, c.id, cred?.id || null, t.version, c.environment, status, code, results, duration, correlation, req.user.id]);
    const authOk = results.autenticacao === 'valida';
    const tech = !hasAutomaticAdapter(t) ? 'sem_conector' : !cred ? 'aguardando_credencial' : authOk ? 'autenticacao_valida' : 'erro';
    const health = results.autenticacao === 'indisponivel' ? 'indisponivel' : authOk ? 'operando' : c.health_state;
    await db.query(`update provider_connections set technical_state = $3, health_state = $4, last_test_at = now(), step = greatest(step, 5) where id = $1 and company_id = $2`, [c.id, req.companyId, tech, health]);
    if (authOk) {
      for (const [cap, v] of Object.entries(results.capacidades)) {
        const blocked = reqs.filter((x) => x.required && x.blocks.includes(cap) && x.status !== 'confirmado').map((x) => x.label);
        let state = 'pendente';
        let reason = null;
        if (results.vinculo === 'divergente') { state = 'bloqueada'; reason = ERROR_MESSAGES.BROKER_IDENTITY_MISMATCH[0]; }
        else if (v === 'autorizada') { state = 'validada'; reason = blocked.length ? `Validada tecnicamente; pendente: ${blocked.join(', ')}` : null; }
        else if (v === 'nao_autorizada') { state = 'bloqueada'; reason = ERROR_MESSAGES.ACCESS_NOT_AUTHORIZED[0]; }
        else reason = ERROR_MESSAGES.CAPABILITY_UNVERIFIED[0];
        await db.query(`update capability_validations set state = case when state = 'ativa' and $4 = 'validada' then 'ativa' else $4 end, reason = $5, environment = $6,
            test_run_id = $7, credential_version_id = $8, validated_at = case when $4 = 'validada' then now() else validated_at end, updated_at = now()
          where company_id = $1 and connection_id = $2 and capability = $3`, [req.companyId, c.id, cap, state, reason, c.environment, x.id, cred.id]);
      }
    } else if (cred) {
      await db.query(`update capability_validations set state = case when state = 'indisponivel' then state else 'pendente' end, reason = $3, updated_at = now() where company_id = $1 and connection_id = $2`,
        [req.companyId, c.id, ERROR_MESSAGES[code]?.[0] || 'Falha no teste']);
    }
    // API padrão APOLVEN: teste aprovado ativa a cotação automática (se nada mais bloquear) — é o que a corretora configurou
    if (authOk && t.self_service && results.capacidades.cotacao === 'autorizada' && results.vinculo !== 'divergente') {
      const blockers = await activationBlockers(db, req, c, 'cotacao');
      if (!blockers.length) {
        await db.query(`update capability_validations set state = 'ativa', activated_by = $3, activated_at = now(), updated_at = now() where company_id = $1 and connection_id = $2 and capability = 'cotacao'`,
          [req.companyId, c.id, req.user.id]);
        await EVT(db, req, c.id, 'ativacao', `Cotação automática ativada após teste da API aprovado (${c.environment === 'producao' ? 'produção' : 'somente testes: não entra no multicálculo real'})`);
        x.auto_activated = true;
      } else x.activation_blockers = blockers;
    }
    if (t?.api_config && c.api_config?.base_url) {
      let host = 'desconhecido';
      try { host = new URL(c.api_config.base_url).host; } catch { /* configuração antiga */ }
      await db.query(`insert into quote_api_calls (company_id, connection_id, institution_id, kind, host, http_status, outcome, error, duration_ms, response_raw, response_bytes, created_by)
         values ($1,$2,$3,'teste',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [req.companyId, c.id, c.institution_id, host, out?.exchange?.http_status ?? null, results.autenticacao, out?.detail ? String(out.detail).slice(0, 500) : null,
        duration, out?.exchange?.response_raw ? JSON.stringify(out.exchange.response_raw) : null, out?.exchange?.response_bytes ?? null, req.user.id]);
    }
    await EVT(db, req, c.id, 'teste', `Teste de conexão: autenticação ${results.autenticacao}, vínculo ${results.vinculo}${code ? ` (${code})` : ''}`, { correlation });
    return x;
  });
  res.json({ ...run, message: code ? ERROR_MESSAGES[code] : null });
});

/** Validação manual de capacidade com evidência (quando a API não informa capacidades — C.8). */
r.post('/connections/:id/capabilities/:cap/evidence', need('integrations_manage'), async (req, res) => {
  const d = parse(z.object({ evidence: z.string().trim().min(5).max(1000), evidence_document_id: z.string().uuid().nullable().optional() }), req.body);
  const c = await loadConnection(req, req.params.id);
  if (d.evidence_document_id) await own('documents', d.evidence_document_id, req.companyId, 'id');
  const t = templateBy(c.template_code);
  if (!hasAutomaticAdapter(t)) throw conflict(ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[0], { code: 'CONNECTOR_NOT_AVAILABLE' });
  const last = await one(`select results from connection_test_runs where company_id = $1 and connection_id = $2 order by created_at desc limit 1`, [req.companyId, c.id]);
  if (last?.results?.autenticacao !== 'valida') throw conflict('Teste a conexão com sucesso antes de registrar evidência de capacidade.');
  if (last.results.vinculo === 'divergente') throw conflict(ERROR_MESSAGES.BROKER_IDENTITY_MISMATCH[0], { code: 'BROKER_IDENTITY_MISMATCH' });
  if (last.results.capacidades?.[req.params.cap] === 'nao_autorizada') throw conflict(ERROR_MESSAGES.ACCESS_NOT_AUTHORIZED[0], { code: 'ACCESS_NOT_AUTHORIZED' });
  const row = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update capability_validations set state = 'validada', evidence = $4, evidence_document_id = $5, validated_by = $6, validated_at = now(),
        reason = 'Validada por evidência formal', updated_at = now() where company_id = $1 and connection_id = $2 and capability = $3 and state in ('pendente','validada') returning *`,
    [req.companyId, c.id, req.params.cap, d.evidence, d.evidence_document_id || null, req.user.id]);
    if (!x) throw conflict('Capacidade indisponível ou bloqueada.');
    await EVT(db, req, c.id, 'capacidade', `${CAPABILITIES[x.capability]} validada por evidência`);
    return x;
  });
  res.json(row);
});

/**
 * Etapa 5 — ativação por capacidade (C.9). O backend impõe os mesmos requisitos que a tela mostra:
 * credenciamento aprovado, requisitos bloqueadores confirmados, validação na credencial vigente e vínculo compatível.
 * Ambiente de testes nunca habilita multicálculo real (A35).
 */
export async function activationBlockers(db, req, c, cap) {
  const run = db ? (t2, p) => db.query(t2, p) : q;
  const t = templateBy(c.template_code);
  const out = [];
  if (c.revoked_at) out.push('conexão revogada');
  if (c.paused) out.push('integração pausada');
  if (!hasAutomaticAdapter(t)) out.push(ERROR_MESSAGES.CONNECTOR_NOT_AVAILABLE[0]);
  if (c.accreditation !== 'sim') out.push(ERROR_MESSAGES.ACCREDITATION_PENDING[0]);
  // API no padrão APOLVEN: a própria corretora configura e testa a API da seguradora; basta o credenciamento confirmado
  if (!t?.self_service && c.commercial_state !== 'aprovado') out.push('aprovação comercial não confirmada');
  const { rows: reqs } = await run(`select label from integration_requirements where company_id = $1 and connection_id = $2 and required and status <> 'confirmado' and $3 = any(blocks)`, [req.companyId, c.id, cap]);
  if (reqs.length) out.push(`requisitos pendentes: ${reqs.map((x) => x.label).join(', ')}`);
  const { rows: [v] } = await run('select * from capability_validations where company_id = $1 and connection_id = $2 and capability = $3', [req.companyId, c.id, cap]);
  const { rows: [cred] } = await run('select id from credential_versions where company_id = $1 and connection_id = $2 and revoked_at is null order by version desc limit 1', [req.companyId, c.id]);
  if (!v) out.push('capacidade não prevista neste conector');
  else if (!['validada', 'ativa'].includes(v.state)) out.push(v.reason || 'capacidade não validada');
  else if (!v.evidence && (!cred || v.credential_version_id !== cred.id)) out.push('validação feita com outra credencial: teste novamente');
  if (v && v.environment !== c.environment) out.push('validação de outro ambiente');
  return out;
}

r.post('/connections/:id/capabilities/activate', need('integrations_manage'), async (req, res) => {
  const d = parse(z.object({ capabilities: z.array(z.string().max(40)).max(10).default([]), deactivate: z.array(z.string().max(40)).max(10).optional() }).refine((x) => x.capabilities.length || x.deactivate?.length, 'Escolha ao menos uma função para ativar ou desativar.'), req.body);
  const c = await loadConnection(req, req.params.id);
  const result = await tx(async (db) => {
    const out = {};
    for (const cap of d.capabilities) {
      if (!CAPABILITIES[cap]) { out[cap] = { ok: false, reasons: ['capacidade desconhecida'] }; continue; }
      const blockers = await activationBlockers(db, req, c, cap);
      if (blockers.length) { out[cap] = { ok: false, reasons: blockers }; continue; }
      await db.query(`update capability_validations set state = 'ativa', activated_by = $4, activated_at = now(), updated_at = now() where company_id = $1 and connection_id = $2 and capability = $3`,
        [req.companyId, c.id, cap, req.user.id]);
      out[cap] = { ok: true, environment: c.environment, note: c.environment === 'testes' ? ERROR_MESSAGES.TEST_ONLY_CONNECTION[0] : null };
    }
    for (const cap of d.deactivate || []) {
      await db.query(`update capability_validations set state = 'validada', activated_at = null, updated_at = now() where company_id = $1 and connection_id = $2 and capability = $3 and state = 'ativa'`, [req.companyId, c.id, cap]);
      out[cap] = { ok: true, deactivated: true };
    }
    const activated = Object.entries(out).filter(([, x]) => x.ok && !x.deactivated).map(([k]) => CAPABILITIES[k]);
    await EVT(db, req, c.id, 'ativacao', `Salvar e ativar funções liberadas: ${activated.join(', ') || 'nenhuma'}`, out);
    await audit(db, req, { entity: 'provider_connection', entityId: c.id, action: 'integration.activate', summary: `Funções ativadas: ${activated.join(', ') || 'nenhuma'}`, data: out });
    return out;
  });
  res.json(result);
});

r.post('/connections/:id/pause', need('integrations_manage'), async (req, res) => {
  const d = parse(z.object({ paused: z.boolean(), reason: z.string().max(300).optional() }), req.body);
  const c = await loadConnection(req, req.params.id);
  await tx(async (db) => {
    await db.query('update provider_connections set paused = $3, paused_reason = $4, updated_at = now() where id = $1 and company_id = $2', [c.id, req.companyId, d.paused, d.paused ? d.reason || null : null]);
    // pausar suspende automações novas e preserva histórico; tarefas ainda não iniciadas não executam
    if (d.paused) await db.query(`update quote_tasks set status = 'cancelada', reason = 'Integração pausada antes do início' where company_id = $1 and connection_id = $2 and status = 'aguardando'`, [req.companyId, c.id]);
    await EVT(db, req, c.id, d.paused ? 'pausa' : 'retomada', d.paused ? `Integração pausada${d.reason ? `: ${d.reason}` : ''}` : 'Integração retomada');
  });
  res.json({ ok: true });
});

r.post('/connections/:id/revoke', need('credentials_manage'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300), mfa_code: z.string().optional(), password: z.string().optional() }), req.body);
  await reauth(req, { code: d.mfa_code, password: d.password });
  const c = await loadConnection(req, req.params.id);
  await tx(async (db) => {
    await db.query(`update credential_versions set revoked_at = now(), revoked_reason = $3 where company_id = $1 and connection_id = $2 and revoked_at is null`, [req.companyId, c.id, d.reason]);
    await db.query(`update capability_validations set state = 'bloqueada', reason = 'Integração revogada', activated_at = null, updated_at = now() where company_id = $1 and connection_id = $2`, [req.companyId, c.id]);
    await db.query(`update provider_connections set revoked_at = now(), technical_state = 'nao_configurado', updated_at = now() where id = $1 and company_id = $2`, [c.id, req.companyId]);
    await db.query(`update quote_tasks set status = 'autorizacao_expirada', reason = 'Integração revogada' where company_id = $1 and connection_id = $2 and status = 'aguardando'`, [req.companyId, c.id]);
    await EVT(db, req, c.id, 'revogacao', `Integração revogada: ${d.reason}. Se o fornecedor não permitir revogação remota, conclua no portal dele.`);
    await audit(db, req, { entity: 'provider_connection', entityId: c.id, action: 'integration.revoke', summary: `Integração ${c.institution_name} revogada`, reason: d.reason });
  });
  res.json({ ok: true, message: 'Credenciais e funções revogadas aqui. Desconectar não apaga apólices nem histórico. Se o fornecedor exigir, conclua a revogação no portal dele.' });
});

/** Central de pendências (C.11): o que falta, quem resolve, onde resolver, desde quando e o que fica disponível depois. */
r.get('/pendencias', need('integrations_view'), async (req, res) => {
  const { rows } = await q(`select x.*, pc.institution_id, i.name as institution_name, pc.template_code from integration_requirements x
      join provider_connections pc on pc.id = x.connection_id join institutions i on i.id = pc.institution_id
      where x.company_id = $1 and pc.revoked_at is null and x.status <> 'confirmado' order by x.required desc, x.updated_at`, [req.companyId]);
  const { rows: creds } = await q(`select cv.connection_id, cv.expires_at, i.name as institution_name from credential_versions cv join provider_connections pc on pc.id = cv.connection_id
      join institutions i on i.id = pc.institution_id where cv.company_id = $1 and cv.revoked_at is null and cv.expires_at is not null and cv.expires_at < now() + interval '30 days'`, [req.companyId]);
  res.json({
    requirements: rows.map((x) => ({ ...x, unlocks: x.blocks.map((b) => CAPABILITIES[b]) })),
    expiring_credentials: creds,
  });
});

r.get('/history', need('integrations_view'), async (req, res) => {
  const params = [req.companyId];
  let cond = '';
  if (req.query.connection_id && isUuid(req.query.connection_id)) { params.push(req.query.connection_id); cond = ' and e.connection_id = $2'; }
  const { rows } = await q(`select e.*, i.name as institution_name from integration_events e join provider_connections pc on pc.id = e.connection_id
     join institutions i on i.id = pc.institution_id where e.company_id = $1${cond} order by e.created_at desc limit 300`, params);
  res.json(rows);
});

/** Capacidade ativa para operação real (multicálculo/transmissão): só produção, nunca pausada/revogada. */
export async function activeConnections(db, companyId, capability, environment = 'producao') {
  const run = db ? (t2, p) => db.query(t2, p) : q;
  const { rows } = await run(`select pc.*, i.name as institution_name from provider_connections pc join institutions i on i.id = pc.institution_id
     join capability_validations v on v.connection_id = pc.id and v.company_id = pc.company_id
     where pc.company_id = $1 and pc.revoked_at is null and not pc.paused and pc.environment = $3 and v.capability = $2 and v.state = 'ativa' and v.environment = $3`,
  [companyId, capability, environment]);
  return rows.filter((c) => hasAutomaticAdapter(templateBy(c.template_code)));
}

export default r;
