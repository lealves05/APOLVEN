// Teste ponta a ponta do APOLVEN (API em execução com APOLVEN_TEST_ADAPTERS=1).
// Uso: API=http://localhost:3334 DATABASE_URL=... node scripts/smoke.mjs
// Cobre os exemplos financeiros da seção 16 e os casos A01–A42 aplicáveis a esta versão.
import pg from 'pg';
import { totp } from '../src/auth.js';

const API = process.env.API || 'http://localhost:3334';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/apolven' });
await db.connect();
await db.query('set search_path to apolven');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass += 1; } else { fail += 1; failures.push(name); console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
const section = (s) => console.log(`\n# ${s}`);

async function call(token, method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, Math.min(dd, 28), 12)); return t.toISOString().slice(0, 10); };
const cpf = (base) => { const c = (b, w) => { const s = b.split('').reduce((a, n, i) => a + Number(n) * w[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; }; const d1 = c(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base}${d1}${c(base + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const cnpj = (base) => { const c = (b, w) => { const s = b.split('').reduce((a, n, i) => a + Number(n) * w[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; }; const d1 = c(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base}${d1}${c(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const randDigits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/** Cadastra corretora, ativa o MFA (obrigatório ao proprietário) e devolve sessão com segundo fator. */
async function registerBroker(label) {
  const email = `owner-${label}-${rnd}@teste.apolven`;
  const password = `Senha${rnd}Forte9`;
  const r = await call(null, 'POST', '/api/auth/register', { companyName: `Corretora ${label} ${rnd}`, name: `Dono ${label}`, email, password });
  ok(r.status === 201 && r.data.mfa_setup_required === true, `${label}: cadastro exige configurar MFA`, r.data);
  const blocked = await call(r.data.token, 'GET', '/api/v1/clients');
  ok(blocked.status === 403 && blocked.data.code === 'MFA_SETUP_REQUIRED', `${label}: sem MFA, perfil crítico não acessa dados`, blocked.data);
  const setup = await call(r.data.token, 'POST', '/api/auth/mfa/setup', {});
  const en = await call(r.data.token, 'POST', '/api/auth/mfa/enable', { code: totp(setup.data.secret) });
  ok(en.status === 200 && en.data.recovery_codes?.length === 8, `${label}: MFA ativado com códigos de recuperação`, en.data);
  const old = await call(r.data.token, 'GET', '/api/auth/me');
  ok(old.status === 401, `${label}: token anterior ao MFA deixa de valer`);
  return { token: en.data.token, secret: setup.data.secret, email, password, companyId: en.data.company.id, userId: en.data.user.id };
}

// =====================================================================
section('Autenticação, MFA e isolamento básico');
const A = await registerBroker('A');
const B = await registerBroker('B');
{
  const l1 = await call(null, 'POST', '/api/auth/login', { email: A.email, password: A.password });
  ok(l1.data.mfa_required && !l1.data.token, 'login com MFA não entrega token antes do código');
  const bad = await call(null, 'POST', '/api/auth/mfa/verify', { challenge: l1.data.challenge, code: '000000' });
  ok(bad.status === 401, 'código errado recusado');
  const good = await call(null, 'POST', '/api/auth/mfa/verify', { challenge: l1.data.challenge, code: totp(A.secret) });
  ok(good.status === 200 && good.data.token, 'código correto conclui o login');
  A.token = good.data.token;
}
const T = A.token;
{
  const r = await call(T, 'PUT', '/api/v1/company', { document: cnpj(randDigits(8) + '0001'), susep_code: '10.2030405', tech_responsible_name: 'Fulana Técnica', email: 'contato@corretora.teste' });
  ok(r.status === 200 && r.data.susep_code === '10.2030405', 'dados da corretora salvos (reaproveitados no credenciamento)', r.data);
  const w = await call(T, 'PUT', '/api/v1/company', { settings: { scoring: { coverage: 45, cost: 30, deductible: 15, assistance: 10, commission: 5 } } });
  ok(w.status === 400, 'comissão não pode ser critério da comparação (2.2-12)');
}

// =====================================================================
section('Clientes, duplicidade e consentimentos');
const docAna = cpf(randDigits(9));
const ana = (await call(T, 'POST', '/api/v1/clients', { kind: 'pf', name: 'Ana Teste', document: docAna, email: 'ana@teste.com', phone: '(19) 99999-0001' })).data;
ok(ana.id && ana.document === docAna, 'cliente cadastrado');
{
  const dup = await call(T, 'POST', '/api/v1/clients', { kind: 'pf', name: 'Ana Outra', document: docAna });
  ok(dup.status === 409 && dup.data.code === 'DUPLICATE_CLIENT', 'duplicidade por documento normalizado dentro do tenant');
  const inv = await call(T, 'POST', '/api/v1/clients', { kind: 'pf', name: 'X Y', document: '11111111111' });
  ok(inv.status === 400, 'CPF inválido recusado');
  const sameInB = await call(B.token, 'POST', '/api/v1/clients', { kind: 'pf', name: 'Ana em B', document: docAna });
  ok(sameInB.status === 201, 'mesmo documento em outra corretora é outro cadastro (isolamento)');
  const c = await call(T, 'POST', `/api/v1/clients/${ana.id}/consents`, { purpose: 'cotacao', legal_basis: 'procedimentos preliminares', evidence: 'autorização por e-mail em 05/10' });
  ok(c.status === 201, 'autorização para cotação registrada');
  const oi = await call(T, 'POST', `/api/v1/clients/${ana.id}/consents`, { purpose: 'open_insurance', evidence: 'teste teste' });
  ok(oi.status === 400, 'consentimento Open Insurance não é registrado pelo CRM (7.4)');
  const v = await call(T, 'PUT', `/api/v1/clients/${ana.id}`, { version: 99, phone: '1' });
  ok(v.status === 409 && v.data.code === 'VERSION_CONFLICT', 'controle otimista de versão');
}
const bruno = (await call(T, 'POST', '/api/v1/clients', { kind: 'pf', name: 'Bruno Teste', document: cpf(randDigits(9)) })).data;
await call(T, 'POST', `/api/v1/clients/${bruno.id}/consents`, { purpose: 'cotacao', evidence: 'autorização verbal registrada' });

section('A01 / A02 — isolamento entre corretoras');
{
  const r1 = await call(B.token, 'GET', `/api/v1/clients/${ana.id}`);
  ok(r1.status === 404, 'A01: outra corretora não lê cliente por ID');
  const r2 = await call(B.token, 'PUT', `/api/v1/clients/${ana.id}`, { version: 1, name: 'invasão' });
  ok(r2.status === 404, 'A01: nem altera');
  const r3 = await call(B.token, 'GET', `/api/v1/search?q=Ana`);
  ok(!JSON.stringify(r3.data).includes(ana.id), 'A01: busca não vaza');
  let fkErr = null;
  try {
    await db.query(`insert into policies (company_id, client_id, institution_id, product_name, branch, start_date, end_date, total_premium_cents)
      values ($1, $2, (select id from institutions where code='porto'), 'x', 'auto', current_date, current_date + 365, 100)`, [B.companyId, ana.id]);
  } catch (e) { fkErr = e.code; }
  ok(fkErr === '23503', 'A02: banco rejeita apólice de uma corretora ligada a cliente de outra', fkErr);
  const r4 = await call(B.token, 'POST', '/api/v1/policies', { client_id: ana.id, institution_id: (await db.query(`select id from institutions where code='porto'`)).rows[0].id, branch: 'auto', product_name: 'Auto', start_date: today, end_date: addMonths(today, 12), total_premium_cents: 100, source_evidence: 'teste' });
  ok(r4.status === 404, 'A02: API rejeita o vínculo cruzado', r4);
}

// =====================================================================
section('Seguradoras e Integrações (Anexo C)');
const inst = Object.fromEntries((await db.query(`select code, id from institutions where company_id is null`)).rows.map((x) => [x.code, x.id]));
{
  const cat = await call(T, 'GET', '/api/v1/integrations/catalog?q=porto');
  const porto = cat.data.institutions.find((i) => i.code === 'porto');
  ok(porto && porto.paths.some((p) => p.code === 'porto_api' && !p.adapter_available), 'catálogo mostra o caminho Porto API sem adaptador pronto');
}
// A31/A32: empresa conhecida, sem conector implementado
const portoConn = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.porto, template_code: 'porto_api', products: ['auto'], accreditation: 'nao' })).data;
ok(portoConn.id && portoConn.technical_state === 'sem_conector' && portoConn.message, 'A32: cadastro sem conector vira fluxo assistido', portoConn);
{
  const det = await call(T, 'GET', `/api/v1/integrations/connections/${portoConn.id}`);
  ok(det.data.company?.susep_code === '10.2030405' && det.data.requirements.some((x) => x.code === 'app_aprovado'), 'A31: dados da corretora reaproveitados e checklist do template', det.data.company);
  const dupe = await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.porto, template_code: 'porto_api', products: ['auto'] });
  ok(dupe.status === 409 && dupe.data.code === 'CONNECTION_EXISTS', 'clique repetido não duplica a conexão');
  const cred = await call(T, 'PUT', `/api/v1/integrations/connections/${portoConn.id}/credentials`, { values: { client_id: 'x', client_secret: 'y' }, mfa_code: totp(A.secret) });
  ok(cred.status === 409 && cred.data.code === 'CONNECTOR_NOT_AVAILABLE', 'A32: sem adaptador, nenhum segredo é pedido/salvo');
  const test = await call(T, 'POST', `/api/v1/integrations/connections/${portoConn.id}/connection-tests`, {});
  ok(test.data.code === 'CONNECTOR_NOT_AVAILABLE', 'teste informa ausência de conector');
  const act = await call(T, 'POST', `/api/v1/integrations/connections/${portoConn.id}/capabilities/activate`, { capabilities: ['cotacao'] });
  ok(act.data.cotacao?.ok === false, 'nenhuma função ativada sem conector', act.data);
  const wrong = await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.tokio_marine, template_code: 'porto_api' });
  ok(wrong.status === 400, 'A41: template de outra empresa recusado pelo servidor');
  const txt = await call(T, 'POST', `/api/v1/integrations/connections/${portoConn.id}/request-text`, {});
  ok(txt.status === 200 && !/secret|senha|token/i.test(txt.data.text), 'texto de solicitação sem segredos');
}
// assistida com credenciamento (Tokio)
const tokioConn = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.tokio_marine, template_code: 'assistida', products: ['auto', 'residencial'], accreditation: 'sim', environment: 'producao' })).data;
ok(tokioConn.id, 'conexão assistida da Tokio');

