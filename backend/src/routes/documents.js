// Gestão documental (19.3): arquivos privados no banco, tipo e conteúdo conferidos, hash, versão, origem,
// nível de acesso e links temporários revogáveis com registro de acesso.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need, can } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, idParam, sha256, randomToken } from '../util.js';
import { own, portfolioFilter, assertClientVisible } from '../lib/common.js';

const r = Router();
export const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MIMES = {
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  'image/png': (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'text/csv': (b) => !b.includes(0) && !/<script|<html/i.test(b.subarray(0, 4096).toString('utf8')),
  'text/plain': (b) => !b.includes(0) && !/<script|<html/i.test(b.subarray(0, 4096).toString('utf8')),
  'application/xml': (b) => !b.includes(0) && !/<script/i.test(b.subarray(0, 8192).toString('utf8')),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) => b[0] === 0x50 && b[1] === 0x4b,
};
const ENTITIES = {
  client: 'clients', policy: 'policies', proposal: 'proposals', quote_request: 'quote_requests', claim: 'claims', provider_connection: 'provider_connections',
  service_request: 'service_requests', endorsement: 'endorsements', premium_installment: 'premium_installments', commission_agreement: 'commission_agreements', company: null,
};
export const DOC_KINDS = ['apolice', 'certificado', 'proposta_formal', 'cotacao_formal', 'condicoes_gerais', 'endosso', 'boleto', 'comprovante', 'documento_pessoal', 'vistoria',
  'sinistro', 'contrato', 'certidao', 'evidencia', 'questionario_restrito', 'extrato_comissao', 'outro'];

