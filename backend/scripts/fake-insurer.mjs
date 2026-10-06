// Seguradora de mentira para desenvolvimento e testes da API de cotação "padrão APOLVEN" (apolven-cotacao/1).
// Uso: node scripts/fake-insurer.mjs [porta]   (padrão 4890) — e suba a API com APOLVEN_ALLOW_LOCAL_API=1.
// Cada caminho base simula um comportamento:
//   http://localhost:4890/valida      cotação válida (prêmio calculado do pedido)
//   http://localhost:4890/indicativa  valor indicativo
//   http://localhost:4890/recusa      recusa expressa com motivo e protocolo
//   http://localhost:4890/lenta       demora 20 s (use tempo máximo menor para ver "tempo esgotado")
//   http://localhost:4890/erro        HTTP 503 sempre (falha técnica: tenta de novo e desiste)
//   http://localhost:4890/instavel    503 na 1ª tentativa de cada pedido, depois cotação válida
//   http://localhost:4890/fora        resposta fora do contrato
//   http://localhost:4890/redireciona 302 para outro endereço (nunca seguido)
// Autenticação aceita: Bearer tok-123 · cabeçalho X-API-Key: key-123 · OAuth2 client credentials em /oauth/token (cli/sec).
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2]) || 4890;
const CONTRACT = 'apolven-cotacao/1';
const seen = new Map();
export const received = [];

const send = (res, status, body, headers = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
};
const authorized = (req) => {
  const a = req.headers.authorization || '';
  if (a === 'Bearer tok-123' || req.headers['x-api-key'] === 'key-123') return true;
  const m = a.match(/^Bearer (oauth-[a-f0-9]+)$/);
  return !!m && seen.has(`token:${m[1]}`);
};
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function offer(reqBody, mode, name) {
  const base = 150000 + (parseInt(crypto.createHash('sha1').update(JSON.stringify(reqBody.risco || {}) + mode).digest('hex').slice(0, 4), 16) % 150000);
  const total = Math.round(base / 100) * 100;
  const iof = Math.round(total * 0.0738 / 1.0738);
  const covs = (reqBody.coberturas_desejadas || []).map((c, i) => ({
    codigo: c.codigo, nome: c.nome, limite_centavos: c.limite_minimo_centavos ?? 5000000 + i * 1000000,
    ...(i === 0 ? { franquia_centavos: 300000, franquia_descricao: 'Franquia normal' } : {}),
  }));
  const parc = 10;
  return {
    seguradora: name, produto: mode === 'indicativa' ? 'Plano Essencial (estimativa)' : 'Plano Completo', status: mode === 'indicativa' ? 'indicativa' : 'valida',
    numero_cotacao: `${mode.slice(0, 3).toUpperCase()}-${crypto.randomBytes(3).toString('hex')}`, validade: mode === 'indicativa' ? null : addDays(10),
    premio: { total_centavos: total, liquido_centavos: total - iof, iof_centavos: iof },
    coberturas: covs, franquias: covs.length ? [{ cobertura: covs[0].codigo, descricao: 'Franquia normal', valor_centavos: 300000 }] : [],
    assistencias: [{ codigo: 'guincho', nome: 'Guincho 400 km' }],
    formas_pagamento: [{ id: 'boleto-1x', meio: 'boleto', parcelas: 1, total_centavos: total },
      { id: 'cartao-10x', meio: 'cartao', parcelas: parc, valor_primeira_centavos: total - Math.floor(total / parc) * (parc - 1), valor_parcela_centavos: Math.floor(total / parc), total_centavos: total }],
    observacoes: null,
  };
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const [, mode = '', ...rest] = url.pathname.split('/');
    const path = rest.join('/');
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
      if (basic !== 'cli:sec') return send(res, 401, { error: 'invalid_client' });
      const tok = `oauth-${crypto.randomBytes(8).toString('hex')}`;
      seen.set(`token:${tok}`, true);
      return send(res, 200, { access_token: tok, token_type: 'Bearer', expires_in: 300 });
    }
    if (mode === 'redireciona') return send(res, 302, '', { location: 'http://169.254.169.254/latest/meta-data/' });
    if (!authorized(req)) return send(res, 401, { erro: 'não autorizado' });
    const name = { valida: 'Seguradora Aurora (teste)', indicativa: 'Seguradora Boreal (teste)', recusa: 'Seguradora Cerrado (teste)', lenta: 'Seguradora Duna (teste)',
      erro: 'Seguradora Estrela (teste)', instavel: 'Seguradora Farol (teste)', fora: 'Seguradora Gaia (teste)' }[mode] || 'Seguradora de teste';
    if (path === 'v1/status' && req.method === 'GET') return send(res, 200, { contrato: CONTRACT, status: 'ok', seguradora: name, ambiente: 'producao', ramos: ['auto', 'residencial'] });
    if (path !== 'v1/cotacoes' || req.method !== 'POST') return send(res, 404, { erro: 'rota não encontrada' });
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { erro: 'json inválido' }); }
    received.push({ mode, headers: { idem: req.headers['idempotency-key'] }, body });
    if (process.env.FAKE_LOG) console.log(JSON.stringify({ mode, body }));
    const idr = body.id_requisicao;
    if (mode === 'lenta') await new Promise((r) => setTimeout(r, 20000));
    if (mode === 'erro') return send(res, 503, { erro: 'indisponível' });
    if (mode === 'instavel') {
      const n = (seen.get(idr) || 0) + 1;
      seen.set(idr, n);
      if (n === 1) return send(res, 503, { erro: 'instável' });
    }
    if (mode === 'fora') return send(res, 200, { contrato: CONTRACT, id_requisicao: idr, ofertas: [{ seguradora: name, produto: 'X', status: 'valida', premio: { total_centavos: -5 }, campo_extra: true }] });
    if (mode === 'recusa') return send(res, 200, { contrato: CONTRACT, id_requisicao: idr, ofertas: [{ seguradora: name, produto: 'Auto', status: 'recusa', numero_cotacao: 'REC-778', motivo_recusa: 'CEP de pernoite fora da política de aceitação.' }] });
    return send(res, 200, { contrato: CONTRACT, id_requisicao: idr, ofertas: [offer(body, mode === 'indicativa' ? 'indicativa' : 'valida', name)] });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Seguradora de teste (padrão APOLVEN) em http://localhost:${PORT}`));
