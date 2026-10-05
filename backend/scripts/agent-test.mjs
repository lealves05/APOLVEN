// Agente do WhatsApp contra uma Graph API falsa: conexão, rotinas (modelo, consentimento, duplicidade, SAIR),
// webhook (assinatura, status, autoatendimento com conferência de identidade), atendimento humano, simulador,
// lembretes da equipe e agendador.
// Uso: DATABASE_URL=postgres://.../apolven_agent_test node scripts/agent-test.mjs   (APAGA o schema apolven do banco informado)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }

// ---- Graph API falsa ----
const sent = [];
let failNext = false;
const graph = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer EAAG-token-de-teste-0123456789') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token' } })); }
    if (req.method === 'GET') return res.end(JSON.stringify({ display_phone_number: '+55 19 3333-0000', verified_name: 'Corretora Teste', quality_rating: 'GREEN' }));
    if (failNext) { failNext = false; res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'Template name does not exist in the translation', code: 132001 } })); }
    const b = JSON.parse(body);
    sent.push(b);
    res.end(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }));
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
process.env.WA_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
process.env.APOLVEN_MFA = 'off';
process.env.PLATFORM_MODE = 'standalone';
process.env.APOLVEN_CRON_SECRET = 'cron-secreto-de-teste-0123456789abcdef';
process.env.AGENT_ROUTINES = 'off';

const { pool } = await import('../src/db.js');
await pool.query('drop schema if exists apolven cascade');
const { migrate } = await import('../src/migrate.js');
await migrate();
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const db = (t, p) => pool.query(t, p);

