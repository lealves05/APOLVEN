// Modelos de impressão da apólice por corretora (um padrão + opcional por ramo, com volta ao padrão).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, conflict, BRANCHES } from '../util.js';
import { validateTemplate } from '../lib/printTemplate.js';

const r = Router();
const branchParam = (v) => {
  if (v == null || v === '' || v === 'padrao') return null;
  if (!BRANCHES[v]) throw new HttpError(400, 'Ramo inválido.');
  return v;
};
const out = (t) => t && ({ id: t.id, branch: t.branch, doc: t.doc, header: t.header, footer: t.footer, page: t.page, version: t.version, updated_at: t.updated_at, updated_by_name: t.updated_by_name || null });

/** Modelo que vale para o ramo (o do ramo, senão o padrão da corretora; null = usar o modelo de fábrica). */
export async function templateFor(companyId, branch) {
  const { rows } = await q(`select t.*, u.name as updated_by_name from print_templates t left join users u on u.id = t.updated_by
     where t.company_id = $1 and t.kind = 'apolice' and (t.branch is null or t.branch = $2) order by t.branch nulls last limit 1`, [companyId, branch || '']);
  return rows[0] || null;
}

r.get('/policy', need('policies_view'), async (req, res) => {
  const branch = branchParam(req.query.branch);
  const exact = req.query.exact === '1';
  const t = exact
    ? await one(`select t.*, u.name as updated_by_name from print_templates t left join users u on u.id = t.updated_by
        where t.company_id = $1 and t.kind = 'apolice' and coalesce(t.branch, '') = $2`, [req.companyId, branch || ''])
    : await templateFor(req.companyId, branch);
  const { rows } = await q(`select branch, updated_at from print_templates where company_id = $1 and kind = 'apolice' order by branch nulls first`, [req.companyId]);
  res.json({ template: out(t), source: !t ? 'fabrica' : t.branch ? 'ramo' : 'padrao', saved: rows });
});

r.put('/policy', need('settings'), async (req, res) => {
  const d = parse(z.object({
    branch: z.string().nullable().optional(), version: z.number().int().nullable().optional(),
    doc: z.any(), header: z.any().optional(), footer: z.any().optional(), page: z.any(),
  }), req.body);
  const branch = branchParam(d.branch);
  const t = validateTemplate({ doc: d.doc, header: d.header ?? null, footer: d.footer ?? null, page: d.page });
  const saved = await tx(async (db) => {
    const { rows: [cur] } = await db.query(`select id, version from print_templates where company_id = $1 and kind = 'apolice' and coalesce(branch, '') = $2 for update`,
      [req.companyId, branch || '']);
    if (cur && d.version != null && d.version !== cur.version) throw conflict('O modelo foi alterado por outra pessoa enquanto você editava. Recarregue para ver a versão atual.', { code: 'STALE_TEMPLATE' });
    const { rows: [row] } = cur
      ? await db.query(`update print_templates set doc = $2, header = $3, footer = $4, page = $5, version = version + 1, updated_by = $6, updated_at = now()
          where id = $1 returning *`, [cur.id, t.doc, t.header, t.footer, t.page, req.user.id])
      : await db.query(`insert into print_templates (company_id, kind, branch, doc, header, footer, page, updated_by) values ($1,'apolice',$2,$3,$4,$5,$6,$7) returning *`,
        [req.companyId, branch, t.doc, t.header, t.footer, t.page, req.user.id]);
    await audit(db, req, { entity: 'print_template', entityId: row.id, action: cur ? 'print_template.update' : 'print_template.create',
      summary: `Modelo de impressão da apólice ${branch ? `(${BRANCHES[branch]})` : '(padrão)'} ${cur ? `atualizado para a versão ${row.version}` : 'criado'}` });
    return row;
  });
  res.json({ template: out({ ...saved, updated_by_name: req.user.name }) });
});

r.delete('/policy', need('settings'), async (req, res) => {
  const branch = branchParam(req.query.branch);
  const row = await one(`delete from print_templates where company_id = $1 and kind = 'apolice' and coalesce(branch, '') = $2 returning id`, [req.companyId, branch || '']);
  if (row) {
    await audit(null, req, { entity: 'print_template', entityId: row.id, action: 'print_template.delete',
      summary: `Modelo de impressão da apólice ${branch ? `(${BRANCHES[branch]})` : '(padrão)'} removido — volta ao ${branch ? 'modelo padrão da corretora' : 'modelo de fábrica'}` });
  }
  res.json({ ok: true, removed: !!row });
});

export default r;