/** Instituição + conector de teste com credencial, teste e ativação em produção. */
async function autoConnection(name, brokerCode, clientId = 'cli-ok-123') {
  const i = (await call(T, 'POST', '/api/v1/integrations/institutions', { kind: 'seguradora', name: `${name} ${rnd}` })).data;
  const c = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: i.id, template_code: 'teste_interno', products: ['auto'], accreditation: 'nao', broker_code: brokerCode, environment: 'testes' })).data;
  return { inst: i, conn: c };
}
const X = await autoConnection('Seguradora Teste', 'ABC-1');
{
  const noReauth = await call(T, 'PUT', `/api/v1/integrations/connections/${X.conn.id}/credentials`, { values: { client_id: 'cli-ok-123', client_secret: 'SEGREDO-SUPER-123' } });
  ok(noReauth.status === 401 && noReauth.data.code === 'REAUTH_REQUIRED', 'credencial exige reautenticação (MFA)');
  const extra = await call(T, 'PUT', `/api/v1/integrations/connections/${X.conn.id}/credentials`, { values: { client_id: 'a', client_secret: 'b', endpoint: 'https://evil.example' }, mfa_code: totp(A.secret) });
  ok(extra.status === 400, 'A41: campo de destino/endpoint não aceito do formulário');
  const cr = await call(T, 'PUT', `/api/v1/integrations/connections/${X.conn.id}/credentials`, { values: { client_id: 'cli-ok-123', client_secret: 'SEGREDO-SUPER-123' }, mfa_code: totp(A.secret) });
  ok(cr.status === 200 && !cr.text.includes('SEGREDO-SUPER-123'), 'A34: resposta sem o segredo', cr.data);
  const det = await call(T, 'GET', `/api/v1/integrations/connections/${X.conn.id}`);
  ok(!det.text.includes('SEGREDO-SUPER-123') && !det.text.includes('cli-ok-123'), 'A34: reabrir a tela não devolve segredo nem identificador completo');
  const exp = await call(T, 'GET', '/api/v1/export');
  ok(exp.status === 200 && !exp.text.includes('SEGREDO-SUPER-123') && !exp.text.includes('"sealed"'), 'A34: exportação sem segredos', [exp.status, exp.text.slice(0, 200)]);
  const { rows: [stored] } = await db.query('select sealed from credential_versions where connection_id = $1', [X.conn.id]);
  ok(stored && !stored.sealed.includes('SEGREDO'), 'segredo cifrado no banco');
  const t1 = await call(T, 'POST', `/api/v1/integrations/connections/${X.conn.id}/connection-tests`, {});
  ok(t1.data.results.autenticacao === 'valida' && t1.data.results.capacidades.cotacao === 'autorizada', 'teste seguro: autenticação e capacidade', t1.data.results);
  const a1 = await call(T, 'POST', `/api/v1/integrations/connections/${X.conn.id}/capabilities/activate`, { capabilities: ['cotacao'] });
  ok(a1.data.cotacao.ok === false && a1.data.cotacao.reasons.some((x) => /credenciamento/i.test(x)), 'autenticação válida não basta: falta credenciamento (C.10)', a1.data);
  const ver = (await call(T, 'GET', `/api/v1/integrations/connections/${X.conn.id}`)).data.version;
  await call(T, 'PATCH', `/api/v1/integrations/connections/${X.conn.id}`, { version: ver, accreditation: 'sim', commercial_state: 'aprovado', commercial_evidence: 'e-mail da seguradora 01/10' });
  await call(T, 'PUT', `/api/v1/integrations/connections/${X.conn.id}/requirements/credenciamento`, { status: 'confirmado', protocol: 'CRED-1' });
  const a2 = await call(T, 'POST', `/api/v1/integrations/connections/${X.conn.id}/capabilities/activate`, { capabilities: ['cotacao', 'transmissao'] });
  ok(a2.data.cotacao.ok === true && a2.data.cotacao.note && a2.data.transmissao.ok === false, 'cotação ativada só em testes; transmissão não autorizada continua bloqueada', a2.data);
  const el = await call(T, 'GET', '/api/v1/catalog/eligible?branch=auto');
  ok(el.data.eligible.find((e) => e.connection_id === X.conn.id)?.mode === 'assistida', 'A35: ativação em sandbox não entra no multicálculo real', el.data);
  // produção
  const v2 = (await call(T, 'GET', `/api/v1/integrations/connections/${X.conn.id}`)).data.version;
  await call(T, 'PATCH', `/api/v1/integrations/connections/${X.conn.id}`, { version: v2, environment: 'producao' });
  const caps = (await call(T, 'GET', `/api/v1/integrations/connections/${X.conn.id}`)).data.capability_list;
  ok(caps.every((c) => c.state !== 'ativa'), 'troca de ambiente invalida validações do escopo');
  await call(T, 'POST', `/api/v1/integrations/connections/${X.conn.id}/connection-tests`, {});
  const a3 = await call(T, 'POST', `/api/v1/integrations/connections/${X.conn.id}/capabilities/activate`, { capabilities: ['cotacao'] });
  ok(a3.data.cotacao.ok === true && !a3.data.cotacao.note, 'cotação ativa em produção');
  const el2 = await call(T, 'GET', '/api/v1/catalog/eligible?branch=auto');
  ok(el2.data.eligible.find((e) => e.connection_id === X.conn.id)?.mode === 'automatica', 'conexão homologada entra no multicálculo automático');
}
// A33 / A38
{
  const Y = await autoConnection('Seguradora SemCotacao', 'DEF-1');
  await call(T, 'PUT', `/api/v1/integrations/connections/${Y.conn.id}/credentials`, { values: { client_id: 'cli-semcotacao', client_secret: 's' }, mfa_code: totp(A.secret) });
  const t = await call(T, 'POST', `/api/v1/integrations/connections/${Y.conn.id}/connection-tests`, {});
  const caps = (await call(T, 'GET', `/api/v1/integrations/connections/${Y.conn.id}`)).data.capability_list;
  ok(t.data.results.autenticacao === 'valida' && caps.find((c) => c.capability === 'cotacao').state === 'bloqueada', 'A33: token válido, cotação não autorizada — sem estado enganoso');
  const Z = await autoConnection('Seguradora Divergente', 'GHI-1');
  await call(T, 'PUT', `/api/v1/integrations/connections/${Z.conn.id}/credentials`, { values: { client_id: 'cli-divergente', client_secret: 's' }, mfa_code: totp(A.secret) });
  const tz = await call(T, 'POST', `/api/v1/integrations/connections/${Z.conn.id}/connection-tests`, {});
  ok(tz.data.code === 'BROKER_IDENTITY_MISMATCH' && tz.data.results.vinculo === 'divergente', 'A38: identificação divergente bloqueia ativação', tz.data);
  const ev = await call(T, 'POST', `/api/v1/integrations/connections/${Z.conn.id}/capabilities/cotacao/evidence`, { evidence: 'tentativa de contornar' });
  ok(ev.status === 409, 'A38: evidência manual não contorna divergência');
}
// A42 / A36: Bradesco via parceiro × API direta
{
  const partner = (await call(T, 'POST', '/api/v1/integrations/institutions', { kind: 'parceiro_tecnologico', name: `Multicálculo Parceiro ${rnd}` })).data;
  const pc = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: partner.id, template_code: 'multicalculo_parceiro' })).data;
  ok(pc.id, 'conexão com parceiro de multicálculo');
  const noPartner = await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.bradesco_seguros, template_code: 'multicalculo_parceiro' });
  ok(noPartner.status === 400, 'via parceiro exige escolher a conexão do parceiro');
  const via = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.bradesco_seguros, template_code: 'multicalculo_parceiro', partner_connection_id: pc.id, accreditation: 'sim', environment: 'producao', products: ['empresarial'] })).data;
  const direct = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: inst.bradesco_seguros, template_code: 'bradesco_re_api', accreditation: 'sim', environment: 'producao', products: ['empresarial'] })).data;
  const dv = (await call(T, 'GET', `/api/v1/integrations/connections/${via.id}`)).data;
  const dd = (await call(T, 'GET', `/api/v1/integrations/connections/${direct.id}`)).data;
  ok(dv.requirements.some((x) => x.code === 'vinculo_companhias') && !dv.requirements.some((x) => x.code === 'certificado_mtls')
    && dd.requirements.some((x) => x.code === 'certificado_mtls'), 'A42: requisitos do caminho via parceiro não se misturam com os da API direta');
  const el = await call(T, 'GET', '/api/v1/catalog/eligible?branch=empresarial');
  const keys = new Set(el.data.eligible.filter((e) => e.institution_id === inst.bradesco_seguros).map((e) => e.institution_id));
  ok(el.data.eligible.filter((e) => e.institution_id === inst.bradesco_seguros).length === 2 && keys.size === 1, 'A36: mesma companhia por dois caminhos = vínculos separados, uma identidade');
}

