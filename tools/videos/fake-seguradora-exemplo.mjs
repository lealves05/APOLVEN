// "Seguradora Exemplo S.A." — seguradora FICTÍCIA usada só para gravar a aula da API de cotação (nenhuma marca real).
// Servidor HTTPS local que imita o modelo usado pelas seguradoras:
//   portal.seguradora-exemplo.com.br        portal do desenvolvedor (aplicativo, Client ID, Client Secret, ambientes, URLs)
//   api.seguradora-exemplo.com.br/oauth/token   OAuth2 client credentials (client_secret_basic ou _post, expires_in, invalid_client…)
//   api.seguradora-exemplo.com.br/apolven/v1/status | /v1/cotacoes   contrato "padrão APOLVEN" (apolven-cotacao/1)
//   …/modelo/v1/* e …/ilustrativa/v1/*   duas outras seguradoras fictícias (Bearer fixo) para a etapa 5
// Uso (veja README): TLS_CERT=out/tls/server.crt TLS_KEY=out/tls/server.key node fake-seguradora-exemplo.mjs [porta=443]
// As credenciais abaixo são de mentira e servem só para a demonstração.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2]) || 443;
const CONTRACT = 'apolven-cotacao/1';
export const CLIENT_ID = 'apolven-demo-01';
export const CLIENT_SECRET = 'sx-demo-8f3k-2026';
const tokens = new Map(); // token → expira em (ms)

const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bearerOk(req, fixed) {
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return false;
  if (fixed) return m[1] === fixed;
  const exp = tokens.get(m[1]);
  return !!exp && exp > Date.now();
}

function token(req, res, body) {
  const form = new URLSearchParams(body);
  let id = form.get('client_id');
  let secret = form.get('client_secret');
  const basic = String(req.headers.authorization || '').match(/^Basic (.+)$/);
  if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent);
  if (form.get('grant_type') !== 'client_credentials') return json(res, 400, { error: 'unsupported_grant_type', error_description: 'Use grant_type=client_credentials.' });
  if (id !== CLIENT_ID || secret !== CLIENT_SECRET) {
    return json(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed (client_id ou client_secret inválido).' }, { 'www-authenticate': 'Basic realm="seguradora-exemplo"' });
  }
  const scope = form.get('scope') || 'cotacao';
  if (scope.split(' ').some((s) => s !== 'cotacao')) return json(res, 400, { error: 'invalid_scope', error_description: 'Escopo não liberado para este aplicativo.' });
  const t = crypto.randomBytes(24).toString('base64url');
  tokens.set(t, Date.now() + 3600 * 1000);
  return json(res, 200, { access_token: t, token_type: 'Bearer', expires_in: 3600, scope });
}

const COMPANY = { apolven: 'Seguradora Exemplo S.A.', modelo: 'Seguradora Modelo S.A.', ilustrativa: 'Seguradora Ilustrativa S.A.' };

function offers(company, req) {
  const covs = (req.coberturas_desejadas || []).map((c, i) => ({
    codigo: c.codigo, nome: c.nome, limite_centavos: c.limite_minimo_centavos ?? [8500000, 15000000, 15000000, 3000000][i % 4],
    ...(c.codigo === 'casco' ? { franquia_centavos: 320000, franquia_descricao: 'Franquia normal' } : {}),
  }));
  const pay = (total) => [{ id: 'boleto-1x', meio: 'boleto', parcelas: 1, total_centavos: total },
    { id: 'cartao-10x', meio: 'cartao', parcelas: 10, valor_primeira_centavos: total - Math.floor(total / 10) * 9, valor_parcela_centavos: Math.floor(total / 10), total_centavos: total }];
  const offer = (produto, total, status) => ({
    seguradora: company, produto, status, numero_cotacao: status === 'valida' ? `Q-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}` : null,
    validade: status === 'valida' ? addDays(10) : null,
    premio: { total_centavos: total, liquido_centavos: Math.round(total / 1.0738), iof_centavos: total - Math.round(total / 1.0738) },
    coberturas: covs, franquias: covs.filter((c) => c.franquia_centavos).map((c) => ({ cobertura: c.codigo, descricao: c.franquia_descricao, valor_centavos: c.franquia_centavos })),
    assistencias: [{ codigo: 'guincho', nome: 'Guincho 24h (400 km)' }, { codigo: 'chaveiro', nome: 'Chaveiro' }],
    formas_pagamento: pay(total), observacoes: null,
  });
  if (company === COMPANY.apolven) return [offer('Auto Completo', 198700, 'valida'), offer('Auto Essencial', 171900, 'indicativa')];
  return [offer('Auto Mais', 214300, 'valida')];
}

