// API de cotação "padrão APOLVEN": contrato publicado, dados mínimos na requisição, validação estrita e mapeamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT, EXAMPLES, validateResponse, validateStatus, buildQuoteRequest, mapResponse, REQUEST_SCHEMA } from '../src/lib/quoteApi.js';
import { DOCS_DIR, FILES, render } from '../scripts/api-contract.mjs';

test('docs/api-cotacao está igual ao contrato do código (rode scripts/api-contract.mjs)', () => {
  for (const [name, v] of Object.entries(FILES)) {
    assert.equal(fs.readFileSync(path.join(DOCS_DIR, name), 'utf8'), render(v), `${name} desatualizado`);
  }
});

test('exemplos do contrato passam na validação', () => {
  assert.equal(validateResponse(EXAMPLES.resposta, EXAMPLES.resposta.id_requisicao).ok, true);
  assert.equal(validateResponse(EXAMPLES.recusa).ok, true);
  assert.equal(validateStatus(EXAMPLES.status).ok, true);
});

const resp = (offer, extra = {}) => ({ contrato: CONTRACT, id_requisicao: 'abc', ofertas: [offer], ...extra });
const base = EXAMPLES.resposta.ofertas[0];

test('resposta fora do contrato é recusada (campos extras, tipos, regras de status)', () => {
  assert.equal(validateResponse(resp(base, { extra: 1 })).ok, false, 'campo extra no topo');
  assert.equal(validateResponse(resp({ ...base, html: '<b>' })).ok, false, 'campo extra na oferta');
  assert.equal(validateResponse(resp({ ...base, premio: { total_centavos: '245000' } })).ok, false, 'valor como texto');
  assert.equal(validateResponse(resp({ ...base, premio: { total_centavos: 0 } })).ok, false, 'prêmio zero');
  assert.equal(validateResponse(resp({ ...base, premio: { total_centavos: 10.5 } })).ok, false, 'centavos fracionados');
  const { numero_cotacao, ...semNumero } = base; // eslint-disable-line no-unused-vars
  assert.equal(validateResponse(resp(semNumero)).ok, false, 'válida sem número da cotação');
  assert.equal(validateResponse(resp({ ...base, status: 'recusa', premio: undefined })).ok, false, 'recusa sem motivo');
  assert.equal(validateResponse(resp({ ...base, validade: '2026-13-45' })).ok, false, 'data inválida');
  assert.equal(validateResponse({ ...resp(base), contrato: 'outro/9' }).ok, false, 'contrato errado');
  assert.equal(validateResponse(resp(base), 'outro-id').ok, false, 'id_requisicao diferente');
  assert.equal(validateResponse({ contrato: CONTRACT, id_requisicao: 'abc', ofertas: [] }).ok, false, 'sem ofertas');
  const parc = { ...base, formas_pagamento: [{ meio: 'cartao', parcelas: 3, valor_primeira_centavos: 100, valor_parcela_centavos: 100, total_centavos: 999 }] };
  assert.equal(validateResponse(resp(parc)).ok, false, 'parcelas que não fecham');
});

test('requisição leva só o necessário para cotar (sem e-mail, telefone, observações)', () => {
  const { body, fields } = buildQuoteRequest({
    taskId: 't-1',
    request: { branch: 'auto', number: 12, number_label: 'COT-00012' },
    round: { round_no: 1, risk_schema_version: 'auto-1', risk_data: { placa: 'ABC1D23', uso: 'particular', chassi: null }, min_coverages: [{ code: 'casco', name: 'Casco', required: true }],
      preferences: { assistances: ['Guincho'], notes: 'cliente difícil — interno', sharing_basis: 'pedido do cliente' }, start_date: '2026-11-01', end_date: '2027-11-01' },
    scenario: 'minima',
    client: { kind: 'pf', name: 'Ana', document: '123.456.789-09', birth_date: '1990-01-02', email: 'ana@x.com', phone: '1999', notes: 'vip', address: { cep: '13000-000', city: 'Campinas', uf: 'SP', street: 'Rua X' } },
    company: { document: '12.345.678/0001-95', susep_code: '10.2', email: 'c@x.com' },
    connection: { broker_code: 'B1', api_config: { base_url: 'https://x' } },
  });
  const text = JSON.stringify(body);
  for (const forbidden of ['ana@x.com', '1999', 'vip', 'Rua X', 'cliente difícil', 'c@x.com', 'sharing_basis']) assert.ok(!text.includes(forbidden), `não envia ${forbidden}`);
  assert.equal(body.segurado.documento, '12345678909');
  assert.equal(body.corretora.cnpj, '12345678000195');
  assert.equal(body.risco.chassi, null, 'resposta desconhecida segue como null');
  assert.equal(body.cotacao.numero, 'COT-00012');
  assert.ok(fields.includes('segurado.documento') && fields.includes('risco.placa') && !fields.includes('risco.chassi'));
  // chaves de topo e de segurado previstas no schema
  for (const k of Object.keys(body)) assert.ok(REQUEST_SCHEMA.properties[k], `chave ${k} no schema`);
  for (const k of Object.keys(body.segurado)) assert.ok(REQUEST_SCHEMA.properties.segurado.properties[k], `segurado.${k} no schema`);
});

test('mapeamento: válida, indicativa, recusa e validade vencida', () => {
  const ok = mapResponse(EXAMPLES.resposta, '2026-10-06');
  assert.equal(ok.status, 'cotacao_valida');
  assert.equal(ok.offers[0].total_premium_cents, 245000);
  assert.equal(ok.offers[0].coverages[0].deductible_cents, 350000);
  assert.equal(ok.offers[0].payment_options[1].installments, 10);
  const ind = mapResponse(resp({ ...base, status: 'indicativa', numero_cotacao: null, validade: null }), '2026-10-06');
  assert.equal(ind.status, 'valor_indicativo');
  const rec = mapResponse(EXAMPLES.recusa, '2026-10-06');
  assert.equal(rec.status, 'recusa_informada');
  assert.equal(rec.offers.length, 0);
  assert.match(rec.refusal.reason, /pernoite/);
  const old = mapResponse(resp({ ...base, validade: '2026-01-01' }), '2026-10-06');
  assert.equal(old.offers[0].quote_kind, 'valor_indicativo', 'cotação vencida não vira "válida"');
});
