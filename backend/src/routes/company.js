// Corretora (dados reutilizáveis no credenciamento — 7.7), unidades, usuários e perfis de acesso.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, onlyDigits, validDocument, withDefaults, ROLES, PERMISSIONS, idParam } from '../util.js';
import { COMPANY_COLS } from './auth.js';
import { setPassword, passwordSchema } from '../security.js';

const r = Router();

r.get('/', async (req, res) => {
  const c = await one(COMPANY_COLS, [req.companyId]);
  c.settings = withDefaults(c.settings);
  res.json(c);
});

const companySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  trade_name: z.string().trim().max(160).nullable().optional(),
  document: z.string().trim().nullable().optional(),
  susep_code: z.string().trim().max(40).nullable().optional(),
  tech_responsible_name: z.string().trim().max(160).nullable().optional(),
  tech_responsible_document: z.string().trim().max(20).nullable().optional(),
  segments: z.array(z.string().max(40)).max(30).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional().or(z.literal('')),
  cep: z.string().trim().max(10).nullable().optional(),
  street: z.string().trim().max(200).nullable().optional(),
  number: z.string().trim().max(20).nullable().optional(),
  complement: z.string().trim().max(100).nullable().optional(),
  district: z.string().trim().max(100).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  uf: z.string().trim().max(2).nullable().optional(),
  logo_url: z.string().trim().max(300000).nullable().optional(),
  settings: z.record(z.any()).optional(),
});

r.put('/', need('settings'), async (req, res) => {
  const d = parse(companySchema, req.body);
  if (d.document) {
    d.document = onlyDigits(d.document);
    if (d.document.length !== 14 || !validDocument(d.document)) throw new HttpError(400, 'CNPJ inválido.');
  }
  if (d.logo_url && !/^data:image\/(png|jpeg|webp);base64,/.test(d.logo_url) && !/^https:\/\//.test(d.logo_url)) throw new HttpError(400, 'Logotipo inválido.');
  const { settings, ...cols } = d;
  await tx(async (db) => {
    const sets = Object.keys(cols).map((k, i) => `${k} = $${i + 2}`);
    if (sets.length) await db.query(`update companies set ${sets.join(', ')} where id = $1`, [req.companyId, ...Object.values(cols).map((v) => (v === '' ? null : v))]);
    if (settings) {
      // permissões só por quem administra usuários; demais chaves por quem administra a corretora
      const { permissions, ...rest } = settings;
      if (permissions && !['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Só o proprietário ou um administrador altera perfis de acesso.');
      const { rows: [c] } = await db.query('select settings from companies where id = $1 for update', [req.companyId]);
      const next = { ...(c.settings || {}), ...rest, ...(permissions ? { permissions } : {}) };
      if (next.scoring) {
        const w = next.scoring;
        if (Object.values(w).some((v) => !(Number(v) >= 0 && Number(v) <= 100))) throw new HttpError(400, 'Pesos da comparação devem ficar entre 0 e 100.');
        if ('commission' in w) throw new HttpError(400, 'Comissão não pode ser critério de benefício ao cliente.');
      }
      await db.query('update companies set settings = $2 where id = $1', [req.companyId, next]);
    }
    await audit(db, req, { entity: 'company', entityId: req.companyId, action: 'company.update', summary: 'Dados/configurações da corretora alterados', data: { ...cols, settings: settings ? Object.keys(settings) : undefined } });
  });
  const c = await one(COMPANY_COLS, [req.companyId]);
  c.settings = withDefaults(c.settings);
  res.json(c);
});

// ---------------- Unidades ----------------
r.get('/units', async (req, res) => {
  const { rows } = await q('select * from units where company_id = $1 order by is_main desc, name', [req.companyId]);
  res.json(rows);
});
const unitSchema = z.object({
  name: z.string().trim().min(2).max(120), document: z.string().trim().nullable().optional(), susep_code: z.string().trim().max(40).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(), uf: z.string().trim().max(2).nullable().optional(), active: z.boolean().optional(),
});
r.post('/units', need('units_manage'), async (req, res) => {
  const d = parse(unitSchema, req.body);
  if (d.document && !validDocument(d.document)) throw new HttpError(400, 'CNPJ inválido.');
  const u = await one('insert into units (company_id, name, document, susep_code, city, uf) values ($1,$2,$3,$4,$5,$6) returning *',
    [req.companyId, d.name, d.document ? onlyDigits(d.document) : null, d.susep_code || null, d.city || null, d.uf || null]);
  await audit(null, req, { entity: 'unit', entityId: u.id, action: 'unit.create', summary: `Unidade ${d.name} criada` });
  res.status(201).json(u);
});
r.put('/units/:id', need('units_manage'), async (req, res) => {
  const d = parse(unitSchema.partial(), req.body);
  const u = await one(`update units set name = coalesce($3, name), document = coalesce($4, document), susep_code = coalesce($5, susep_code),
     city = coalesce($6, city), uf = coalesce($7, uf), active = coalesce($8, active) where id = $1 and company_id = $2 returning *`,
  [idParam(req.params.id), req.companyId, d.name ?? null, d.document ? onlyDigits(d.document) : null, d.susep_code ?? null, d.city ?? null, d.uf ?? null, d.active ?? null]);
  if (!u) throw notFound();
  await audit(null, req, { entity: 'unit', entityId: u.id, action: 'unit.update', summary: `Unidade ${u.name} alterada` });
  res.json(u);
});

// ---------------- Usuários ----------------
r.get('/users', async (req, res) => {
  const all = ['owner', 'admin'].includes(req.user.role) || req.perms.users === true;
  const { rows } = await q(`select id, name, email, role, unit_id, team, active, mfa_enabled, last_login_at, created_at from users
     where company_id = $1 order by active desc, name`, [req.companyId]);
  // lista mínima para quem não administra usuários (atribuição de responsáveis)
  res.json(all ? rows : rows.filter((u) => u.active).map(({ id, name, role }) => ({ id, name, role })));
});

const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
  role: z.enum(Object.keys(ROLES).filter((x) => x !== 'owner')),
  unit_id: z.string().uuid().nullable().optional(),
  team: z.string().trim().max(60).nullable().optional(),
});

