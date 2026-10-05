import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { assertSecret } from './auth.js';

const port = Number(process.env.PORT || 3334);

try {
  assertSecret();
  await migrate();
} catch (e) {
  console.error('[boot] falha ao migrar o banco:', e.message);
  process.exit(1);
}

createApp().listen(port, () => console.log(`APOLVEN API rodando na porta ${port}`));

// Servidor contínuo (local/VM): rotinas do agente de hora em hora. Na Cloudflare quem chama é o Cron Trigger do Worker
// (/api/agent/cron). Cada rotina confere o horário da corretora e evita envios duplicados.
if (process.env.AGENT_ROUTINES !== 'off') {
  const { runAll } = await import('./agent/routines.js');
  setInterval(() => { runAll().catch((e) => console.error('[agente] rotina falhou:', e.message)); }, 60 * 60 * 1000).unref();
}
