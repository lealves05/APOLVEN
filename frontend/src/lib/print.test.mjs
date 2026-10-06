// Campos de mesclagem: resolução, "—" para ausentes e escape (o valor nunca vira HTML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPrintData, resolveField, SAMPLE_RAW, EMPTY, money, date, docMask } from './printFields.js';
import { renderDoc, renderDataTable } from './printRender.js';
import { DEFAULT_TEMPLATE } from './defaultTemplate.js';

const html = (el) => renderToStaticMarkup(React.createElement(React.Fragment, null, el));

test('formatos brasileiros e ausentes viram "—"', () => {
  assert.equal(money(219000).replace(/\s/g, ' '), 'R$ 2.190,00');
  assert.equal(money(null), EMPTY);
  assert.equal(date('2026-10-16'), '16/10/2026');
  assert.equal(date(undefined), EMPTY);
  assert.equal(docMask('12345678909'), '123.456.789-09');
  assert.equal(docMask('12345678000195'), '12.345.678/0001-95');
});

test('resolve campos do exemplo e nunca devolve undefined/null', () => {
  const d = buildPrintData(SAMPLE_RAW, { today: '2026-10-06' });
  assert.equal(resolveField(d, 'cliente.nome'), 'Ana Beatriz Oliveira');
  assert.equal(resolveField(d, 'apolice.vigencia'), '16/10/2026 a 16/10/2027');
  assert.equal(resolveField(d, 'emissao.data'), '06/10/2026');
  assert.equal(resolveField(d, 'apolice.observacoes'), EMPTY);
  assert.equal(resolveField(d, 'campo.inexistente'), EMPTY);
  const empty = buildPrintData({});
  for (const [k, v] of Object.entries(empty.fields)) assert.ok(v && !/undefined|null|NaN/.test(v), `${k} = ${v}`);
});

test('valores com HTML são escapados na renderização', () => {
  const raw = { ...SAMPLE_RAW, client: { ...SAMPLE_RAW.client, name: '<img src=x onerror=alert(1)>' }, coverages: [{ name: '<script>alert(1)</script>' }] };
  const d = buildPrintData(raw);
  const out = html(renderDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mergeField', attrs: { key: 'cliente.nome' } }] }, { type: 'dataTable', attrs: { source: 'coberturas' } }] }, { data: d }));
  assert.ok(!out.includes('<img src=x'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!out.includes('<script>'));
});

test('estilos e imagens inseguros são ignorados', () => {
  const d = buildPrintData(SAMPLE_RAW, { logo: 'javascript:alert(1)' });
  assert.equal(d.logo, null);
  const out = html(renderDoc({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(//evil)' } }] }] },
    { type: 'image', attrs: { src: 'https://evil.example/a.png' } },
    { type: 'image', attrs: { src: 'logo:corretora' } },
  ] }, { data: d }));
  assert.ok(!out.includes('evil'));
  assert.ok(!out.includes('<img'));
});

test('tabela repetida: uma linha por registro e "Nenhum registro" quando vazia', () => {
  const d = buildPrintData(SAMPLE_RAW);
  const out = html(renderDataTable({ attrs: { source: 'parcelas', columns: ['numero', 'valor'] } }, { data: d }, 'k'));
  assert.equal((out.match(/<tr>/g) || []).length, 1 + SAMPLE_RAW.installments.length);
  assert.ok(!out.includes('Vencimento'));
  const none = html(renderDataTable({ attrs: { source: 'itens' } }, { data: buildPrintData({}) }, 'k'));
  assert.ok(none.includes('Nenhum registro'));
});

test('modelo padrão renderiza sem "undefined"', () => {
  const out = html(renderDoc(DEFAULT_TEMPLATE.doc, { data: buildPrintData({}) }));
  assert.ok(out.length > 500);
  assert.ok(!/undefined|NaN|null/.test(out));
});
