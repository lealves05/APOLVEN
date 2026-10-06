// Contrato com a central da plataforma (MASTER do ORBI) — v1 + parâmetros v1.1 — contra uma central falsa.
// Uso: DATABASE_URL=postgres://.../apolven_platform_test node scripts/platform-test.mjs   (APAGA o schema apolven do banco informado)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }
const SECRET = 'pk_teste-apolven-0123456789abcdef';
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');
const sign = (ts, method, route, body) => crypto.createHmac('sha256', SECRET).update(`${ts}\n${method}\n${route}\n${sha(body)}`).digest('hex');

let access = { status: 'TRIAL', blocked: false, features: {}, notices: [] };
const hubCalls = [];
const hub = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const route = req.url.replace(/^\/api\/hub\/v1/, '');
    const ok = req.headers['x-platform-product'] === 'apolven' && req.headers['x-platform-signature'] === sign(req.headers['x-platform-timestamp'], req.method, route, body);
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    if (!ok) return res.end('{}');
    hubCalls.push({ method: req.method, route, body: body ? JSON.parse(body) : null });
    if (route === '/mail/status') return res.end(JSON.stringify({ available: true }));
    res.end(JSON.stringify({ access }));
  });
});
await new Promise((r) => hub.listen(0, '127.0.0.1', r));
process.env.PLATFORM_HUB_URL = `http://127.0.0.1:${hub.address().port}`;
process.env.PLATFORM_SECRET = SECRET;
process.env.APOLVEN_MFA = 'off'; // este teste trata do contrato com a central; MFA é coberto no smoke