// =====================================================================
section('Multicálculo (8) e comparação');
const FAIL = await autoConnection('Seguradora Instável', 'FALHA');
await call(T, 'PUT', `/api/v1/integrations/connections/${FAIL.conn.id}/credentials`, { values: { client_id: 'cli-ok-9', client_secret: 's' }, mfa_code: totp(A.secret) });
{
  const v = (await call(T, 'GET', `/api/v1/integrations/connections/${FAIL.conn.id}`)).data.version;
  await call(T, 'PATCH', `/api/v1/integrations/connections/${FAIL.conn.id}`, { version: v, accreditation: 'sim', commercial_state: 'aprovado', commercial_evidence: 'contrato', environment: 'producao' });
  await call(T, 'PUT', `/api/v1/integrations/connections/${FAIL.conn.id}/requirements/credenciamento`, { status: 'confirmado', protocol: 'C2' });
  await call(T, 'POST', `/api/v1/integrations/connections/${FAIL.conn.id}/connection-tests`, {});
  await call(T, 'POST', `/api/v1/integrations/connections/${FAIL.conn.id}/capabilities/activate`, { capabilities: ['cotacao'] });
}
const risk = { marca_modelo: 'Hatch 1.0', ano_modelo: 2025, uso: 'particular', cep_pernoite: '13010-000', condutor_principal: 'Ana Teste' };
const minCov = [{ code: 'casco', name: 'Casco', min_limit_cents: null, required: true }, { code: 'rcf_dm', name: 'RCF DM', min_limit_cents: 10000000, required: true }];
let qr;
{
  const ins = await call(T, 'POST', '/api/v1/quote-requests', { client_id: ana.id, branch: 'auto', risk: { marca_modelo: 'x' }, min_coverages: minCov, sharing_basis: 'autorização do cliente' });
  ok(ins.status === 400 && ins.data.code === 'INSUFFICIENT_DATA', 'dados insuficientes: lista o que falta, sem preencher por conta própria', ins.data);
  const none = await call(T, 'POST', '/api/v1/quote-requests', { client_id: ana.id, branch: 'rural', risk: { atividade: 'café', municipio: 'Campinas' }, sharing_basis: 'autorização' });
  ok(none.status === 409 && none.data.code === 'NO_ELIGIBLE_SOURCE', 'A04: sem fonte configurada, nenhum resultado fictício');
  const r = await call(T, 'POST', '/api/v1/quote-requests', { client_id: ana.id, branch: 'auto', risk, min_coverages: minCov, start_date: addDays(today, 5), end_date: addMonths(addDays(today, 5), 12), sharing_basis: 'autorização do cliente por e-mail' });
  ok(r.status === 202 && r.data.round.round_no === 1, 'rodada criada sem esperar as fontes (202)', r.data);
  qr = r.data.request;
  const round = r.data.round;
  const run = await call(T, 'POST', `/api/v1/quote-requests/${qr.id}/rounds/${round.id}/run`, {});
  const auto = run.data.tasks.find((t) => t.connection_id === X.conn.id);
  const bad = run.data.tasks.find((t) => t.connection_id === FAIL.conn.id);
  ok(auto?.status === 'cotacao_valida', 'tarefa automática retornou cotação válida', run.data.tasks.map((t) => [t.institution_name, t.status]));
  ok(bad?.status === 'fonte_indisponivel' && bad.status !== 'recusa_informada', 'A05: falha técnica não vira recusa');
  ok(run.data.summary.partial === true && run.data.offers.length === 1, 'A05: resultado útil exibido com pesquisa parcial', run.data.summary);
  // assistida (Tokio)
  const tk = run.data.tasks.find((t) => t.connection_id === tokioConn.id);
  ok(tk?.mode === 'assistida' && tk.status === 'pendente_assistida', 'fonte sem conector vira consulta assistida');
  const rec = await call(T, 'PUT', `/api/v1/quote-requests/tasks/${tk.id}`, { status: 'recusa_informada', reason: 'fora de política' });
  ok(rec.status === 400, 'recusa exige motivo e protocolo da seguradora');
  const noDoc = await call(T, 'POST', `/api/v1/quote-requests/tasks/${tk.id}/offers`, { product_name: 'Auto Tokio', quote_kind: 'cotacao_valida', origin: 'documento_formal', valid_until: addDays(today, 10), total_premium_cents: 199000, coverages: [] });
  ok(noDoc.status === 400, 'cotação válida assistida exige cotação formal anexada (6.2)');
  const mism = await call(T, 'POST', `/api/v1/quote-requests/tasks/${tk.id}/offers`, { product_name: 'Auto Tokio', quote_kind: 'cotacao_valida', origin: 'informada_pela_seguradora', external_id: 'TK-1', valid_until: addDays(today, 10), total_premium_cents: 199000, premium_net_cents: 150000, taxes_cents: 10000, fees_cents: 0, coverages: [] });
  ok(mism.status === 400, 'identidade financeira validada quando os componentes são informados');
  // A08: oferta barata sem cobertura mínima
  const cheap = await call(T, 'POST', `/api/v1/quote-requests/tasks/${tk.id}/offers`, { product_name: 'Auto Tokio Básico', quote_kind: 'cotacao_valida', origin: 'informada_pela_seguradora', external_id: 'TK-2', valid_until: addDays(today, 10),
    total_premium_cents: 99000, coverages: [{ code: 'casco', name: 'Casco', limit_cents: null }], payment_options: [{ method: 'boleto', installments: 1, total_cents: 99000 }], commission_rate: 25, commission_source: 'retornada' });
  ok(cheap.status === 201, 'oferta assistida registrada com origem', cheap.data);
  const view = await call(T, 'GET', `/api/v1/quote-requests/${qr.id}`);
  const cheapRow = view.data.round.offers.find((o) => o.id === cheap.data.id);
  ok(cheapRow.comparison.klass === 'incompativel' && view.data.round.badges.lowest_cost !== cheap.data.id && view.data.round.badges.best_fit !== cheap.data.id, 'A08: oferta barata incompatível não é "melhor adequada"', view.data.round.badges);
  ok(cheapRow.score === null, 'incompatível fica fora da pontuação');
  // A07/A36 contagem: seguradora "Teste" e "Instável" e Tokio são 3 identidades
  ok(view.data.round.summary.eligible === 3, 'contagem de seguradoras elegíveis por identidade', view.data.round.summary);
  // A06: nova rodada; resultado tardio fica na rodada original
  const r2 = await call(T, 'POST', `/api/v1/quote-requests/${qr.id}/rounds`, { risk, min_coverages: minCov, sharing_basis: 'autorização' });
  ok(r2.status === 202 && r2.data.round.round_no === 2, 'nova rodada (recálculo) sem alterar a anterior');
  const late = await call(T, 'POST', `/api/v1/quote-requests/${qr.id}/rounds/${round.id}/run`, {});
  const r2view = await call(T, 'GET', `/api/v1/quote-requests/${qr.id}?round=${r2.data.round.id}`);
  ok(late.data.offers.length >= 2 && r2view.data.round.offers.length === 0, 'A06: respostas da rodada 1 não se misturam à rodada 2');
  let immut = null;
  try { await db.query(`update quote_rounds set risk_data = '{}' where id = $1`, [round.id]); } catch (e) { immut = e.code; }
  ok(immut === 'P0001', 'rodada imutável no banco');
  let offerLock = null;
  try { await db.query(`update quote_offers set total_premium_cents = 1 where id = $1`, [cheap.data.id]); } catch (e) { offerLock = e.code; }
  ok(offerLock === 'P0001', 'preço recebido não pode ser editado localmente (9.3)');
  qr.round1 = round;
}
// A25: consentimento revogado antes da execução
{
  const r = await call(T, 'POST', '/api/v1/quote-requests', { client_id: bruno.id, branch: 'auto', risk: { ...risk, condutor_principal: 'Bruno' }, min_coverages: minCov, sharing_basis: 'autorização' });
  const cons = (await call(T, 'GET', `/api/v1/clients/${bruno.id}`)).data.consents.find((c) => c.purpose === 'cotacao');
  await call(T, 'POST', `/api/v1/clients/${bruno.id}/consents/${cons.id}/revoke`, { reason: 'cliente pediu' });
  const run = await call(T, 'POST', `/api/v1/quote-requests/${r.data.request.id}/rounds/${r.data.round.id}/run`, {});
  const autoTasks = run.data.tasks.filter((t) => t.mode === 'automatica');
  ok(autoTasks.length && autoTasks.every((t) => t.status === 'autorizacao_expirada') && run.data.offers.length === 0, 'A25: revogação antes da execução impede o compartilhamento', autoTasks.map((t) => t.status));
  const again = await call(T, 'POST', '/api/v1/quote-requests', { client_id: bruno.id, branch: 'auto', risk, min_coverages: minCov, sharing_basis: 'x x x' });
  ok(again.status === 409 && again.data.code === 'CONSENT_REVOKED', 'nova cotação bloqueada após revogação');
}

