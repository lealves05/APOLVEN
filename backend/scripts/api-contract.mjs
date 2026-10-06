// Gera os JSON Schemas e exemplos do contrato "padrão APOLVEN" (apolven-cotacao/1) em docs/api-cotacao/.
// Uso: node scripts/api-contract.mjs   (um teste unitário confere se os arquivos estão atualizados)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUEST_SCHEMA, RESPONSE_SCHEMA, STATUS_SCHEMA, EXAMPLES } from '../src/lib/quoteApi.js';

export const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/api-cotacao');
export const FILES = {
  'requisicao.schema.json': REQUEST_SCHEMA,
  'resposta.schema.json': RESPONSE_SCHEMA,
  'status.schema.json': STATUS_SCHEMA,
  'exemplo-requisicao.json': EXAMPLES.requisicao,
  'exemplo-resposta.json': EXAMPLES.resposta,
  'exemplo-recusa.json': EXAMPLES.recusa,
  'exemplo-status.json': EXAMPLES.status,
};
export const render = (v) => `${JSON.stringify(v, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  for (const [name, v] of Object.entries(FILES)) fs.writeFileSync(path.join(DOCS_DIR, name), render(v));
  console.log(`Contrato gravado em ${DOCS_DIR}`);
}
