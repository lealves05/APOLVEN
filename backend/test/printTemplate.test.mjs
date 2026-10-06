// Modelo de impressão: validação estrita no servidor e logotipo conferido pela assinatura do arquivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate, validateDoc, validatePage, decodeImage, FIELD_KEYS, TABLE_COLUMNS } from '../src/lib/printTemplate.js';
import { DEFAULT_TEMPLATE } from '../../frontend/src/lib/defaultTemplate.js';
import { FIELD_KEYS as FRONT_KEYS, TABLE_SOURCES } from '../../frontend/src/lib/printFields.js';

const doc = (...content) => ({ type: 'doc', content });
const para = (...content) => ({ type: 'paragraph', content });
const bad = (fn, re) => assert.throws(fn, (e) => e.status === 400 && (!re || re.test(e.message)));

test('campos e tabelas do servidor e do navegador são os mesmos', () => {
  assert.deepEqual([...FIELD_KEYS].sort(), [...FRONT_KEYS].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(TABLE_SOURCES).map(([k, v]) => [k, v.columns.map(([c]) => c)])), TABLE_COLUMNS);
});

test('modelo padrão é válido', () => {
  const t = validateTemplate(DEFAULT_TEMPLATE);
  assert.equal(t.page.paper, 'A4');
});

test('recusa nós, atributos e marcas desconhecidos (nada de HTML/script)', () => {
  bad(() => validateDoc(doc({ type: 'script', content: [] })), /não permitido|não pode/);
  bad(() => validateDoc(doc(para({ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }))), /formatação/);
  bad(() => validateDoc(doc({ type: 'paragraph', attrs: { onclick: 'x' }, content: [] })), /atributo/);
  bad(() => validateDoc(doc(para({ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(x)' } }] }))), /cor/);
  bad(() => validateDoc(doc(para({ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { fontSize: '12pt;x' } }] }))), /fonte/);
  bad(() => validateDoc(doc(para({ type: 'text', text: 'x', html: '<b>' }))), /propriedade/);
});

test('imagens: só PNG/JPEG/WEBP embutidas ou o logotipo', () => {
  bad(() => validateDoc(doc({ type: 'image', attrs: { src: 'https://evil.example/x.png' } })), /imagem/);
  bad(() => validateDoc(doc({ type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2Zz4=' } })), /imagem/);
  bad(() => validateDoc(doc({ type: 'image', attrs: { src: 'javascript:alert(1)' } })), /imagem/);
  assert.ok(validateDoc(doc({ type: 'image', attrs: { src: 'logo:corretora', width: 120 } })));
  assert.ok(validateDoc(doc({ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: null, title: null, width: null } })));
});

test('campos de mesclagem e tabelas de dados conhecidos', () => {
  assert.ok(validateDoc(doc(para({ type: 'mergeField', attrs: { key: 'cliente.nome' }, marks: [{ type: 'bold' }] }))));
  bad(() => validateDoc(doc(para({ type: 'mergeField', attrs: { key: 'process.env' } }))), /desconhecido/);
  assert.ok(validateDoc(doc({ type: 'dataTable', attrs: { source: 'parcelas', columns: ['numero', 'valor'] } })));
  bad(() => validateDoc(doc({ type: 'dataTable', attrs: { source: 'usuarios' } })), /tabela/);
  bad(() => validateDoc(doc({ type: 'dataTable', attrs: { source: 'parcelas', columns: ['senha'] } })), /colunas/);
  bad(() => validateDoc(doc({ type: 'mergeField', attrs: { key: 'cliente.nome' } })), /não pode ficar/);
});

test('página: papel, orientação e margens dentro dos limites', () => {
  assert.deepEqual(validatePage({ paper: 'Letter', orientation: 'landscape', margins: { top: 10, right: 10, bottom: 10, left: 10 } }).paper, 'Letter');
  bad(() => validatePage({ paper: 'A3', orientation: 'portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 } }), /papel/);
  bad(() => validatePage({ paper: 'A4', orientation: 'portrait', margins: { top: 1, right: 10, bottom: 10, left: 10 } }), /margens/);
});

test('modelo grande demais é recusado', () => {
  const big = 'A'.repeat(19_000);
  const content = Array.from({ length: 140 }, () => para({ type: 'text', text: big }));
  bad(() => validateTemplate({ doc: doc(...content), page: { paper: 'A4', orientation: 'portrait', margins: { top: 10, right: 10, bottom: 10, left: 10 } } }), /2,5 MB/);
});

test('logotipo: assinatura confere com o tipo; SVG e arquivo disfarçado recusados', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(decodeImage(`data:image/png;base64,${png.toString('base64')}`, 1000).mime, 'image/png');
  bad(() => decodeImage(`data:image/jpeg;base64,${png.toString('base64')}`, 1000), /não confere/);
  bad(() => decodeImage(`data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`, 1000), /não é uma imagem/);
  bad(() => decodeImage('data:image/svg+xml;base64,PHN2Zz4=', 1000), /SVG/);
  bad(() => decodeImage(`data:image/png;base64,${png.toString('base64')}`, 5), /maior/);
});
