// Clientes, vínculos (contratante ≠ segurado ≠ pagador…), contatos, consentimentos, duplicidade, união revisada,
// linha do tempo e solicitações de titulares (5.1, 25.3).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can, scopeOf } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, onlyDigits, validDocument, maskDocument, idParam, toCsv } from '../util.js';
import { portfolioFilter, assertClientVisible, logActivity, own } from '../lib/common.js';

const r = Router();

/** Saída do cliente com documento mascarado para quem não tem permissão de dado sensível (4.1). */
export function presentClient(req, c) {
  if (!c) return c;
  const full = can(req, 'clients_sensitive');
  return { ...c, document_masked: maskDocument(c.document), document: full ? c.document : null };
}

r.get('/', need('clients_view'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'clients_view', 'c', params);
  const where = ['c.company_id = $1', 'c.merged_into is null', f.sql];
  const term = String(req.query.q || '').trim();
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    const ti = params.length;
    const digits = onlyDigits(term);
    let docCond = '';
    if (digits.length >= 3) { params.push(`%${digits}%`); docCond = ` or c.document like $${params.length}`; }
    where.push(`(lower(c.name) like $${ti} or lower(coalesce(c.trade_name,'')) like $${ti} or lower(coalesce(c.email,'')) like $${ti}${docCond})`);
  }
  if (req.query.owner) { params.push(req.query.owner); where.push(`c.owner_user_id = $${params.length}`); }
  if (req.query.active === 'false') where.push('not c.active'); else where.push('c.active');
  const limit = Math.min(500, Number(req.query.limit) || 200);
  params.push(limit);
  const { rows } = await q(`select c.id, c.kind, c.name, c.trade_name, c.document, c.email, c.phone, c.owner_user_id, c.tags, c.origin, c.created_at,
      u.name as owner_name,
      (select count(*)::int from policies p where p.company_id = c.company_id and p.client_id = c.id and p.contract_state = 'vigente') as active_policies
    from clients c left join users u on u.id = c.owner_user_id
    where ${where.join(' and ')} order by c.name limit $${params.length}`, params);
  res.json(rows.map((c) => presentClient(req, c)));
});

