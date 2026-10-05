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
