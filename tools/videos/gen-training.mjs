// Gera frontend/src/lib/training.js a partir do roteiro (lessons.mjs) e das durações finais dos vídeos.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { LESSONS, MODULES } from './lessons.mjs';
const PUB = fileURLToPath(new URL('../../frontend/public/treinamento', import.meta.url));
const dur = (f) => { try { return Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${PUB}/${f}.mp4`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString())); } catch { return 60; } };
const chunks = (say) => (Array.isArray(say) ? say : say ? [say] : []);
const lessons = LESSONS.map((l) => ({ n: l.n, file: l.file, mod: l.mod, s: dur(l.file), title: l.title, routes: l.routes, desc: l.desc, learn: l.learn,
  text: l.steps.flatMap((s) => chunks(s.say)).join(' ') }));
const total = lessons.reduce((a, l) => a + l.s, 0);
const src = `// Vídeo-aulas do APOLVEN — gerado por videokit-apolven/gen-training.mjs (não edite à mão).
// Arquivos em /public/treinamento/<file>.mp4 (narração + legenda na imagem), .vtt (transcrição), -capa.jpg e .jpg.
// \`routes\`: telas em que a aula é sugerida pelo botão de ajuda; \`text\`: falas (usadas na busca).
export const MODULES = ${JSON.stringify(MODULES, null, 2)};

export const LESSONS = ${JSON.stringify(lessons, null, 2)};

export const TOTAL_SECONDS = ${total};

const base = (import.meta.env.BASE_URL || '/').replace(/\\/$/, '');
export const videoUrl = (l) => \`\${base}/treinamento/\${l.file}.mp4\`;
export const posterUrl = (l) => \`\${base}/treinamento/\${l.file}-capa.jpg\`;
export const thumbUrl = (l) => \`\${base}/treinamento/\${l.file}.jpg\`;
export const captionsUrl = (l) => \`\${base}/treinamento/\${l.file}.vtt\`;
export const fmtDur = (s) => \`\${Math.floor(s / 60)}:\${String(Math.floor(s % 60)).padStart(2, '0')}\`;

/** Aula sugerida para a tela atual (a rota mais específica que combina). */
export function lessonFor(pathname) {
  let best = null; let len = -1;
  for (const l of LESSONS) {
    for (const r of l.routes) {
      const ok = r === '/' ? pathname === '/' : r.endsWith('/') ? pathname.startsWith(r) && pathname.length > r.length : pathname === r || pathname.startsWith(\`\${r}/\`);
      if (ok && r.length > len) { best = l; len = r.length; }
    }
  }
  return best;
}
`;
fs.writeFileSync(fileURLToPath(new URL('../../frontend/src/lib/training.js', import.meta.url)), src);
console.log(lessons.length, 'aulas,', Math.round(total / 60), 'min');
