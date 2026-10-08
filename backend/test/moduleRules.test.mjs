// Regras de módulo do plano: a regra mais específica decide; núcleo nunca é bloqueado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileModuleRules, moduleForRoute } from '../src/moduleRules.js';
import { FEATURES } from '../src/platform.js';

const rules = compileModuleRules(FEATURES);
const mod = (m, p) => moduleForRoute(rules, m, p);

test('cotação por API: só configuração e execução automática ficam no módulo novo', () => {
  assert.equal(mod('GET', '/integrations/api-contract'), 'cotacao_api');
  assert.equal(mod('PUT', '/integrations/connections/abc/api-config'), 'cotacao_api');
  assert.equal(mod('POST', '/quote-requests/q1/rounds/r1/run'), 'cotacao_api');
  assert.notEqual(mod('GET', '/integrations/connections/abc/api-config'), 'cotacao_api', 'leitura do vínculo não depende do módulo');
});

test('impressão, portal, multiunidades, comissões e importações', () => {
  assert.equal(mod('PUT', '/print-templates/policy'), 'impressao_personalizada');
  assert.notEqual(mod('GET', '/print-templates/policy'), 'impressao_personalizada', 'ler o modelo padrão continua liberado');
  assert.equal(mod('GET', '/portal-links'), 'portal_cliente');
  assert.equal(mod('POST', '/documents/d1/link'), 'portal_cliente');
  assert.equal(mod('POST', '/company/units'), 'multiunidades');
  assert.notEqual(mod('GET', '/company/units'), 'multiunidades', 'listar unidades é núcleo');
  assert.equal(mod('GET', '/commissions'), 'comissoes');
  assert.equal(mod('GET', '/reports/imports'), 'importacoes');
});

test('regra com método vence a regra só de prefixo', () => {
  const r = compileModuleRules({ a: { routes: ['/x'] }, b: { routes: ['POST /x'] } });
  assert.equal(moduleForRoute(r, 'POST', '/x/1'), 'b');
  assert.equal(moduleForRoute(r, 'GET', '/x/1'), 'a');
  assert.equal(moduleForRoute(r, 'GET', '/y'), null);
});
