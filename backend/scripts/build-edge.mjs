// Gera dist-edge/index.js: a API inteira em um arquivo para Supabase Edge Functions (Deno).
// Uso: npm run build:edge → supabase/functions/apolven-api-cf/index.ts (pacote embutido).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const version = (name) => lock.packages?.[`node_modules/${name}`]?.version || pkg.dependencies[name].replace(/^[^\d]*/, '');
const migDir = path.join(root, 'src/migrations');
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(migDir, name), 'utf8') }));

const used = new Set();
const npmExternals = {
  name: 'deno-externals',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      const id = args.path;
      // no Windows o ponto de entrada chega como caminho absoluto (D:\...): não é pacote npm
      if (args.kind === 'entry-point' || path.isAbsolute(id) || /^[A-Za-z]:[\\/]/.test(id)) return undefined;
      if (id.startsWith('node:')) return { path: id, external: true };
      if (builtinModules.includes(id.split('/')[0])) return { path: `node:${id}`, external: true };
      const parts = id.split('/');
      const name = id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const sub = id.slice(name.length);
      const spec = `npm:${name}@${version(name)}${sub}`;
      used.add(spec);
      return { path: spec, external: true };
    });
  },
};

await build({
  entryPoints: [path.join(root, 'src/edge.js')],
  outfile: path.join(root, 'dist-edge/index.js'),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  plugins: [npmExternals],
  define: { 'globalThis.__APOLVEN_MIGRATIONS__': JSON.stringify(migrations) },
  banner: {
    js: [
      "import nodeProcess from 'node:process';",
      "import { Buffer } from 'node:buffer';",
      '// o Edge Runtime não permite alterar variáveis de ambiente: a API usa uma cópia local',
      'const process = { argv: nodeProcess.argv, env: { ...(globalThis.Deno?.env?.toObject?.() ?? nodeProcess.env) } };',
      'process.env.DATABASE_URL ??= process.env.SUPABASE_DB_URL;',
      "process.env.DB_POOL_MAX ??= '3';",
      "process.env.NODE_ENV ??= 'production';",
      "process.env.DB_SCHEMA ??= 'apolven';",
    ].join('\n'),
  },
  minify: true, legalComments: 'none',
  logLevel: 'info',
});

// Função com o pacote embutido (site na Cloudflare): não depende do GitHub Pages da main para iniciar.
// Publicar: npx supabase functions deploy apolven-api-cf --project-ref <ref> --no-verify-jwt --use-api
{
    const code = fs.readFileSync(path.join(root, 'dist-edge/index.js'));
  const fnDir = path.join(root, 'supabase/functions/apolven-api-cf');
  fs.mkdirSync(fnDir, { recursive: true });
  // Pacote como módulo comum ao lado da função (app.js): a Supabase compila uma vez na publicação e cada instância nova
  // só carrega o módulo — sem descompactar base64/gzip nem recompilar via data: URL a cada início (início ~40% mais rápido).
  fs.writeFileSync(path.join(fnDir, 'app.js'), `// APOLVEN API (site na Cloudflare) — gerado por scripts/build-edge.mjs. Não edite: rode o build de novo.\n${code}`);
  fs.writeFileSync(path.join(fnDir, 'index.ts'), `// APOLVEN API (site na Cloudflare) — gerado por scripts/build-edge.mjs. Não edite: rode o build de novo.
// Edge Function "apolven-api-cf" com verify_jwt = false (a API faz a própria autenticação). O código da API está em app.js.
import './app.js';
`);
  console.log(`supabase/functions/apolven-api-cf/index.ts (app.js ${((code.length) / 1024).toFixed(0)} KB) pronto.`);
}
