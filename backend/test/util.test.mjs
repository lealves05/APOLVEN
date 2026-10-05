// Testes unitários das regras de dinheiro e documentos (sem banco): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRate, splitEven, splitWeighted, cents, validDocument, maskDocument, addMonths, csvSafe, safeHttpsUrl } from '../src/util.js';
import { verifyTotp, totp } from '../src/auth.js';

test('percentual em centavos com arredondamento half-up', () => {
  assert.equal(applyRate(100000, 20), 20000);
  assert.equal(applyRate(333, 10), 33);   // 33,3 → 33
  assert.equal(applyRate(335, 10), 34);   // 33,5 → 34
  assert.equal(applyRate(123457, 12.5), 15432);
});
test('divisão sem perder centavos (resíduo nas primeiras partes)', () => {
  assert.deepEqual(splitEven(10000, 3), [3334, 3333, 3333]);
  const p = splitWeighted(10001, [50, 30, 20]);
  assert.equal(p.reduce((a, b) => a + b, 0), 10001);
});
test('centavos: só inteiros; desconhecido não vira zero', () => {
  assert.throws(() => cents(10.5));
  assert.equal(cents(null, { allowNull: true }), null);
  assert.throws(() => cents(-1));
});
test('CPF/CNPJ e máscara', () => {
  assert.ok(validDocument('529.982.247-25'));
  assert.ok(!validDocument('111.111.111-11'));
  assert.ok(validDocument('11.222.333/0001-81'));
  assert.ok(!maskDocument('52998224725').includes('98224'));
});
test('datas: fim de mês', () => assert.equal(addMonths('2026-01-31', 1), '2026-02-28'));
test('CSV sem injeção de fórmula', () => assert.ok(!String(csvSafe('=HYPERLINK("x")')).startsWith('=')));
test('URL só https', () => { assert.throws(() => safeHttpsUrl('http://x.com')); });
test('TOTP RFC 6238 (janela)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.ok(verifyTotp(secret, totp(secret)));
  assert.ok(!verifyTotp(secret, '000000') || totp(secret) === '000000');
});