/** Convite: senha provisória exibida uma única vez; o usuário troca no primeiro acesso. */
r.post('/users', need('users'), async (req, res) => {
  const d = parse(userSchema, req.body);
  if (await one('select 1 from users where email = $1', [d.email])) throw new HttpError(409, 'Este e-mail já está cadastrado.');
  if (d.unit_id) await one('select 1 from units where id=$1 and company_id=$2', [d.unit_id, req.companyId]).then((x) => { if (!x) throw notFound('Unidade não encontrada.'); });
  const temp = `Ap-${crypto.randomBytes(6).toString('base64url')}-${crypto.randomInt(10, 99)}`;
  const u = await one(`insert into users (company_id, unit_id, name, email, password_hash, role, team) values ($1,$2,$3,$4,$5,$6,$7)
     returning id, name, email, role, unit_id, team, active`, [req.companyId, d.unit_id || null, d.name, d.email, await bcrypt.hash(temp, 10), d.role, d.team || null]);
  await audit(null, req, { entity: 'user', entityId: u.id, action: 'user.create', summary: `Usuário ${d.name} (${ROLES[d.role]}) criado` });
  res.status(201).json({ ...u, temporary_password: temp });
});

r.put('/users/:id', need('users'), async (req, res) => {
  const id = idParam(req.params.id);
  const d = parse(userSchema.partial().extend({ active: z.boolean().optional(), new_password: passwordSchema.optional() }), req.body);
  const target = await one('select id, role, name from users where id = $1 and company_id = $2', [id, req.companyId]);
  if (!target) throw notFound();
  if (target.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Só o proprietário altera o próprio acesso.');
  if (id === req.user.id && d.active === false) throw new HttpError(400, 'Você não pode desativar o próprio acesso.');
  if (d.email && await one('select 1 from users where email = $1 and id <> $2', [d.email, id])) throw new HttpError(409, 'Este e-mail já está cadastrado.');
  await tx(async (db) => {
    await db.query(`update users set name = coalesce($3, name), email = coalesce($4, email), role = case when role = 'owner' then role else coalesce($5, role) end,
       unit_id = coalesce($6, unit_id), team = coalesce($7, team), active = coalesce($8, active),
       auth_version = auth_version + case when $8 = false or ($5 is not null and $5 <> role) then 1 else 0 end
       where id = $1 and company_id = $2`, [id, req.companyId, d.name ?? null, d.email ?? null, d.role ?? null, d.unit_id ?? null, d.team ?? null, d.active ?? null]);
    if (d.new_password) await setPassword(db, id, req.companyId, d.new_password);
    await audit(db, req, { entity: 'user', entityId: id, action: 'user.update', summary: `Usuário ${target.name} alterado${d.active === false ? ' (acesso revogado)' : ''}${d.role ? ` — perfil ${ROLES[d.role]}` : ''}` });
  });
  res.json(await one('select id, name, email, role, unit_id, team, active, mfa_enabled from users where id = $1', [id]));
});

/** Redefine o segundo fator de um usuário que perdeu o autenticador (o usuário cadastra de novo no próximo acesso). */
r.post('/users/:id/reset-mfa', need('users'), async (req, res) => {
  const id = idParam(req.params.id);
  if (!['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Somente proprietário ou administrador.');
  const t = await one(`update users set mfa_enabled = false, mfa_secret = null, mfa_recovery = null, auth_version = auth_version + 1
     where id = $1 and company_id = $2 and role <> 'owner' returning name`, [id, req.companyId]);
  if (!t) throw notFound();
  await audit(null, req, { entity: 'user', entityId: id, action: 'user.mfa_reset', summary: `Verificação em duas etapas de ${t.name} redefinida` });
  res.json({ ok: true });
});

r.get('/permissions', (req, res) => res.json({ catalog: PERMISSIONS, roles: ROLES, values: req.settings.permissions }));

export default r;
