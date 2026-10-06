// Demonstração exige login próprio: nome, e-mail válido e senha dentro da política.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSchema } from '../src/routes/auth.js';

test('demonstração sem credenciais é recusada', () => {
  assert.equal(demoSchema.safeParse({}).success, false);
  assert.equal(demoSchema.safeParse({ name: 'Ana' }).success, false);
  assert.equal(demoSchema.safeParse({ name: 'Ana', email: 'ana@exemplo.com' }).success, false);
});

test('demonstração recusa e-mail inválido e senha fraca', () => {
  assert.equal(demoSchema.safeParse({ name: 'Ana', email: 'ana@', password: 'Corretora2026xy' }).success, false);
  assert.equal(demoSchema.safeParse({ name: 'Ana', email: 'ana@exemplo.com', password: '123' }).success, false);
  assert.equal(demoSchema.safeParse({ name: 'Ana', email: 'ana@exemplo.com', password: 'aaaaaaaaaaaa' }).success, false);
});

test('demonstração com nome, e-mail e senha válidos é aceita (e-mail normalizado)', () => {
  const r = demoSchema.safeParse({ name: ' Ana Lima ', email: ' Ana@Exemplo.com ', password: 'Corretora2026xy' });
  assert.equal(r.success, true);
  assert.equal(r.data.email, 'ana@exemplo.com');
  assert.equal(r.data.name, 'Ana Lima');
});