// =====================================================================
section('Comparativo, portal do cliente e proposta (9)');
let proposal;
{
  const view = await call(T, 'GET', `/api/v1/quote-requests/${qr.id}?round=${qr.round1.id}`);
  const valid = view.data.round.offers.filter((o) => o.comparison.klass !== 'incompativel');
  const cmp = await call(T, 'POST', '/api/v1/comparisons', { round_id: qr.round1.id, offer_ids: view.data.round.offers.map((o) => o.id), message: 'Segue o comparativo.' });
  ok(cmp.status === 201, 'comparativo criado', cmp.data);
  const link = await call(T, 'POST', `/api/v1/comparisons/${cmp.data.id}/link`, {});
  ok(link.status === 201 && /^\/p\/comparativo\/[0-9a-f]{48}$/.test(link.data.path), 'link temporário com token');
  const pub = await call(null, 'GET', `/api/public/comparativo/${link.data.token}`);
  ok(pub.status === 200 && !/commission/i.test(pub.text) && pub.data.offers.length === view.data.round.offers.length, 'portal: comparativo sem comissão nem dados internos', Object.keys(pub.data));
  const badTok = await call(null, 'GET', `/api/public/comparativo/${'0'.repeat(48)}`);
  ok(badTok.status === 410, 'token inválido não dá acesso');
  const noAuth = await call(null, 'POST', `/api/public/comparativo/${link.data.token}/choose`, { offer_id: valid[0].id, name: 'Ana Teste' });
  ok(noAuth.status === 400, 'escolha exige autorização expressa');
  const choose = await call(null, 'POST', `/api/public/comparativo/${link.data.token}/choose`, { offer_id: valid[0].id, payment_option: valid[0].payment_options[0]?.id, name: 'Ana Teste', authorize: true });
  ok(choose.status === 200 && /aceitação da seguradora/.test(choose.data.message), 'A11: escolha registrada sem afirmar contratação', choose.data);
  const p = await call(T, 'POST', '/api/v1/proposals', { offer_id: valid[0].id, comparison_id: cmp.data.id });
  ok(p.status === 201 && p.data.status === 'autorizada_cliente', 'proposta da opção escolhida, autorizada pelo cliente no portal', p.data.status);
  proposal = p.data;
  const sub0 = await call(T, 'POST', `/api/v1/proposals/${proposal.id}/submit`, {});
  ok(sub0.status === 400 && sub0.data.code === 'ASSISTED_PROTOCOL_REQUIRED', 'sem transmissão automática ativa: transmissão assistida com protocolo');
  const sub = await call(T, 'POST', `/api/v1/proposals/${proposal.id}/submit`, { protocol: 'PRT-778899', evidence: 'enviado pelo portal da seguradora' }, { 'idempotency-key': `sub-${rnd}-0001` });
  ok(sub.status === 200, 'proposta transmitida (assistida)', sub.data);
  const sub2 = await call(T, 'POST', `/api/v1/proposals/${proposal.id}/submit`, { protocol: 'PRT-OUTRO' });
  ok(sub2.status === 409, 'A10: sem retransmissão cega / duplicada', sub2.data);
  const acc0 = await call(T, 'POST', `/api/v1/proposals/${proposal.id}/status`, { status: 'aceita' });
  ok(acc0.status === 400, 'aceite exige evidência');
  await call(T, 'POST', `/api/v1/proposals/${proposal.id}/status`, { status: 'em_analise', source: 'fornecedor', protocol: 'PRT-778899' });
  const acc = await call(T, 'POST', `/api/v1/proposals/${proposal.id}/status`, { status: 'aceita', evidence: 'e-mail de aceite da seguradora' });
  ok(acc.status === 200, 'aceite registrado com evidência (separado da emissão)');
  // A12: documento emitido diverge do autorizado
  const pol = await call(T, 'POST', `/api/v1/proposals/${proposal.id}/policy`, { policy_number: `AP-${rnd}`, start_date: addDays(today, 5), end_date: addMonths(addDays(today, 5), 12), total_premium_cents: valid[0].total_premium_cents + 1000, coverages: valid[0].coverages });
  ok(pol.status === 201 && pol.data.divergences.some((d) => d.field === 'prêmio total') && pol.data.policy.doc_state === 'divergente', 'A12: documento divergente gera pendência', pol.data.divergences);
  const vf = await call(T, 'POST', `/api/v1/policies/${pol.data.policy.id}/verify`, {});
  ok(vf.status === 409 && vf.data.code === 'DIVERGENCE_OPEN', 'A12: não conferida com divergência aberta');
  const vf2 = await call(T, 'POST', `/api/v1/policies/${pol.data.policy.id}/verify`, { resolution: 'Endosso de correção solicitado à seguradora (protocolo E-1)' });
  ok(vf2.status === 200, 'conferência com resolução registrada');
  const ed = await call(T, 'PUT', `/api/v1/policies/${pol.data.policy.id}`, { reason: 'teste', version: 99, total_premium_cents: 1 });
  ok(ed.status === 409, 'apólice conferida não é sobrescrita (exige endosso)');
}
// A09: cotação vencida antes da proposta
{
  const t = (await db.query('select id, institution_id from quote_tasks where round_id = $1 limit 1', [qr.round1.id])).rows[0];
  const { rows: [o] } = await db.query(`insert into quote_offers (company_id, round_id, task_id, institution_id, product_name, origin, quote_kind, valid_until, total_premium_cents)
    values ($1,$2,$3,$4,'Vencida','informada_pela_seguradora','cotacao_valida',current_date - 1, 1000) returning id`, [A.companyId, qr.round1.id, t.id, t.institution_id]);
  const p = await call(T, 'POST', '/api/v1/proposals', { offer_id: o.id });
  ok(p.status === 409 && p.data.code === 'QUOTE_EXPIRED', 'A09: cotação vencida exige recálculo');
}