const { pool } = await import('../src/db.js');
await pool.query('drop schema if exists apolven cascade');
const { migrate } = await import('../src/migrate.js');
await migrate();
const { createApp } = await import('../src/app.js');
const { totp } = await import('../src/auth.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0; const fails = [];
const check = async (name, fn) => { try { await fn(); passed++; console.log('  ok ', name); } catch (e) { fails.push(name); console.log('  FALHOU', name, e.message); } };
async function api(method, path, body, token) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function central(method, route, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const r = await fetch(`${base}/api/platform/v1${route}`, { method, body: body || undefined, headers: { 'content-type': 'application/json',
    'x-platform-product': 'apolven', 'x-platform-timestamp': String(ts), 'x-platform-signature': sign(ts, method, route, body) } });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const reg = await api('POST', '/auth/register', { companyName: 'Corretora Teste', name: 'Dono', email: 'dono@teste.dev', password: 'Corretora2026xy' });
assert.equal(reg.status, 201, JSON.stringify(reg.data));
const token = reg.data.token; const cid = reg.data.company.id;

await check('cadastro registra a corretora na central (sem segredos)', async () => {
  const c = hubCalls.find((x) => x.route === '/tenants' && x.method === 'POST');
  assert.ok(c); assert.equal(c.body.remote_id, cid); assert.equal(c.body.password, undefined);
  assert.ok('policies_active' in c.body.metrics);
});
await check('manifesto do APOLVEN com módulos e parâmetros', async () => {
  const m = await central('GET', '/manifest');
  assert.equal(m.status, 200); assert.equal(m.data.code, 'apolven'); assert.equal(m.data.contract_minor, 1);
  assert.ok(m.data.features.multicalculo && m.data.features.comissoes);
  assert.ok(m.data.settings.tenant.some((f) => f.key === 'installments_upcomingDays'));
});
await check('assinatura inválida ou de outro produto é recusada', async () => {
  const r = await fetch(`${base}/api/platform/v1/manifest`, { headers: { 'x-platform-product': 'torven', 'x-platform-timestamp': String(Math.floor(Date.now() / 1000)), 'x-platform-signature': 'f'.repeat(64) } });
  assert.equal(r.status, 401);
});
await check('central altera parâmetros do sistema e da corretora (com auditoria)', async () => {
  const r = await central('PUT', '/settings', { values: { notice_text: 'Manutenção às 22h', notice_level: 'warn' } });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', '/auth/me', null, token)).data.notice.text, 'Manutenção às 22h');
  const p = await central('PUT', `/tenants/${cid}/settings`, { values: { quotes_comparisonLinkDays: 5, approvals_comparisonApproval: true }, reason: 'pedido' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const me = await api('GET', '/auth/me', null, token);
  assert.equal(me.data.company.settings.quotes.comparisonLinkDays, 5); assert.equal(me.data.company.settings.approvals.comparisonApproval, true);
  assert.equal((await central('PUT', `/tenants/${cid}/settings`, { values: { quotes_comparisonLinkDays: 99 } })).status, 400);
  await central('PUT', '/settings', { values: { notice_text: '' } });
});
await check('módulo fora do plano → 403 FEATURE_DISABLED; demais seguem', async () => {
  access = { status: 'ACTIVE', blocked: false, features: { comissoes: false }, notices: [] };
  await central('POST', `/tenants/${cid}/access`, { access });
  const r = await api('GET', '/v1/commissions/receivables', null, token);
  assert.equal(r.status, 403); assert.equal(r.data.code, 'FEATURE_DISABLED');
  assert.equal((await api('GET', '/v1/clients', null, token)).status, 200);
});
let linkToken;
await check('A27: assinatura restrita preserva dados, exportação e portal do cliente; não cancela seguros', async () => {
  access = { status: 'ACTIVE', blocked: false, features: {}, notices: [] };
  await central('POST', `/tenants/${cid}/access`, { access });
  const cpf = (b) => { const c = (x, w) => { const s = x.split('').reduce((a, n, i) => a + Number(n) * w[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; }; const d = c(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]); return `${b}${d}${c(b + d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
  const cl = await api('POST', '/v1/clients', { kind: 'pf', name: 'Cliente Preservado', document: cpf('529982247') }, token);
  assert.equal(cl.status, 201, JSON.stringify(cl.data));
  const inst = (await pool.query(`select id from apolven.institutions where code = 'porto'`)).rows[0].id;
  const pol = await api('POST', '/v1/policies', { client_id: cl.data.id, institution_id: inst, branch: 'auto', product_name: 'Auto', start_date: '2026-01-01', end_date: '2027-01-01', total_premium_cents: 100000, source_evidence: 'documento',
    installments: [{ number: 1, due_date: '2026-11-01', amount_cents: 100000 }] }, token);
  assert.equal(pol.status, 201, JSON.stringify(pol.data));
  linkToken = (await api('POST', '/v1/portal-links', { policy_id: pol.data.id }, token)).data.token;
  access = { status: 'SUSPENDED', blocked: true, reason: 'FINANCEIRO', features: {}, notices: [] };
  await central('POST', `/tenants/${cid}/access`, { access });
  const blocked = await api('GET', '/v1/clients', null, token);
  assert.equal(blocked.status, 402); assert.equal(blocked.data.code, 'TENANT_BLOCKED');
  assert.equal((await api('GET', '/v1/billing', null, token)).status, 200);
  const exp = await api('GET', '/v1/export', null, token);
  assert.equal(exp.status, 200); assert.ok(exp.data.clients.some((c) => c.name === 'Cliente Preservado'));
  const pub = await api('GET', `/public/parcelas/${linkToken}`);
  assert.equal(pub.status, 200, 'canal do segurado continua disponível');
  const { rows: [p] } = await pool.query('select contract_state from apolven.policies where id = $1', [pol.data.id]);
  assert.equal(p.contract_state, 'vigente');
  access = { status: 'ACTIVE', blocked: false, features: {}, notices: [] };
  await central('POST', `/tenants/${cid}/access`, { access });
  assert.equal((await api('GET', '/v1/clients', null, token)).status, 200);
});
await check('central pede senha provisória do responsável (e redefine o segundo fator)', async () => {
  await pool.query(`update apolven.users set mfa_enabled = true, mfa_secret = 'x' where company_id = $1 and role = 'owner'`, [cid]);
  const r = await central('POST', `/tenants/${cid}/owner-reset`, {});
  assert.equal(r.status, 200); assert.ok(r.data.temporary_password);
  const { rows: [u] } = await pool.query(`select mfa_enabled, mfa_secret from apolven.users where company_id = $1 and role = 'owner'`, [cid]);
  assert.equal(u.mfa_enabled, false); assert.equal(u.mfa_secret, null);
  assert.equal((await api('POST', '/auth/login', { email: 'dono@teste.dev', password: r.data.temporary_password })).status, 200);
});
await check('esqueci minha senha pela central: uso único e derruba sessões', async () => {
  const r2 = await api('POST', '/auth/register', { companyName: 'Outra Corretora', name: 'Rita Lima', email: 'rita@teste.dev', password: 'Corretora2026xy' });
  const old = r2.data.token;
  assert.equal((await api('POST', '/auth/forgot', { email: 'rita@teste.dev' })).status, 200);
  const mail = hubCalls.filter((c) => c.route === '/mail/password-reset').at(-1).body;
  const tk = new URL(`http://x${mail.path}`).searchParams.get('token');
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await api('POST', '/auth/reset', { token: tk, new_password: 'NovaSenha2026' })).status, 200);
  assert.equal((await api('POST', '/auth/reset', { token: tk, new_password: 'NovaSenha2027' })).status, 400);
  assert.equal((await api('GET', '/auth/me', null, old)).status, 401);
});
await check('demonstração não entra na central; cadastros fechados pela central', async () => {
  const n = hubCalls.filter((c) => c.route === '/tenants').length;
  // sem credenciais a demonstração não cria conta
  assert.equal((await api('POST', '/auth/demo')).status, 400);
  assert.equal((await api('POST', '/auth/demo', { name: 'Visitante', email: 'demo1@teste.dev' })).status, 400);
  assert.equal((await api('POST', '/auth/demo', { name: 'Visitante', email: 'invalido', password: 'Corretora2026xy' })).status, 400);
  const dm = await api('POST', '/auth/demo', { name: 'Visitante Demo', email: 'demo1@teste.dev', password: 'Corretora2026xy' });
  assert.equal(dm.status, 201);
  assert.equal(dm.data.company.is_demo, true);
  assert.equal(dm.data.user.email, 'demo1@teste.dev');
  // e-mail único e login real para voltar depois
  assert.equal((await api('POST', '/auth/demo', { name: 'Outro', email: 'demo1@teste.dev', password: 'Corretora2026xy' })).status, 409);
  assert.equal((await api('POST', '/auth/login', { email: 'demo1@teste.dev', password: 'Corretora2026xy' })).status, 200);
  assert.equal(hubCalls.filter((c) => c.route === '/tenants').length, n);
  await central('PUT', '/settings', { values: { signup_enabled: false, demo_enabled: false } });
  assert.equal((await api('POST', '/auth/register', { companyName: 'Fechada', name: 'Xavier', email: 'x@teste.dev', password: 'Corretora2026xy' })).status, 403);
  assert.equal((await api('POST', '/auth/demo', { name: 'Visitante', email: 'demo2@teste.dev', password: 'Corretora2026xy' })).status, 403);
  await central('PUT', '/settings', { values: { signup_enabled: true, demo_enabled: true } });
});
await check('CORS só para origem aprovada; API sem cache; segredo fraco recusado', async () => {
  const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.match(evil.headers.get('cache-control') || '', /no-store/);
  const { secretProblem } = await import('../src/auth.js');
  for (const v of [undefined, '', 'x', 'apolven-dev-secret-troque-em-producao', 'a'.repeat(64)]) assert.ok(secretProblem(v), String(v));
  assert.equal(secretProblem(crypto.randomBytes(48).toString('hex')), null);
});
await check('TOTP conforme RFC 6238 (vetor SHA-1, T=59s)', async () => {
  // segredo ASCII "12345678901234567890" → 8 dígitos 94287082; 6 dígitos = 287082
  const { base32Encode } = await import('../src/auth.js');
  assert.equal(totp(base32Encode(Buffer.from('12345678901234567890')), 59000), '287082');
});

server.close(); hub.close(); await pool.end();
console.log(`\n${passed} verificações OK, ${fails.length} falhas`);
if (fails.length) process.exit(1);
