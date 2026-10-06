// Proteção contra SSRF nas APIs informadas pela corretora: faixas de IP, validação do endereço, localhost só com a
// variável de desenvolvimento, sem redirecionamento, limite de tamanho e de tempo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPublicIp, validateApiUrl, resolvePublic, secureRequest, safeHeaderName, joinUrl, parseJsonStrict } from '../src/lib/safeHttp.js';

const code = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return e.code || e.message; } };

test('faixas de IP privadas, reservadas e de metadados são bloqueadas (IPv4 e IPv6)', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.0.10', '100.64.0.1', '100.127.255.255', '0.0.0.0',
    '224.0.0.1', '239.255.255.250', '255.255.255.255', '192.0.2.5', '198.18.0.1', '203.0.113.9',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2002:a00:1::1', '2001::1']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '200.147.67.142', '172.32.0.1', '100.128.0.1', '2804:14c:5b40::1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicIp(ip), true, ip);
  }
});

test('endereço: só https, sem IP literal, sem credencial, query ou porta baixa', async () => {
  delete process.env.APOLVEN_ALLOW_LOCAL_API;
  const bad = ['http://api.exemplo.com.br', 'https://10.0.0.1/api', 'https://[::1]/x', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://user:pw@api.exemplo.com.br',
    'https://api.exemplo.com.br/?x=1', 'https://api.exemplo.com.br/#a', 'https://api.exemplo.com.br:22/', 'https://localhost/', 'http://localhost:4890/',
    'https://metadata.google.internal/', 'https://intranet/', 'ftp://api.exemplo.com.br', 'javascript:alert(1)', 'file:///etc/passwd'];
  for (const u of bad) assert.notEqual(await code(() => validateApiUrl(u)), 'ok', u);
  assert.equal(await code(() => validateApiUrl('https://api.seguradora.com.br/apolven')), 'ok');
  assert.equal(await code(() => validateApiUrl('https://api.seguradora.com.br:8443/apolven')), 'ok');
});

test('DNS: nome que resolve para rede interna é bloqueado; localhost só com APOLVEN_ALLOW_LOCAL_API=1', async () => {
  delete process.env.APOLVEN_ALLOW_LOCAL_API;
  assert.equal(await code(() => resolvePublic('localhost')), 'HOST_BLOCKED');
  process.env.APOLVEN_ALLOW_LOCAL_API = '1';
  assert.equal(validateApiUrl('http://localhost:4890/x').local, true);
  assert.equal(await code(() => resolvePublic('localhost', { local: true })), 'ok');
  assert.equal(await code(() => resolvePublic('localhost')), 'ok', 'nome que resolve para loopback: só com a variável');
  assert.equal(await code(() => validateApiUrl('http://10.0.0.1:4890/')), 'URL_INVALID', 'a variável libera só localhost, não a rede interna');
  delete process.env.APOLVEN_ALLOW_LOCAL_API;
});

test('cabeçalho da chave e caminho fixo', () => {
  assert.equal(safeHeaderName('X-API-Key'), 'X-API-Key');
  for (const h of ['Host', 'Content-Length', 'Cookie', 'X Bad', 'X-Key\r\nInjected: 1', '', 'Idempotency-Key']) assert.equal(safeHeaderName(h), null, h);
  assert.equal(joinUrl('https://a.com.br/base/', 'v1/cotacoes'), 'https://a.com.br/base/v1/cotacoes');
  assert.throws(() => parseJsonStrict('[1]'));
  assert.throws(() => parseJsonStrict('{"a":1}x'));
});

test('requisição: não segue redirecionamento, limita tamanho e tempo', async () => {
  process.env.APOLVEN_ALLOW_LOCAL_API = '1';
  const srv = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); return; }
    if (req.url === '/grande') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(`"${'x'.repeat(4096)}"`); return; }
    if (req.url === '/lenta') { setTimeout(() => { res.end('{}'); }, 3000); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ host: req.headers.host }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    assert.equal(await code(() => secureRequest(`${base}/redir`)), 'REDIRECT_BLOCKED');
    assert.equal(await code(() => secureRequest(`${base}/grande`, { maxBytes: 1024 })), 'TOO_LARGE');
    assert.equal(await code(() => secureRequest(`${base}/lenta`, { timeoutMs: 1000 })), 'TIMEOUT');
    const ok = await secureRequest(`${base}/ok`);
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.text).host, `localhost:${srv.address().port}`, 'Host original preservado com IP fixado');
  } finally {
    srv.close();
    delete process.env.APOLVEN_ALLOW_LOCAL_API;
  }
});