/** Valida e grava um documento (usado também pelo portal do cliente). */
export async function storeDocument(db, { companyId, userId = null, entity, entityId = null, clientId = null, kind, filename, mime, base64, accessLevel = 'normal', origin = 'corretora', validUntil = null, description = null }) {
  if (!MIMES[mime]) throw new HttpError(400, 'Tipo de arquivo não permitido (PDF, JPG, PNG, WEBP, CSV, TXT, XML ou XLSX).');
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'Arquivo vazio.');
  if (buf.length > MAX_DOC_BYTES) throw new HttpError(413, 'Arquivo acima de 8 MB.');
  if (!MIMES[mime](buf)) throw new HttpError(400, 'O conteúdo do arquivo não corresponde ao tipo informado.');
  const name = String(filename).replace(/[\\/\0<>:"|?*]/g, '_').slice(0, 180);
  const run = db ? (t, p) => db.query(t, p) : q;
  const { rows: [v] } = await run(`select coalesce(max(version),0)+1 as n from documents where company_id = $1 and entity = $2 and entity_id is not distinct from $3 and filename = $4`, [companyId, entity, entityId, name]);
  const { rows: [doc] } = await run(`insert into documents (company_id, entity, entity_id, client_id, kind, filename, mime, size, sha256, data, version, origin, access_level, valid_until, description, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id, entity, entity_id, kind, filename, mime, size, sha256, version, origin, access_level, created_at`,
  [companyId, entity, entityId, clientId, kind, name, mime, buf.length, sha256(buf), buf, v.n, origin, accessLevel, validUntil, description, userId]);
  return doc;
}

r.get('/', async (req, res) => {
  const params = [req.companyId];
  const where = ['company_id = $1'];
  if (req.query.entity) { params.push(String(req.query.entity)); where.push(`entity = $${params.length}`); }
  if (req.query.entity_id) { params.push(idParam(req.query.entity_id)); where.push(`entity_id = $${params.length}`); }
  if (req.query.client_id) { params.push(idParam(req.query.client_id)); where.push(`client_id = $${params.length}`); }
  if (!can(req, 'documents_restricted')) where.push(`access_level = 'normal'`);
  const f = portfolioFilter(req, 'clients_view', 'c', params);
  if (f.sql !== 'true') where.push(`(client_id is null or exists (select 1 from clients c where c.id = documents.client_id and ${f.sql}))`);
  const { rows } = await q(`select id, entity, entity_id, client_id, kind, filename, mime, size, sha256, version, origin, access_level, valid_until, description, created_at
     from documents where ${where.join(' and ')} order by created_at desc limit 300`, params);
  res.json(rows);
});

r.post('/', async (req, res) => {
  const d = parse(z.object({ entity: z.enum(Object.keys(ENTITIES)), entity_id: z.string().uuid().nullable().optional(), client_id: z.string().uuid().nullable().optional(),
    kind: z.enum(DOC_KINDS), filename: z.string().trim().min(1).max(200), mime: z.string().max(120), data: z.string().max(12_000_000),
    access_level: z.enum(['normal', 'restrito']).default('normal'), valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    description: z.string().max(500).nullable().optional() }), req.body);
  if (d.access_level === 'restrito' || d.kind === 'questionario_restrito') { if (!can(req, 'documents_restricted')) throw new HttpError(403, 'Documento restrito exige permissão específica.'); d.access_level = 'restrito'; }
  if (d.entity_id && ENTITIES[d.entity]) await own(ENTITIES[d.entity], d.entity_id, req.companyId, 'id');
  if (d.client_id) { await own('clients', d.client_id, req.companyId, 'id'); await assertClientVisible(req, 'clients_view', d.client_id); }
  const doc = await storeDocument(null, { companyId: req.companyId, userId: req.user.id, entity: d.entity, entityId: d.entity_id || null, clientId: d.client_id || null,
    kind: d.kind, filename: d.filename, mime: d.mime, base64: d.data, accessLevel: d.access_level, validUntil: d.valid_until || null, description: d.description || null });
  await audit(null, req, { entity: 'document', entityId: doc.id, action: 'document.upload', summary: `Documento ${doc.filename} (v${doc.version}, ${d.access_level})` });
  res.status(201).json(doc);
});

export async function sendDocument(res, doc) {
  res.set('Content-Type', doc.mime);
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store, private');
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(doc.data);
}

r.get('/:id/download', async (req, res) => {
  const doc = await one('select * from documents where id = $1 and company_id = $2', [idParam(req.params.id), req.companyId]);
  if (!doc) throw notFound();
  if (doc.access_level === 'restrito' && !can(req, 'documents_restricted')) throw notFound();
  if (doc.client_id) await assertClientVisible(req, 'clients_view', doc.client_id);
  await audit(null, req, { entity: 'document', entityId: doc.id, action: 'document.download', summary: `Download: ${doc.filename}` });
  await sendDocument(res, doc);
});

/** Link temporário para o cliente (horas), revogável; documento restrito não é compartilhado por link. */
r.post('/:id/link', async (req, res) => {
  const d = parse(z.object({ hours: z.number().int().min(1).max(168).default(48) }), req.body);
  const doc = await own('documents', req.params.id, req.companyId, 'id, client_id, access_level, filename');
  if (doc.access_level === 'restrito') throw new HttpError(403, 'Documento restrito não pode ser compartilhado por link.');
  if (doc.client_id) await assertClientVisible(req, 'clients_view', doc.client_id);
  const token = randomToken(24);
  await q(`insert into public_links (company_id, purpose, entity, entity_id, client_id, token_hash, expires_at, created_by) values ($1,'documento','document',$2,$3,$4, now() + make_interval(hours => $5), $6)`,
    [req.companyId, doc.id, doc.client_id, sha256(token), d.hours, req.user.id]);
  await audit(null, req, { entity: 'document', entityId: doc.id, action: 'document.link', summary: `Link temporário (${d.hours} h) para ${doc.filename}` });
  res.status(201).json({ token, path: `/p/documento/${token}` });
});

r.get('/links', async (req, res) => {
  const { rows } = await q(`select id, purpose, entity, entity_id, client_id, expires_at, revoked_at, created_at, last_access_at, access_count from public_links where company_id = $1 order by created_at desc limit 200`, [req.companyId]);
  res.json(rows);
});
r.post('/links/:id/revoke', async (req, res) => {
  const x = await q('update public_links set revoked_at = now() where id = $1 and company_id = $2 and revoked_at is null', [idParam(req.params.id), req.companyId]);
  if (!x.rowCount) throw notFound();
  res.json({ ok: true });
});

export default r;