// =====================================================================
section('Exemplos financeiros 16.1–16.4 e casos A13–A22');
const portoId = inst.porto;
const portoAssist = (await call(T, 'POST', '/api/v1/integrations/connections', { institution_id: portoId, template_code: 'assistida', accreditation: 'sim', products: ['auto'] })).data;
ok(portoAssist.id, 'Porto também por operação assistida (conexão separada)');
const agr = (await call(T, 'POST', '/api/v1/commissions/agreements', { institution_id: portoId, name: 'Porto Auto', branch: 'auto' })).data;
const rule1 = (await call(T, 'POST', `/api/v1/commissions/agreements/${agr.id}/versions`, { kind: 'percentual', rate: 20, base_definition: 'outra', base_notes: 'Base acordada', schedule: 'parcelada', installments: 6, valid_from: addMonths(today, -24) })).data;
ok(rule1.version === 1, 'regra de comissão v1 (20%, 6 parcelas)');
const prod = (await call(T, 'POST', '/api/v1/partners', { kind: 'produtor', name: 'Produtor Teste', bank_info: { holder: 'Produtor Teste', holder_document: '00000000000', bank: 'Banco', agency: '1', account: '123' } })).data;
const srule = (await call(T, 'POST', '/api/v1/splits/rules', { partner_id: prod.id, name: 'Produção', kind: 'percentual', rate: 30, base: 'recebimento_efetivo' })).data;
// 16.1: prêmio 3.600 em 6×600; base 3.000; comissão 20% = 600 em 6×100; repasse 30% do recebido
const pol161 = (await call(T, 'POST', '/api/v1/policies', { client_id: ana.id, institution_id: portoId, branch: 'auto', product_name: 'Auto', policy_number: `P161-${rnd}`, start_date: addMonths(today, -6), end_date: addMonths(today, 6),
  total_premium_cents: 360000, source_evidence: 'documento da seguradora', installments: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, due_date: addMonths(today, -6 + i), amount_cents: 60000 })),
  commission: { rule_version_id: rule1.id, base_cents: 300000 } })).data;