let passed = 0; const fails = [];
const check = async (name, fn) => { try { await fn(); passed++; console.log('  ok ', name); } catch (e) { fails.push(name); console.log('  FALHOU', name, '—', e.message); } };
async function api(method, path, body, token, headers = {}) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const cpf = (b) => { const c = (x, w) => { const s = x.split('').reduce((a, n, i) => a + Number(n) * w[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; }; const d1 = c(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]); return `${b}${d1}${c(b + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const ymd = (d) => d.toISOString().slice(0, 10);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plus = (n) => ymd(new Date(new Date(`${today}T12:00:00Z`).getTime() + n * 86400000));

const reg = await api('POST', '/auth/register', { companyName: 'Corretora Teste', name: 'Dona Teste', email: 'dona@teste.dev', password: 'Corretora2026xy' });
assert.equal(reg.status, 201, JSON.stringify(reg.data));
const T = reg.data.token;
const cid = reg.data.company.id;
const APP_SECRET = 'segredo-do-app-de-teste-123456';
const PNID = '109876543210';

const docMaria = cpf('529982247');
const maria = (await api('POST', '/v1/clients', { kind: 'pf', name: 'Maria Souza', document: docMaria, phone: '(19) 98888-7777' }, T)).data;
const joao = (await api('POST', '/v1/clients', { kind: 'pf', name: 'João Sem Consentimento', document: cpf('111444777'), phone: '(19) 97777-6666' }, T)).data;
await api('POST', `/v1/clients/${maria.id}/consents`, { purpose: 'whatsapp', legal_basis: 'execução do contrato', evidence: 'autorizou no cadastro em 05/10' }, T);
const porto = (await db(`select id from apolven.institutions where code = 'porto'`)).rows[0].id;
await db(`update apolven.institutions set assistance_phone = '0800 727 0800' where id = $1`, [porto]);
const mkPolicy = async (client, end) => (await api('POST', '/v1/policies', { client_id: client.id, institution_id: porto, branch: 'auto', product_name: 'Auto', policy_number: `AP-${client.name.slice(0, 3)}-${end}`,
  start_date: plus(-200), end_date: end, total_premium_cents: 300000, source_evidence: 'documento da seguradora',
  installments: [{ number: 1, due_date: plus(-30), amount_cents: 100000 }, { number: 2, due_date: plus(3), amount_cents: 100000 }, { number: 3, due_date: plus(33), amount_cents: 100000 }] }, T)).data;
const polMaria = await mkPolicy(maria, plus(30));
await mkPolicy(joao, plus(30));

const sign = (raw) => `sha256=${crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
let seq = 0;
async function inbound(text, from = '5519988887777', { signature } = {}) {
  seq += 1;
  const payload = { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
    contacts: [{ wa_id: from, profile: { name: 'Maria' } }], messages: [{ from, id: `wamid.in.${seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] };
  const raw = JSON.stringify(payload);
  const r = await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature || sign(raw) }, body: raw });
  return r.status;
}
const lastText = () => sent.at(-1)?.text?.body || '';

console.log('# Conexão');
await check('agente nasce desligado e sem credenciais', async () => {
  const r = await api('GET', '/v1/agent', null, T);
  assert.equal(r.status, 200); assert.equal(r.data.enabled, false); assert.equal(r.data.ready, false);
  assert.ok(r.data.verify_token.length >= 32); assert.equal(r.data.templates.length, 6);
});
await check('não liga sem conexão testada', async () => {
  const g = await api('GET', '/v1/agent', null, T);
  const r = await api('PUT', '/v1/agent/settings', { version: g.data.version, enabled: true }, T);
  assert.equal(r.status, 409);
});
await check('credenciais cifradas: nunca voltam ao navegador nem ficam em texto no banco', async () => {
  const r = await api('PUT', '/v1/agent/connection', { phone_number_id: PNID, access_token: 'EAAG-token-de-teste-0123456789', app_secret: APP_SECRET, password: 'Corretora2026xy' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.has_access_token, true); assert.ok(!JSON.stringify(r.data).includes('EAAG-token')); assert.ok(!JSON.stringify(r.data).includes(APP_SECRET));
  const row = (await db('select secrets from apolven.wa_agents where company_id = $1', [cid])).rows[0];
  assert.ok(!row.secrets.includes('EAAG') && !row.secrets.includes(APP_SECRET) && row.secrets.startsWith('v1.'));
});
await check('trocar credencial exige reautenticação', async () => {
  const r = await api('PUT', '/v1/agent/connection', { phone_number_id: PNID, access_token: 'EAAG-outro-token-000000000000' }, T);
  assert.equal(r.status, 401); assert.equal(r.data.code, 'REAUTH_REQUIRED');
});
await check('verificação do webhook pela Meta (token certo devolve o desafio; errado é recusado)', async () => {
  const vt = (await api('GET', '/v1/agent', null, T)).data.verify_token;
  const ok = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=12345abc`);
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '12345abc');
  const bad = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${'x'.repeat(32)}&hub.challenge=1`);
  assert.equal(bad.status, 403);
});
await check('teste de conexão lê o número na Graph API e libera ligar o agente', async () => {
  const t = await api('POST', '/v1/agent/connection/test', {}, T);
  assert.equal(t.status, 200); assert.equal(t.data.ok, true); assert.equal(t.data.agent.display_phone, '+55 19 3333-0000');
  const r = await api('PUT', '/v1/agent/settings', { version: t.data.agent.version, enabled: true,
    settings: { windowStart: 0, windowEnd: 24, weekends: true, sendHour: 0, publicUrl: 'https://apolven.lorler.com.br' } }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.enabled, true);
});

console.log('# Rotinas para clientes');
await check('prévia: só clientes com consentimento de WhatsApp, sem enviar nada', async () => {
  const p = await api('GET', '/v1/agent/routines/parcela_a_vencer/preview', null, T);
  assert.equal(p.status, 200); assert.equal(p.data.length, 1); assert.equal(p.data[0].name, 'Maria Souza');
  assert.ok(p.data[0].text.includes('2/3') && p.data[0].text.includes('R$'), p.data[0].text);
  assert.equal(sent.length, 0);
});
await check('rotina sem modelo informado não envia', async () => {
  const g = await api('GET', '/v1/agent', null, T);
  await api('PUT', '/v1/agent/settings', { version: g.data.version, settings: { routines: { parcela_a_vencer: { template: '' } } } }, T);
  const r = await api('POST', '/v1/agent/routines/parcela_a_vencer/run', {}, T);
  assert.equal(r.data.sent, 0); assert.match(r.data.note, /modelo/);
  const g2 = await api('GET', '/v1/agent', null, T);
  await api('PUT', '/v1/agent/settings', { version: g2.data.version, settings: { routines: { parcela_a_vencer: { template: 'apolven_parcela_a_vencer', enabled: true } } } }, T);
});
await check('parcela a vencer: modelo aprovado com as variáveis na ordem e link do portal', async () => {
  const r = await api('POST', '/v1/agent/routines/parcela_a_vencer/run', {}, T);
  assert.equal(r.data.sent, 1, JSON.stringify(r.data));
  const m = sent.at(-1);
  assert.equal(m.type, 'template'); assert.equal(m.template.name, 'apolven_parcela_a_vencer'); assert.equal(m.to, '5519988887777');
  const p = m.template.components[0].parameters.map((x) => x.text);
  assert.equal(p[0], 'Maria'); assert.equal(p[1], '2/3'); assert.ok(p[4].includes('1.000,00')); assert.match(p[5], /^https:\/\/apolven\.lorler\.com\.br\/p\/parcelas\/[0-9a-f]{48}$/);
  const link = await api('GET', `/public/parcelas/${p[5].split('/').pop()}`);
  assert.equal(link.status, 200);
});
await check('sem duplicidade: rodar de novo não reenvia', async () => {
  const before = sent.length;
  const r = await api('POST', '/v1/agent/routines/parcela_a_vencer/run', {}, T);
  assert.equal(r.data.sent, 0); assert.equal(sent.length, before);
});
await check('falha da Meta fica registrada e é tentada de novo depois', async () => {
  const g = await api('GET', '/v1/agent', null, T);
  await api('PUT', '/v1/agent/settings', { version: g.data.version, settings: { routines: { parcela_vencida: { enabled: true, days: [30] } } } }, T);
  failNext = true;
  const r1 = await api('POST', '/v1/agent/routines/parcela_vencida/run', {}, T);
  assert.equal(r1.data.failed, 1);
  const msg = (await db(`select status, error from apolven.wa_messages where company_id = $1 and routine = 'parcela_vencida'`, [cid])).rows[0];
  assert.equal(msg.status, 'falhou'); assert.match(msg.error, /Template/);
  const r2 = await api('POST', '/v1/agent/routines/parcela_vencida/run', {}, T);
  assert.equal(r2.data.sent, 1);
});
await check('renovação respeita os marcos de alerta', async () => {
  const p = await api('GET', '/v1/agent/routines/renovacao/preview', null, T);
  assert.equal(p.data.length, 1); assert.equal(p.data[0].milestone, 'd30'); assert.ok(p.data[0].text.includes('Auto'));
});
await check('status de entrega do webhook atualiza a mensagem (sem regredir)', async () => {
  const wamid = sent.length ? `wamid.${sent.length}` : null;
  const st = (s) => JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: PNID }, statuses: [{ id: wamid, status: s }] } }] }] });
  for (const s of ['read', 'delivered']) {
    const raw = st(s);
    await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
  }
  const m = (await db('select status from apolven.wa_messages where wa_message_id = $1', [wamid])).rows[0];
  assert.equal(m.status, 'lida');
});

console.log('# Mensagens recebidas (autoatendimento)');
await check('assinatura inválida é recusada (401) e nada é processado', async () => {
  const before = sent.length;
  assert.equal(await inbound('oi', undefined, { signature: `sha256=${'0'.repeat(64)}` }), 401);
  assert.equal(sent.length, before);
});
await check('saudação responde com o menu', async () => {
  assert.equal(await inbound('Oi, bom dia'), 200);
  assert.match(lastText(), /1 - Minhas apólices/); assert.match(lastText(), /Maria/);
});
await check('apólices só depois de conferir a identidade (3 primeiros dígitos do CPF)', async () => {
  await inbound('1');
  assert.match(lastText(), /3 primeiros dígitos do seu CPF/);
  await inbound('999');
  assert.match(lastText(), /Não confere/);
  await inbound(docMaria.slice(0, 3));
  assert.match(lastText(), /Suas apólices vigentes/); assert.ok(lastText().includes(polMaria.policy_number));
});
await check('parcelas com link temporário (identidade já conferida)', async () => {
  await inbound('2');
  assert.match(lastText(), /Parcelas do seu seguro/); assert.match(lastText(), /\/p\/parcelas\/[0-9a-f]{48}/);
});
await check('reenvio da mesma mensagem pela Meta não gera resposta duplicada', async () => {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: PNID }, messages: [{ from: '5519988887777', id: 'wamid.repetida', type: 'text', text: { body: 'menu' } }] } }] }] });
  const before = sent.length;
  for (let i = 0; i < 2; i += 1) await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
  assert.equal(sent.length, before + 1);
});
await check('aviso de sinistro vira solicitação com protocolo e tarefa para o corretor', async () => {
  await inbound('3');
  assert.match(lastText(), /0800 727 0800/);
  await inbound('Bateram no meu carro hoje às 10h na Av. Brasil, sem feridos');
  assert.match(lastText(), /Protocolo SOL-\d+/);
  const sr = (await db(`select kind, channel, priority from apolven.service_requests where company_id = $1 and channel = 'whatsapp'`, [cid])).rows[0];
  assert.equal(sr.kind, 'assistencia'); assert.equal(sr.priority, 'alta');
});
await check('pedir um corretor transfere para atendimento humano e o agente silencia', async () => {
  await inbound('quero falar com um corretor');
  assert.match(lastText(), /Um corretor vai continuar/);
  const before = sent.length;
  await inbound('alô?');
  assert.equal(sent.length, before);
  const task = (await db(`select title from apolven.tasks where company_id = $1 and kind = 'whatsapp'`, [cid])).rows;
  assert.ok(task.length >= 1);
  const n = await api('GET', '/v1/notifications', null, T);
  assert.ok(n.data.some((x) => /aguardando um corretor/.test(x.text)));
});
await check('corretor responde pela caixa de conversas (janela de 24 h aberta) e devolve ao assistente', async () => {
  const list = await api('GET', '/v1/agent/conversations', null, T);
  const conv = list.data.find((c) => c.phone === '5519988887777');
  assert.equal(conv.status, 'humano'); assert.equal(conv.window_open, true);
  const r = await api('POST', `/v1/agent/conversations/${conv.id}/messages`, { text: 'Olá Maria, aqui é a Dona. Já abri o aviso na seguradora.' }, T);
  assert.equal(r.status, 201); assert.equal(sent.at(-1).type, 'text');
  const d = await api('GET', `/v1/agent/conversations/${conv.id}`, null, T);
  assert.ok(d.data.messages.length >= 10); assert.equal(d.data.unread, 0);
  assert.equal((await api('POST', `/v1/agent/conversations/${conv.id}/status`, { status: 'agente' }, T)).status, 200);
});
await check('fora da janela de 24 h só modelo: texto livre é bloqueado', async () => {
  const conv = (await db(`select id from apolven.wa_conversations where company_id = $1 and phone = '5519977776666'`, [cid])).rows[0]
    || (await db(`insert into apolven.wa_conversations (company_id, phone) values ($1, '5519977776666') returning id`, [cid])).rows[0];
  const r = await api('POST', `/v1/agent/conversations/${conv.id}/messages`, { text: 'oi' }, T);
  assert.equal(r.status, 409); assert.equal(r.data.code, 'WINDOW_CLOSED');
});
await check('SAIR: revoga o consentimento e a rotina não envia mais para o cliente', async () => {
  await inbound('SAIR');
  assert.match(lastText(), /não vai mais receber avisos/);
  const c = (await db(`select revoked_at from apolven.consents where client_id = $1 and purpose = 'whatsapp'`, [maria.id])).rows[0];
  assert.ok(c.revoked_at);
  const p = await api('GET', '/v1/agent/routines/renovacao/preview', null, T);
  assert.equal(p.data.length, 0);
});
await check('número sem cadastro que pede dados é encaminhado a um corretor', async () => {
  await inbound('1', '5511912345678');
  assert.match(lastText(), /Um corretor vai continuar/);
});

console.log('# Simulador e equipe');
await check('simulador responde sem enviar nada ao WhatsApp', async () => {
  const before = sent.length;
  const r = await api('POST', '/v1/agent/simulate', { client_id: joao.id, text: 'oi' }, T);
  assert.equal(r.status, 200); assert.match(r.data.replies[0], /1 - Minhas apólices/);
  assert.equal(sent.length, before);
  const sim = (await api('GET', '/v1/agent/conversations?simulated=1', null, T)).data;
  assert.equal(sim.length, 1);
  assert.equal((await api('DELETE', '/v1/agent/simulate', null, T)).status, 200);
});
await check('lembretes da equipe: tarefas na Agenda e resumo no WhatsApp de quem pediu', async () => {
  const me = await api('PUT', '/v1/agent/me', { phone: '(19) 99999-1234', wa_reminders: true }, T);
  assert.equal(me.status, 200);
  const g = await api('GET', '/v1/agent', null, T);
  await api('PUT', '/v1/agent/settings', { version: g.data.version, settings: { team: { hour: 0 } } }, T);
  const r = await api('POST', '/v1/agent/team/run', {}, T);
  assert.ok(r.data.tasks.renovacoes >= 2 && r.data.tasks.parcelas >= 2, JSON.stringify(r.data.tasks));
  assert.equal(r.data.sent, 1, JSON.stringify(r.data));
  const m = sent.at(-1);
  assert.equal(m.template.name, 'apolven_lembretes_equipe'); assert.equal(m.to, '5519999991234');
  assert.match(m.template.components[0].parameters[2].text, /renova/);
  const again = await api('POST', '/v1/agent/team/run', {}, T);
  assert.equal(again.data.sent, 0);
});
await check('agendador exige o segredo e roda todas as corretoras', async () => {
  assert.equal((await fetch(`${base}/api/agent/cron`)).status, 401);
  const r = await fetch(`${base}/api/agent/cron`, { headers: { authorization: `Bearer ${process.env.APOLVEN_CRON_SECRET}` } });
  assert.equal(r.status, 200); const j = await r.json(); assert.ok(j.companies >= 1);
});
await check('histórico de execuções e auditoria', async () => {
  const runs = await api('GET', '/v1/agent/runs', null, T);
  assert.ok(runs.data.length >= 3);
  const aud = (await db(`select count(*)::int as n from apolven.audit_log where company_id = $1 and action like 'agent.%'`, [cid])).rows[0].n;
  assert.ok(aud >= 4);
});
await check('corretor (carteira própria) não vê conversa de cliente de outro corretor', async () => {
  const u = await api('POST', '/v1/company/users', { name: 'Corretor B', email: 'b@teste.dev', role: 'broker' }, T);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const pw = u.data.temp_password || u.data.temporary_password;
  const login = await api('POST', '/auth/login', { email: 'b@teste.dev', password: pw });
  const TB = login.data.token;
  assert.ok(TB, JSON.stringify(login.data));
  const list = await api('GET', '/v1/agent/conversations', null, TB);
  assert.equal(list.status, 200);
  assert.ok(!list.data.some((c) => c.client_id === maria.id));
  assert.equal((await api('PUT', '/v1/agent/settings', { version: 1 }, TB)).status, 403);
});

console.log(`\n${passed} verificações OK, ${fails.length} falha(s).`);
server.close(); graph.close(); await pool.end();
process.exit(fails.length ? 1 : 0);