function portal(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Portal do Desenvolvedor — Seguradora Exemplo</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 Inter,system-ui,sans-serif;background:#f3f5f9;color:#1f2937}
header{background:#0f3d3e;color:#fff;display:flex;align-items:center;gap:28px;padding:0 40px;height:64px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px}.logo i{width:30px;height:30px;border-radius:8px;background:#f2b134;display:inline-block;transform:rotate(45deg)}
nav a{color:#cde3e3;margin-right:22px;text-decoration:none;font-weight:500}nav a.on{color:#fff;border-bottom:3px solid #f2b134;padding-bottom:19px}
.url{margin-left:auto;font:13px monospace;color:#9fc5c5}
main{max-width:1100px;margin:28px auto;padding:0 24px}.crumb{color:#64748b;font-size:13px}
h1{font-size:26px;margin:6px 0 4px}.sub{color:#64748b;margin:0 0 20px}
.tabs{display:flex;gap:8px;margin-bottom:16px}.tabs span{padding:8px 16px;border-radius:999px;background:#e2e8f0;font-weight:600;font-size:14px}.tabs span.on{background:#0f3d3e;color:#fff}
.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:18px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px 22px}
.card h2{font-size:16px;margin:0 0 14px}.row{display:flex;align-items:center;gap:10px;margin:10px 0}.row label{width:130px;color:#64748b;font-size:13px}
.v{flex:1;font:14px monospace;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}
button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}button.p{background:#0f3d3e;color:#fff;border-color:#0f3d3e}
.ok{display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700}
.tip{font-size:13px;color:#64748b;margin-top:8px}.warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:12px;display:none}
footer{text-align:center;color:#94a3b8;font-size:12px;margin:26px 0}
</style></head><body>
<header><span class="logo"><i></i>Seguradora Exemplo</span><nav><a class="on">Aplicativos</a><a>APIs</a><a>Documentação</a><a>Suporte</a></nav><span class="url">portal.seguradora-exemplo.com.br</span></header>
<main><div class="crumb">Portal do Desenvolvedor › Meus aplicativos</div>
<h1>Corretora Demonstração — Integração APOLVEN</h1><p class="sub">Aplicativo de corretora · API de cotação (padrão APOLVEN) <span class="ok">Aprovado em produção</span></p>
<div class="tabs"><span>Homologação (sandbox)</span><span class="on">Produção</span></div>
<div class="grid"><section class="card" id="credenciais"><h2>Credenciais do aplicativo (OAuth2 client credentials)</h2>
<div class="row"><label>Client ID</label><span class="v" id="cid">${CLIENT_ID}</span><button>Copiar</button></div>
<div class="row"><label>Client Secret</label><span class="v" id="sec">••••••••••••••••</span><button class="p" id="gen" onclick="document.getElementById('sec').textContent='${CLIENT_SECRET}';document.getElementById('w').style.display='block'">Gerar novo secret</button></div>
<div class="warn" id="w"><b>Copie agora:</b> por segurança, este secret não será exibido novamente. Ao gerar um novo, o anterior deixa de funcionar.</div>
<p class="tip">Homologação e produção têm credenciais diferentes. Nunca envie o secret por e-mail ou mensagem.</p></section>
<section class="card" id="enderecos"><h2>Endereços e parâmetros</h2>
<div class="row"><label>URL do token</label><span class="v">https://api.seguradora-exemplo.com.br/oauth/token</span></div>
<div class="row"><label>URL base da API</label><span class="v">https://api.seguradora-exemplo.com.br/apolven</span></div>
<div class="row"><label>Escopo</label><span class="v">cotacao</span></div>
<div class="row"><label>Validade do token</label><span class="v">3600 s (1 hora)</span></div>
<div class="row"><label>Grant type</label><span class="v">client_credentials</span></div></section></div>
<footer>Seguradora fictícia, criada apenas para o treinamento do APOLVEN.</footer></main></body></html>`);
}

https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const host = String(req.headers.host || '').split(':')[0];
    const url = new URL(req.url, 'https://x');
    const body = Buffer.concat(chunks).toString('utf8');
    if (host.startsWith('portal.')) return portal(res);
    if (url.pathname === '/oauth/token' && req.method === 'POST') return token(req, res, body);
    const m = url.pathname.match(/^\/(apolven|modelo|ilustrativa)\/v1\/(status|cotacoes)$/);
    if (!m) return json(res, 404, { erro: 'rota não encontrada' });
    const [, who, op] = m;
    const fixed = who === 'apolven' ? null : `tok-${who}`;
    if (!bearerOk(req, fixed)) return json(res, 401, { error: 'invalid_token', error_description: 'Token ausente, inválido ou expirado.' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
    if (op === 'status') return json(res, 200, { contrato: CONTRACT, status: 'ok', seguradora: COMPANY[who], ambiente: 'producao', ramos: ['auto', 'residencial', 'empresarial'] });
    let reqBody;
    try { reqBody = JSON.parse(body); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
    await sleep({ apolven: 3200, modelo: 5200, ilustrativa: 1800 }[who]);
    if (who === 'ilustrativa') {
      return json(res, 200, { contrato: CONTRACT, id_requisicao: reqBody.id_requisicao, ofertas: [{ seguradora: COMPANY[who], produto: 'Auto Clássico', status: 'recusa', numero_cotacao: 'R-20931', motivo_recusa: 'Modelo do veículo fora da política de aceitação desta seguradora.' }] });
    }
    return json(res, 200, { contrato: CONTRACT, id_requisicao: reqBody.id_requisicao, ofertas: offers(COMPANY[who], reqBody) });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Seguradora Exemplo (fictícia) em https://api.seguradora-exemplo.com.br:${PORT}`));