ok(pol161.id, 'apólice do exemplo 16.1');
{
  const sp = await call(T, 'POST', `/api/v1/policies/${pol161.id}/splits`, { rule_version_id: srule.id });
  ok(sp.status === 201 && sp.data.validation.ok, 'repasse de 30% vinculado dentro do orçamento');
  const p2 = (await call(T, 'POST', '/api/v1/partners', { kind: 'assessoria', name: 'Assessoria X' })).data;
  const r80 = (await call(T, 'POST', '/api/v1/splits/rules', { partner_id: p2.id, name: 'Assessoria 80', kind: 'percentual', rate: 80, base: 'recebimento_efetivo' })).data;
  const over = await call(T, 'POST', `/api/v1/policies/${pol161.id}/splits`, { rule_version_id: r80.id });
  ok(over.status === 409 && over.data.code === 'SPLIT_BUDGET', 'A19: 30% + 80% na mesma base e etapa passa de 100% → recusado');
  const fx = (await call(T, 'POST', '/api/v1/splits/rules', { partner_id: p2.id, name: 'Fixo alto', kind: 'fixo', fixed_cents: 50000, base: 'comissao_bruta', stage: 2 })).data;
  const overFx = await call(T, 'POST', `/api/v1/policies/${pol161.id}/splits`, { rule_version_id: fx.id });
  ok(overFx.status === 409, 'A19: valor fixo validado pelo efeito em dinheiro (180 + 500 > 600)', overFx.data);
}
const recvList = async (policyId) => (await call(T, 'GET', `/api/v1/commissions/receivables?policy_id=${policyId}`)).data.items.sort((a, b) => a.installment_no - b.installment_no);
let recs = await recvList(pol161.id);
ok(recs.length === 6 && recs.every((r) => r.expected_cents === 10000 && r.status === 'prevista'), '16.1: comissão 600 = 6 × 100 previstas', recs.map((r) => r.expected_cents));
{
  const det = await call(T, 'GET', `/api/v1/policies/${pol161.id}`);
  for (const i of det.data.installments) {
    await call(T, 'POST', `/api/v1/premium-installments/${i.id}/payments`, { kind: 'confirmado', amount_cents: 60000, paid_date: i.due_date < today ? i.due_date : today, source: 'seguradora_portal', evidence: 'consulta ao portal' });
  }
  const det2 = await call(T, 'GET', `/api/v1/policies/${pol161.id}`);
  ok(det2.data.installments.every((i) => i.status === 'pagamento_confirmado'), '16.1: cliente pagou 3.600 (confirmado pela seguradora)');
  recs = await recvList(pol161.id);
  ok(recs.every((r) => r.status === 'prevista' && Number(r.allocated_cents) === 0), 'A13: parcela quitada não liquida comissão');
  const over = await call(T, 'POST', `/api/v1/premium-installments/${det.data.installments[0].id}/payments`, { kind: 'confirmado', amount_cents: 100, paid_date: today, source: 'seguradora_api', evidence: 'x' });
  ok(over.status === 409, 'pagamento acima do saldo bloqueado');
}
let st1;
{
  // A16: um depósito liquida três comissões
  const s = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 30000, confirm_missing: true,
    allocations: recs.slice(0, 3).map((r) => ({ receivable_id: r.id, amount_cents: 10000 })) }, { 'idempotency-key': `liq-${rnd}-0001` });
  ok(s.status === 201 && s.data.allocations.length === 3, 'A16: uma liquidação para várias comissões', s.data);
  st1 = s.data.settlement;
  ok(s.data.accruals.reduce((a, x) => a + x.amount_cents, 0) === 9000, '16.1: R$ 90,00 de repasse liberados (30% de 300)', s.data.accruals.map((x) => x.amount_cents));
  const rep = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 30000, confirm_missing: true,
    allocations: recs.slice(0, 3).map((r) => ({ receivable_id: r.id, amount_cents: 10000 })) }, { 'idempotency-key': `liq-${rnd}-0001` });
  ok(rep.data.replayed === true && rep.data.settlement.id === st1.id, 'idempotência: mesma chave + mesmo comando devolve o resultado anterior');
  const confl = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 10000, confirm_missing: true,
    allocations: [{ receivable_id: recs[3].id, amount_cents: 10000 }] }, { 'idempotency-key': `liq-${rnd}-0001` });
  ok(confl.status === 409 && confl.data.code === 'IDEMPOTENCY_CONFLICT', 'chave reutilizada com outro conteúdo = conflito sem executar');
  const mism = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 10000, allocations: [{ receivable_id: recs[3].id, amount_cents: 9000 }], confirm_missing: true });
  ok(mism.status === 400 && mism.data.code === 'ALLOCATION_MISMATCH', 'alocações precisam fechar o bruto');
  const ovb = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 10001, allocations: [{ receivable_id: recs[0].id, amount_cents: 10001 }] });
  ok(ovb.status === 409, 'alocação acima do saldo confirmado bloqueada');
}
// A28 + pagamento do lote com evidência bancária
const bankAcc = (await call(T, 'POST', '/api/v1/finance/accounts', { name: 'Conta Teste', opening_balance_cents: 0 })).data;
{
  const b = await call(T, 'POST', '/api/v1/splits/batches', { partner_ids: [prod.id] });
  ok(b.status === 201 && b.data.batch.total_cents === 9000, 'lote de repasse preparado com R$ 90,00', b.data);
  const ap = await call(T, 'POST', `/api/v1/splits/batches/${b.data.batch.id}/approve`, {});
  ok(ap.status === 200 && ap.data.status === 'aprovado', 'lote aprovado (favorecido congelado)');
  let lock = null;
  try { await db.query(`update split_batch_items set payee = '{"account":"999"}' where batch_id = $1`, [b.data.batch.id]); } catch (e) { lock = e.code; }
  ok(lock === 'P0001', 'A28: favorecido de lote aprovado não pode ser trocado');
  const chg = await call(T, 'PUT', `/api/v1/partners/${prod.id}/bank`, { bank_info: { holder: 'Outro', holder_document: '1', account: '999' }, reason: 'troca', mfa_code: totp(A.secret) });
  ok(chg.status === 200, 'troca de favorecido do parceiro exige reautenticação');
  const items = (await call(T, 'GET', `/api/v1/splits/batches/${b.data.batch.id}`)).data.items;
  ok(items[0].payee.holder === 'Produtor Teste', 'A28: lote aprovado mantém o favorecido aprovado');
  const csv = `data;descricao;valor\n${today};PIX PRODUTOR;-90,00\n${today};TED SEGURADORA COMISSOES;300,00\n`;
  const imp = await call(T, 'POST', '/api/v1/finance/bank/import', { account_id: bankAcc.id, filename: 'extrato.csv', content: csv });
  ok(imp.status === 201 && imp.data.summary.inserted === 2, 'extrato bancário importado');
  const again = await call(T, 'POST', '/api/v1/finance/bank/import', { account_id: bankAcc.id, filename: 'extrato.csv', content: csv });
  ok(again.status === 409, 'mesmo extrato bancário não importa duas vezes');
  const txs = (await call(T, 'GET', `/api/v1/finance/bank/transactions?account_id=${bankAcc.id}`)).data;
  const debit = txs.find((t) => t.amount_cents === -9000);
  const credit = txs.find((t) => t.amount_cents === 30000);
  const pay = await call(T, 'POST', `/api/v1/splits/batches/${b.data.batch.id}/pay`, { bank_transaction_id: debit.id });
  ok(pay.status === 200, 'lote pago só com saída conciliada no extrato', pay.data);
  const rc = await call(T, 'POST', '/api/v1/finance/bank/reconcile', { transaction_id: credit.id, target_kind: 'commission_settlement', target_id: st1.id });
  ok(rc.status === 200 && rc.data.fully_reconciled, 'depósito da seguradora conciliado com a liquidação', rc.data);
  const ent = (await call(T, 'GET', '/api/v1/finance/entries')).data;
  const cash = ent.filter((e) => e.status === 'pago' && ['comissao', 'repasse'].includes(e.source)).reduce((a, e) => a + (e.kind === 'receber' ? e.amount_cents : -e.amount_cents), 0);
  ok(cash === 21000, '16.1: caixa da operação = 300 − 90 = 210', cash);
  ok(!ent.some((e) => /pr[eê]mio/i.test(e.description)), 'prêmio do seguro não entra no caixa da corretora (2.2-7)');
}
// 16.2 / A14: retenção
{
  const s = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 10000, retention_cents: 500, retention_nature: 'IRRF informado (exemplo)', confirm_missing: true,
    allocations: [{ receivable_id: recs[3].id, amount_cents: 10000 }] });
  ok(s.status === 201 && s.data.settlement.net_cents === 9500, '16.2: bruto 100, retenção 5, depósito 95');
  recs = await recvList(pol161.id);
  ok(recs[3].status === 'liquidada' && recs[3].balance_cents === 0, 'A14: comissão liquidada pelo bruto, sem dívida fictícia de 5', recs[3]);
  ok(s.data.accruals[0].amount_cents === 2850, '16.2: repasse sobre o líquido definido (95 × 30% = 28,50)', s.data.accruals);
}
// A15: parcial
{
  const s = await call(T, 'POST', '/api/v1/commissions/settlements', { institution_id: portoId, settled_date: today, gross_cents: 6000, confirm_missing: true, allocations: [{ receivable_id: recs[4].id, amount_cents: 6000 }] });
  recs = await recvList(pol161.id);
  ok(recs[4].status === 'recebida_parcial' && recs[4].balance_cents === 4000 && s.data.accruals[0].amount_cents === 1800, 'A15: parcial — saldo 40 e repasse 18 pela regra', recs[4]);
}
// 16.3 / A18: estorno de 180 com repasse já pago → redução do não pago + recuperável separado
{
  const before = (await call(T, 'GET', `/api/v1/splits/accruals?partner_id=${prod.id}`)).data;
  const paidBefore = before.filter((a) => a.status === 'paga').reduce((x, a) => x + a.amount_cents, 0);
  const unpaid = before.filter((a) => a.status === 'liberada').reduce((x, a) => x + a.amount_cents, 0);
  const adj = await call(T, 'POST', `/api/v1/commissions/receivables/${recs[0].id}/adjustments`, { kind: 'estorno', amount_cents: 18000, reason: 'cancelamento da apólice', evidence: 'extrato de estorno' });
  ok(adj.status === 201, 'estorno de 180 registrado', adj.data);
  const effects = adj.data.split_effects;
  const total = -effects.reduce((a, x) => a + x.amount_cents, 0);
  ok(total === 5400, '16.3: reversão proporcional de 30% = 54', effects.map((x) => [x.kind, x.amount_cents]));
  ok(effects.find((x) => x.kind === 'reducao')?.amount_cents === -unpaid && effects.find((x) => x.kind === 'recuperacao')?.amount_cents === -(5400 - unpaid),
    'A18: reduz o que não foi pago e cria recuperável para o que já foi pago', { unpaid, effects: effects.map((x) => [x.kind, x.amount_cents]) });
  const after = (await call(T, 'GET', `/api/v1/splits/accruals?partner_id=${prod.id}`)).data;
  ok(after.filter((a) => a.status === 'paga').reduce((x, a) => x + a.amount_cents, 0) === paidBefore, 'A18: pagamento original preservado');
  recs = await recvList(pol161.id);
  ok(recs[0].status === 'estornada', 'comissão marcada como estornada', recs[0].status);
}
// A17: regra muda depois; contrato antigo conserva snapshot
{
  await call(T, 'POST', `/api/v1/commissions/agreements/${agr.id}/versions`, { kind: 'percentual', rate: 25, base_definition: 'premio_liquido', schedule: 'unica', valid_from: addMonths(today, -1) });
  const det = await call(T, 'GET', `/api/v1/policies/${pol161.id}`);
  ok(det.data.commission_snapshot.rate === 20 && (await recvList(pol161.id)).every((r) => r.expected_cents === 10000), 'A17: snapshot preservado no contrato antigo');
  let lock = null;
  try { await db.query('update commission_rule_versions set rate = 99 where id = $1', [rule1.id]); } catch (e) { lock = e.code; }
  ok(lock === 'P0001', 'versão de regra não é alterada no banco (append-only)');
}
// A20: centavos
{
  const p = (await call(T, 'POST', '/api/v1/policies', { client_id: ana.id, institution_id: portoId, branch: 'auto', product_name: 'Auto', start_date: today, end_date: addMonths(today, 12), total_premium_cents: 10000, source_evidence: 'teste' })).data;
  const plan = await call(T, 'POST', `/api/v1/policies/${p.id}/installments/plan`, { count: 3, first_due: addDays(today, 10), total_cents: 10000 });
  ok(JSON.stringify(plan.data.map((x) => x.amount_cents)) === JSON.stringify([3334, 3333, 3333]), 'A20: 100,00 em três = 33,34 + 33,33 + 33,33', plan.data);
}
// A21 / A22: extrato de comissão
{
  const pol2 = (await call(T, 'POST', '/api/v1/policies', { client_id: ana.id, institution_id: portoId, branch: 'auto', product_name: 'Auto', policy_number: `PX-${rnd}`, start_date: addMonths(today, -1), end_date: addMonths(today, 11),
    total_premium_cents: 120000, source_evidence: 'documento', commission: { rule_version_id: rule1.id, base_cents: 100000 } })).data;
  const content = `data;apolice;parcela;valor_bruto;retencao;tipo;descricao\n${today};PX-${rnd};1;33,34;0;comissao;Parcela 1\n${today};PX-${rnd};2;33,34;0;comissao;Parcela 2\n${today};BONUS;;10,00;0;bonus;campanha\n${today};BONUS;;10,00;0;bonus;campanha\n`;
  const pv = await call(T, 'POST', '/api/v1/commissions/statements/preview', { institution_id: portoId, filename: 'ext.csv', content });
  ok(pv.status === 200 && pv.data.lines.length === 4, 'prévia do extrato', pv.data);
  const im = await call(T, 'POST', '/api/v1/commissions/statements/import', { institution_id: portoId, filename: 'ext.csv', content });
  ok(im.status === 201 && im.data.summary.inserted === 4, 'A22: duas linhas iguais legítimas preservadas', im.data.summary);
  const dupl = await call(T, 'POST', '/api/v1/commissions/statements/import', { institution_id: portoId, filename: 'ext.csv', content });
  ok(dupl.status === 409 && dupl.data.code === 'DUPLICATE_FILE', 'A21: mesmo extrato duas vezes é recusado');
  const overlap = `${content}${today};PX-${rnd};3;33,33;0;comissao;Parcela 3\n`;
  const im2 = await call(T, 'POST', '/api/v1/commissions/statements/import', { institution_id: portoId, filename: 'ext2.csv', content: overlap });
  ok(im2.data.summary.inserted === 1 && im2.data.summary.duplicates_skipped === 4, 'A21: linhas já importadas não duplicam', im2.data.summary);
  const lines = (await call(T, 'GET', `/api/v1/commissions/statements/lines?file_id=${im.data.file.id}`)).data;
  const ok1 = lines.filter((l) => l.status === 'pendente' && l.receivable_id);
  const rc = await call(T, 'POST', '/api/v1/commissions/statements/reconcile', { line_ids: ok1.map((l) => l.id), settled_date: today });
  ok(rc.status === 200 && rc.data.settlement?.gross_cents === 6668, 'extrato conciliado em uma liquidação agrupada', rc.data);
  ok(lines.filter((l) => l.kind === 'bonus').every((l) => l.status === 'divergente'), 'bônus sem vínculo vai para revisão (tratado separadamente)');
}