const addressSchema = z.object({
  cep: z.string().max(10).optional().nullable(), street: z.string().max(200).optional().nullable(), number: z.string().max(20).optional().nullable(),
  complement: z.string().max(100).optional().nullable(), district: z.string().max(100).optional().nullable(), city: z.string().max(100).optional().nullable(),
  uf: z.string().max(2).optional().nullable(),
}).partial();
const clientSchema = z.object({
  kind: z.enum(['pf', 'pj']).default('pf'),
  name: z.string().trim().min(2).max(200),
  trade_name: z.string().trim().max(200).nullable().optional(),
  document: z.string().trim().max(20).nullable().optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(160).nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(40).nullable().optional(),
  address: addressSchema.optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  unit_id: z.string().uuid().nullable().optional(),
  origin: z.string().trim().max(80).nullable().optional(),
  preferred_channel: z.string().trim().max(30).nullable().optional(),
  marketing_opt_out: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

function normalizeDoc(kind, doc) {
  if (!doc) return null;
  const d = onlyDigits(doc);
  if ((kind === 'pf' && d.length !== 11) || (kind === 'pj' && d.length !== 14) || !validDocument(d)) {
    throw new HttpError(400, kind === 'pf' ? 'CPF inválido.' : 'CNPJ inválido.');
  }
  return d;
}

async function duplicateOf(req, document, exceptId = null) {
  if (!document) return null;
  return one('select id, name from clients where company_id = $1 and document = $2 and merged_into is null and ($3::uuid is null or id <> $3)', [req.companyId, document, exceptId]);
}

r.post('/', need('clients_edit'), async (req, res) => {
  const d = parse(clientSchema, req.body);
  d.document = normalizeDoc(d.kind, d.document);
  const dup = await duplicateOf(req, d.document);
  if (dup) throw new HttpError(409, `Já existe um cliente com este documento: ${dup.name}.`, { code: 'DUPLICATE_CLIENT', client_id: dup.id });
  // corretor com carteira própria cadastra para si
  const ownerId = scopeOf(req, 'clients_view') === 'own' ? req.user.id : (d.owner_user_id || req.user.id);
  if (ownerId) await own('users', ownerId, req.companyId, 'id');
  const c = await tx(async (db) => {
    const { rows: [x] } = await db.query(`insert into clients (company_id, unit_id, kind, name, trade_name, document, birth_date, email, phone, address, owner_user_id,
        origin, preferred_channel, marketing_opt_out, notes, tags, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
    [req.companyId, d.unit_id || req.user.unit_id || null, d.kind, d.name, d.trade_name || null, d.document, d.birth_date || null, d.email || null, d.phone || null,
      d.address || {}, ownerId, d.origin || null, d.preferred_channel || null, !!d.marketing_opt_out, d.notes || null, d.tags || [], req.user.id]);
    await logActivity(db, req, { clientId: x.id, summary: 'Cliente cadastrado' });
    return x;
  });
  // possíveis homônimos: só sugestão, nunca união automática
  const similar = await q(`select id, name from clients where company_id = $1 and id <> $2 and merged_into is null and lower(name) = lower($3) limit 5`, [req.companyId, c.id, c.name]);
  res.status(201).json({ ...presentClient(req, c), similar: similar.rows });
});

r.get('/duplicates', need('clients_edit'), async (req, res) => {
  const { rows } = await q(`select a.id as a_id, a.name as a_name, b.id as b_id, b.name as b_name,
      case when a.email is not null and a.email = b.email then 'mesmo e-mail'
           when a.phone is not null and regexp_replace(a.phone,'\\D','','g') = regexp_replace(b.phone,'\\D','','g') then 'mesmo telefone'
           else 'mesmo nome' end as reason
    from clients a join clients b on b.company_id = a.company_id and b.id > a.id and b.merged_into is null
    where a.company_id = $1 and a.merged_into is null and (
      lower(a.name) = lower(b.name) or (a.email is not null and a.email = b.email)
      or (a.phone is not null and length(regexp_replace(a.phone,'\\D','','g')) >= 10 and regexp_replace(a.phone,'\\D','','g') = regexp_replace(b.phone,'\\D','','g')))
    limit 100`, [req.companyId]);
  res.json(rows);
});

r.get('/export', need('clients_export'), async (req, res) => {
  const { rows } = await q(`select name, kind, document, email, phone, origin, created_at from clients where company_id = $1 and merged_into is null order by name`, [req.companyId]);
  const full = can(req, 'clients_sensitive');
  const out = rows.map((c) => ({ nome: c.name, tipo: c.kind, documento: full ? c.document : maskDocument(c.document), email: c.email, telefone: c.phone, origem: c.origin, cadastro: c.created_at?.toISOString?.().slice(0, 10) }));
  await audit(null, req, { entity: 'client', action: 'client.export', summary: `Exportação de ${out.length} clientes${full ? '' : ' (documentos mascarados)'}` });
  res.type('text/csv').send(toCsv(out));
});

r.get('/:id', need('clients_view'), async (req, res) => {
  const id = idParam(req.params.id);
  await assertClientVisible(req, 'clients_view', id);
  const c = await one(`select c.*, u.name as owner_name, m.name as merged_into_name from clients c left join users u on u.id = c.owner_user_id
     left join clients m on m.id = c.merged_into where c.id = $1 and c.company_id = $2`, [id, req.companyId]);
  if (!c) throw notFound();
  const [contacts, rels, consents, opps, pols, timeline, claims, reqs] = await Promise.all([
    q('select * from client_contacts where company_id = $1 and client_id = $2 order by name', [req.companyId, id]),
    q(`select r.*, c.name as related_name from client_relationships r join clients c on c.id = r.related_client_id where r.company_id = $1 and r.client_id = $2
       union all select r.id, r.company_id, r.related_client_id as client_id, r.client_id as related_client_id, r.relation || ' (de)' as relation, r.notes, r.created_at, c.name
       from client_relationships r join clients c on c.id = r.client_id where r.company_id = $1 and r.related_client_id = $2`, [req.companyId, id]),
    q('select * from consents where company_id = $1 and client_id = $2 order by granted_at desc', [req.companyId, id]),
    q('select id, number, title, branch, stage, next_action_at, created_at from opportunities where company_id = $1 and client_id = $2 order by created_at desc', [req.companyId, id]),
    q(`select p.id, p.policy_number, p.branch, p.start_date, p.end_date, p.contract_state, p.doc_state, p.total_premium_cents, i.name as institution_name,
         case when p.client_id = $2 then 'contratante' when p.insured_client_id = $2 then 'segurado' else 'pagador' end as role
       from policies p join institutions i on i.id = p.institution_id
       where p.company_id = $1 and ($2 in (p.client_id, p.insured_client_id, p.payer_client_id)) order by p.end_date desc`, [req.companyId, id]),
    q('select * from activities where company_id = $1 and client_id = $2 order by created_at desc limit 100', [req.companyId, id]),
    q('select id, number, work_status, occurred_at, description from claims where company_id = $1 and client_id = $2 order by occurred_at desc', [req.companyId, id]),
    q('select id, number, kind, status, created_at from service_requests where company_id = $1 and client_id = $2 order by created_at desc limit 50', [req.companyId, id]),
  ]);
  res.json({ ...presentClient(req, c), contacts: contacts.rows, relationships: rels.rows, consents: consents.rows, opportunities: opps.rows,
    policies: pols.rows, timeline: timeline.rows, claims: claims.rows, service_requests: reqs.rows });
});

r.put('/:id', need('clients_edit'), async (req, res) => {
  const id = idParam(req.params.id);
  await assertClientVisible(req, 'clients_view', id);
  const d = parse(clientSchema.partial().extend({ version: z.number().int(), active: z.boolean().optional() }), req.body);
  const cur = await own('clients', id, req.companyId);
  if (cur.merged_into) throw new HttpError(409, 'Cadastro unido a outro cliente; edite o cadastro principal.');
  // quem não vê o documento completo (vê mascarado) não pode sobrescrevê-lo
  if (!can(req, 'clients_sensitive')) delete d.document;
  if (d.document !== undefined) {
    d.document = normalizeDoc(d.kind || cur.kind, d.document);
    const dup = await duplicateOf(req, d.document, id);
    if (dup) throw new HttpError(409, `Já existe um cliente com este documento: ${dup.name}.`, { code: 'DUPLICATE_CLIENT', client_id: dup.id });
  }
  if (d.owner_user_id) await own('users', d.owner_user_id, req.companyId, 'id');
  if (scopeOf(req, 'clients_view') === 'own') delete d.owner_user_id;
  const { version, ...fields } = d;
  const keys = Object.keys(fields);
  const out = await tx(async (db) => {
    const sets = keys.map((k, i) => `${k} = $${i + 4}`);
    const { rows: [x] } = await db.query(`update clients set ${[...sets, 'version = version + 1', 'updated_at = now()'].join(', ')}
       where id = $1 and company_id = $2 and version = $3 returning *`, [id, req.companyId, version, ...keys.map((k) => fields[k] ?? null)]);
    // controle otimista (28.2): outra pessoa alterou antes — nada é sobrescrito
    if (!x) throw new HttpError(409, 'Este cadastro foi alterado por outra pessoa. Recarregue antes de salvar.', { code: 'VERSION_CONFLICT' });
    // dados usados em cotações anteriores: a alteração fica registrada (5.1)
    const changed = keys.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(x[k]));
    if (changed.length) await logActivity(db, req, { clientId: id, summary: `Cadastro atualizado: ${changed.join(', ')}` });
    await audit(db, req, { entity: 'client', entityId: id, action: 'client.update', summary: `Cliente ${x.name} alterado`, data: { fields: changed } });
    return x;
  });
  res.json(presentClient(req, out));
});

// ---- contatos ----
const contactSchema = z.object({ name: z.string().trim().min(2).max(160), role: z.string().max(80).nullable().optional(), email: z.string().email().max(160).nullable().optional().or(z.literal('').transform(() => null)), phone: z.string().max(40).nullable().optional(), authorized: z.boolean().optional() });
r.post('/:id/contacts', need('clients_edit'), async (req, res) => {
  const id = idParam(req.params.id);
  await assertClientVisible(req, 'clients_view', id);
  const d = parse(contactSchema, req.body);
  res.status(201).json(await one(`insert into client_contacts (company_id, client_id, name, role, email, phone, authorized) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.companyId, id, d.name, d.role || null, d.email || null, d.phone || null, !!d.authorized]));
});
r.delete('/:id/contacts/:cid', need('clients_edit'), async (req, res) => {
  const r2 = await q('delete from client_contacts where id = $1 and client_id = $2 and company_id = $3', [idParam(req.params.cid), idParam(req.params.id), req.companyId]);
  if (!r2.rowCount) throw notFound();
  res.json({ ok: true });
});

// ---- vínculos ----
export const RELATIONS = ['dependente', 'conjuge', 'socio', 'empresa_do_grupo', 'representante_legal', 'pagador', 'estipulante', 'beneficiario', 'segurado', 'contato_autorizado'];
r.post('/:id/relationships', need('clients_edit'), async (req, res) => {
  const id = idParam(req.params.id);
  await assertClientVisible(req, 'clients_view', id);
  const d = parse(z.object({ related_client_id: z.string().uuid(), relation: z.enum(RELATIONS), notes: z.string().max(500).nullable().optional() }), req.body);
  await own('clients', d.related_client_id, req.companyId, 'id');
  const row = await one(`insert into client_relationships (company_id, client_id, related_client_id, relation, notes) values ($1,$2,$3,$4,$5)
    on conflict (company_id, client_id, related_client_id, relation) do update set notes = excluded.notes returning *`, [req.companyId, id, d.related_client_id, d.relation, d.notes || null]);
  res.status(201).json(row);
});
r.delete('/:id/relationships/:rid', need('clients_edit'), async (req, res) => {
  const x = await q('delete from client_relationships where id = $1 and company_id = $2 and $3 in (client_id, related_client_id)', [idParam(req.params.rid), req.companyId, idParam(req.params.id)]);
  if (!x.rowCount) throw notFound();
  res.json({ ok: true });
});

// ---- consentimentos e autorizações (separados de marketing e de Open Insurance) ----
export const PURPOSES = { cotacao: 'Compartilhar dados para cotação', marketing: 'Comunicações de relacionamento/marketing', dados_sensiveis: 'Dados sensíveis (saúde)', portal: 'Acesso ao portal', open_insurance: 'Open Insurance (fluxo próprio do ecossistema)' };
r.post('/:id/consents', need('clients_edit'), async (req, res) => {
  const id = idParam(req.params.id);
  await assertClientVisible(req, 'clients_view', id);
  const d = parse(z.object({ purpose: z.enum(Object.keys(PURPOSES)), legal_basis: z.string().max(120).nullable().optional(), recipients: z.string().max(500).nullable().optional(), evidence: z.string().trim().min(3, 'descreva a evidência (como e quando foi obtido)').max(1000) }), req.body);
  if (d.purpose === 'open_insurance') throw new HttpError(400, 'Consentimento de Open Insurance segue o fluxo do participante habilitado e não é registrado pelo CRM.');
  const row = await tx(async (db) => {
    const { rows: [x] } = await db.query(`insert into consents (company_id, client_id, purpose, legal_basis, recipients, evidence, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [req.companyId, id, d.purpose, d.legal_basis || null, d.recipients || null, d.evidence, req.user.id]);
    if (d.purpose === 'marketing') await db.query('update clients set marketing_opt_out = false where id = $1 and company_id = $2', [id, req.companyId]);
    await logActivity(db, req, { clientId: id, summary: `Autorização registrada: ${PURPOSES[d.purpose]}` });
    await audit(db, req, { entity: 'consent', entityId: x.id, action: 'consent.grant', summary: `${PURPOSES[d.purpose]} — autorizado` });
    return x;
  });
  res.status(201).json(row);
});
r.post('/:id/consents/:cid/revoke', need('clients_edit'), async (req, res) => {
  const id = idParam(req.params.id);
  const d = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const row = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update consents set revoked_at = now(), revoked_reason = $4 where id = $1 and client_id = $2 and company_id = $3 and revoked_at is null returning *`,
      [idParam(req.params.cid), id, req.companyId, d.reason]);
    if (!x) throw notFound();
    if (x.purpose === 'marketing') await db.query('update clients set marketing_opt_out = true where id = $1 and company_id = $2', [id, req.companyId]);
    await logActivity(db, req, { clientId: id, summary: `Autorização revogada: ${PURPOSES[x.purpose]}` });
    await audit(db, req, { entity: 'consent', entityId: x.id, action: 'consent.revoke', summary: `${PURPOSES[x.purpose]} — revogado`, reason: d.reason });
    const { emit } = await import('../audit.js');
    await emit(db, req.companyId, 'ConsentRevoked', 'consent', x.id, { purpose: x.purpose });
    return x;
  });
  res.json(row);
});

/** Consentimento ativo para a finalidade (verificado antes de compartilhar e de novo ao executar a tarefa — A25). */
export async function hasConsent(db, companyId, clientId, purpose) {
  const run = db ? (t, p) => db.query(t, p) : q;
  const { rows: [x] } = await run(`select 1 from consents where company_id = $1 and client_id = $2 and purpose = $3 and granted and revoked_at is null limit 1`, [companyId, clientId, purpose]);
  return !!x;
}

// ---- atendimento (linha do tempo) ----
r.post('/:id/activities', need('clients_view'), async (req, res) => {
  const id = idParam(req.params.id);
  await assertClientVisible(req, 'clients_view', id);
  const d = parse(z.object({ kind: z.enum(['nota', 'ligacao', 'email', 'whatsapp', 'reuniao', 'reclamacao', 'compromisso']), summary: z.string().trim().min(2).max(4000) }), req.body);
  await logActivity(null, req, { clientId: id, kind: d.kind, summary: d.summary });
  res.status(201).json({ ok: true });
});

/**
 * União revisada (5.1): move vínculos, contratos e evidências para o cadastro principal; o secundário fica marcado
 * como unido (não é apagado). Nunca automática.
 */
r.post('/:id/merge', need('clients_edit'), async (req, res) => {
  const keep = idParam(req.params.id);
  const d = parse(z.object({ merge_id: z.string().uuid(), confirm: z.literal(true) }), req.body);
  if (d.merge_id === keep) throw new HttpError(400, 'Escolha dois cadastros diferentes.');
  const a = await own('clients', keep, req.companyId);
  const b = await own('clients', d.merge_id, req.companyId);
  if (a.merged_into || b.merged_into) throw new HttpError(409, 'Um dos cadastros já foi unido.');
  await assertClientVisible(req, 'clients_view', a.id);
  await assertClientVisible(req, 'clients_view', b.id);
  if (a.document && b.document && a.document !== b.document) throw new HttpError(409, 'Documentos diferentes: não são a mesma pessoa.');
  await tx(async (db) => {
    const moves = [
      ['opportunities', 'client_id'], ['quote_requests', 'client_id'], ['comparisons', 'client_id'], ['proposals', 'client_id'],
      ['policies', 'client_id'], ['policies', 'insured_client_id'], ['policies', 'payer_client_id'], ['claims', 'client_id'], ['service_requests', 'client_id'],
      ['activities', 'client_id'], ['tasks', 'client_id'], ['documents', 'client_id'], ['consents', 'client_id'], ['client_contacts', 'client_id'],
      ['public_links', 'client_id'], ['messages', 'client_id'], ['privacy_requests', 'client_id'],
    ];
    for (const [t, col] of moves) await db.query(`update ${t} set ${col} = $1 where company_id = $2 and ${col} = $3`, [keep, req.companyId, b.id]);
    await db.query(`delete from client_relationships where company_id = $1 and ((client_id = $2 and related_client_id = $3) or (client_id = $3 and related_client_id = $2))`, [req.companyId, keep, b.id]);
    await db.query(`update client_relationships r set client_id = $2 where company_id = $1 and client_id = $3
       and not exists (select 1 from client_relationships x where x.company_id = r.company_id and x.client_id = $2 and x.related_client_id = r.related_client_id and x.relation = r.relation)`, [req.companyId, keep, b.id]);
    await db.query(`update client_relationships r set related_client_id = $2 where company_id = $1 and related_client_id = $3
       and not exists (select 1 from client_relationships x where x.company_id = r.company_id and x.related_client_id = $2 and x.client_id = r.client_id and x.relation = r.relation)`, [req.companyId, keep, b.id]);
    await db.query('delete from client_relationships where company_id = $1 and $2 in (client_id, related_client_id)', [req.companyId, b.id]);
    await db.query(`update clients set merged_into = $3, active = false, document = null, updated_at = now(), notes = coalesce(notes,'') || $4 where id = $1 and company_id = $2`,
      [b.id, req.companyId, keep, `\n[Unido em ${new Date().toISOString().slice(0, 10)} ao cadastro ${a.name}; documento anterior: ${b.document || '—'}]`]);
    await db.query('update clients set document = coalesce(document, $3), version = version + 1, updated_at = now() where id = $1 and company_id = $2', [keep, req.companyId, b.document]);
    await logActivity(db, req, { clientId: keep, summary: `Cadastro ${b.name} unido a este (revisão humana)` });
    await audit(db, req, { entity: 'client', entityId: keep, action: 'client.merge', summary: `União de cadastros: ${b.name} → ${a.name}` });
  });
  res.json({ ok: true });
});

// ---- solicitações de titulares (LGPD) — montado em /privacy-requests ----
export const privacy = Router();
privacy.get('/', need('privacy'), async (req, res) => {
  const { rows } = await q(`select p.*, c.name as client_name from privacy_requests p left join clients c on c.id = p.client_id where p.company_id = $1 order by p.created_at desc limit 200`, [req.companyId]);
  res.json(rows);
});
privacy.post('/', need('privacy'), async (req, res) => {
  const d = parse(z.object({ client_id: z.string().uuid().nullable().optional(), kind: z.enum(['acesso', 'correcao', 'exportacao', 'eliminacao', 'revogacao', 'informacao']), description: z.string().max(2000).optional(), due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  if (d.client_id) await own('clients', d.client_id, req.companyId, 'id');
  const row = await one(`insert into privacy_requests (company_id, client_id, kind, description, due_at, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.companyId, d.client_id || null, d.kind, d.description || null, d.due_at || null, req.user.id]);
  await audit(null, req, { entity: 'privacy_request', entityId: row.id, action: 'privacy.create', summary: `Solicitação de titular: ${d.kind}` });
  res.status(201).json(row);
});
privacy.put('/:id', need('privacy'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(['aberta', 'em_andamento', 'respondida', 'encerrada']), response: z.string().max(4000).optional() }), req.body);
  const row = await one(`update privacy_requests set status = $3, response = coalesce($4, response), closed_at = case when $3 in ('respondida','encerrada') then now() else null end
     where id = $1 and company_id = $2 returning *`, [idParam(req.params.id), req.companyId, d.status, d.response || null]);
  if (!row) throw notFound();
  await audit(null, req, { entity: 'privacy_request', entityId: row.id, action: 'privacy.update', summary: `Solicitação de titular: ${d.status}` });
  res.json(row);
});

export default r;