// =====================================================================
section('Parcelas: comprovante do cliente (A24) e portal');
{
  const p = (await call(T, 'POST', '/api/v1/policies', { client_id: ana.id, institution_id: portoId, branch: 'auto', product_name: 'Auto', policy_number: `PP-${rnd}`, start_date: today, end_date: addMonths(today, 12),
    total_premium_cents: 50000, source_evidence: 'documento', installments: [{ number: 1, due_date: addDays(today, 3), amount_cents: 50000, charge_url: 'https://boleto.seguradora.exemplo/123' }] })).data;
  const bad = await call(T, 'POST', `/api/v1/policies/${p.id}/installments`, { installments: [{ number: 2, due_date: today, amount_cents: 100, charge_url: 'http://inseguro' }] });
  ok(bad.status === 400, 'link de cobrança só https');
  const link = await call(T, 'POST', '/api/v1/portal-links', { policy_id: p.id });
  const pub = await call(null, 'GET', `/api/public/parcelas/${link.data.token}`);
  ok(pub.status === 200 && pub.data.installments.length === 1 && !/commission|comiss/i.test(pub.text), 'portal de parcelas sem dados internos');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5e00000000049454e44ae426082', 'hex').toString('base64');
  const up = await call(null, 'POST', `/api/public/parcelas/${link.data.token}/comprovante`, { installment_id: pub.data.installments[0].id, amount_cents: 50000, paid_date: today, filename: 'comp.png', mime: 'image/png', data: png });
  ok(up.status === 201, 'cliente envia comprovante', up.data);
  const pub2 = await call(null, 'GET', `/api/public/parcelas/${link.data.token}`);
  ok(pub2.data.installments[0].status === 'pagamento_informado', 'A24: comprovante = pagamento informado (não confirmado)', pub2.data.installments[0].status);
  const fake = await call(null, 'POST', `/api/public/parcelas/${link.data.token}/comprovante`, { installment_id: pub.data.installments[0].id, amount_cents: 1, paid_date: today, filename: 'x.pdf', mime: 'application/pdf', data: Buffer.from('<html>').toString('base64') });
  ok(fake.status === 400, 'arquivo com conteúdo diferente do tipo informado recusado');
  const rem = await call(T, 'POST', `/api/v1/premium-installments/${pub.data.installments[0].id}/reminder`, {});
  ok(rem.status === 409, 'lembrete suspenso enquanto há pagamento informado em conferência');
}

// =====================================================================
section('Endosso, cancelamento, renovação, sinistro');
{
  const det = await call(T, 'GET', `/api/v1/policies/${pol161.id}`);
  const e = await call(T, 'POST', `/api/v1/policies/${pol161.id}/endorsements`, { kind: 'alteracao_dados', reason: 'troca de endereço', requested_date: today, changes: 'CEP novo' });
  ok(e.status === 201, 'endosso solicitado');
  const em = await call(T, 'PUT', `/api/v1/policies/endorsements/${e.data.id}`, { status: 'emitido' });
  ok(em.status === 400, 'endosso emitido exige data de efeito e documento/protocolo');
  const em2 = await call(T, 'PUT', `/api/v1/policies/endorsements/${e.data.id}`, { status: 'emitido', effective_date: today, protocol: 'END-1', premium_diff_cents: 0 });
  ok(em2.status === 200, 'endosso emitido com nova versão do contrato');
  const versions = (await call(T, 'GET', `/api/v1/policies/${pol161.id}`)).data.versions;
  ok(versions.length >= 2, 'versões preservadas (original + endosso)');
  const c = await call(T, 'POST', `/api/v1/policies/${pol161.id}/cancellations`, { requested_by_name: 'Ana Teste', reason: 'venda do veículo', requested_date: today });
  ok(c.status === 201 && (await call(T, 'GET', `/api/v1/policies/${pol161.id}`)).data.contract_state === 'cancelamento_solicitado', 'cancelamento solicitado ≠ efetivado');
  const ef = await call(T, 'PUT', `/api/v1/policies/cancellations/${c.data.id}`, { status: 'efetivado', effective_date: today, evidence: 'endosso de cancelamento E-2', refund_cents: 12000 });
  ok(ef.status === 200 && /Comissões/.test(ef.data.note || ''), 'restituição e estorno de comissão tratados como operações separadas');
  const ren = await call(T, 'GET', '/api/v1/renewals?days=400');
  ok(ren.status === 200 && Array.isArray(ren.data), 'esteira de renovação');
  const pid = ren.data[0]?.id;
  if (pid) {
    const o1 = await call(T, 'POST', `/api/v1/renewals/${pid}/opportunity`, {});
    const o2 = await call(T, 'POST', `/api/v1/renewals/${pid}/opportunity`, {});
    ok(o1.data.id === o2.data.id, 'oportunidade de renovação idempotente');
  }
  const g1 = await call(T, 'POST', '/api/v1/automations/run', {});
  const g2 = await call(T, 'POST', '/api/v1/automations/run', {});
  ok(g2.data.renewals === 0 && g2.data.installments === 0, 'automações idempotentes (não duplicam tarefas)', [g1.data, g2.data]);
  const s0 = await call(T, 'POST', '/api/v1/claims', { policy_id: pol161.id, occurred_at: new Date().toISOString(), description: 'Colisão leve', deadline_at: addDays(today, 5) });
  ok(s0.status === 400, 'A29: prazo exige a regra/fundamento aplicável');
  const s1 = await call(T, 'POST', '/api/v1/claims', { policy_id: pol161.id, occurred_at: new Date().toISOString(), description: 'Colisão leve', deadline_at: addDays(today, 5), deadline_rule: 'Condições gerais do produto, cláusula X' });
  ok(s1.status === 201, 'sinistro registrado');
  const s2 = await call(T, 'PUT', `/api/v1/claims/${s1.data.id}`, { work_status: 'negado' });
  ok(s2.status === 400, 'o sistema não decide cobertura: negativa só com decisão/evidência da seguradora');
}

// =====================================================================
section('Perfis e permissões');
{
  const u = await call(T, 'POST', '/api/v1/company/users', { name: 'Corretor Novo', email: `corretor-${rnd}@teste.apolven`, role: 'broker' });
  ok(u.status === 201 && u.data.temporary_password, 'convite com senha provisória');
  const l = await call(null, 'POST', '/api/auth/login', { email: `corretor-${rnd}@teste.apolven`, password: u.data.temporary_password });
  const bt = l.data.token;
  ok(bt && !l.data.mfa_setup_required, 'corretor entra (MFA opcional para o perfil)');
  const cl = await call(bt, 'GET', '/api/v1/clients');
  ok(cl.status === 200 && cl.data.length === 0, 'carteira própria: corretor não vê clientes de outros');
  const fin = await call(bt, 'POST', '/api/v1/commissions/settlements', {});
  ok(fin.status === 403, 'corretor não baixa liquidações');
  const own1 = (await call(bt, 'POST', '/api/v1/clients', { kind: 'pf', name: 'Cliente do Corretor' })).data;
  const own2 = await call(bt, 'GET', `/api/v1/clients/${own1.id}`);
  ok(own2.status === 200 && own2.data.document === null, 'corretor vê o próprio cliente (documento completo só com permissão)');
  await call(T, 'PUT', `/api/v1/company/users/${u.data.id}`, { active: false });
  const after = await call(bt, 'GET', '/api/v1/clients');
  ok(after.status === 401, 'A03: acesso revogado derruba a sessão imediatamente');
}

// =====================================================================
section('Auditoria');
{
  const a = await call(T, 'GET', '/api/v1/reports/audit');
  ok(a.status === 200 && a.data.some((x) => x.action === 'settlement.create') && !a.text.includes('SEGREDO-SUPER-123'), 'auditoria registra atos sem segredos');
  let upd = null;
  try { await db.query(`update audit_log set summary = 'x' where company_id = $1`, [A.companyId]); } catch (e) { upd = e.code; }
  ok(upd === 'P0001', 'trilha de auditoria protegida contra alteração');
  const ind = await call(T, 'GET', '/api/v1/reports/indicators');
  ok(ind.status === 200 && ind.data.indicators.every((i) => 'num' in i && 'den' in i && i.definition), 'indicadores com numerador, denominador e definição', [ind.status, ind.text.slice(0, 300)]);
  const dash = await call(T, 'GET', '/api/v1/reports/dashboard');
  ok(dash.status === 200 && dash.data.commissions && dash.data.installments, 'painel do gestor');
}

console.log(`\n${pass} verificações OK, ${fail} falha(s).`);
if (fail) console.log('Falhas:', failures);
await db.end();
process.exit(fail ? 1 : 0);
