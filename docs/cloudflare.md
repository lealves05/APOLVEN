# APOLVEN na Cloudflare (branch `cloudflare`)

Mesmo procedimento do TORVEN/RUSTEN (documento geral da migração: `ORBI/docs/cloudflare.md`).

- Endereço: **https://apolven.lorler.com.br** (Worker `apolven-web`; enquanto o domínio não estiver ativo, `apolven-web.<conta>.workers.dev`).
- O Worker (`cloudflare/worker.js`, idêntico ao dos outros sistemas) serve o site (`frontend/dist`) e encaminha `/api/*`
  para a Edge Function **`apolven-api-cf`** da Supabase, projeto `dwfbxrfniarhufltmlhb` (o mesmo do TORVEN e do RUSTEN).
- Banco: schema próprio **`apolven`** (o `search_path` contém só esse schema — nenhuma tabela do TORVEN ou do RUSTEN é lida).
  As migrações vão embutidas no pacote e rodam sozinhas na primeira chamada (trava `pg_advisory_lock`).
- Segredos gerados automaticamente na primeira execução, em `apolven._secrets` (RLS ligado, sem acesso por `anon`/`authenticated`):
  `jwt_secret` (sessões) e `vault_key` (cofre das credenciais das seguradoras e dos segredos de MFA — **não apague**:
  sem ela as credenciais gravadas ficam ilegíveis e precisam ser cadastradas de novo).
- IP real nos limites de tentativa: `backend/src/edgeProxy.js` + segredo `EDGE_PROXY_KEY` (o mesmo arquivo
  `%USERPROFILE%\.plataforma-cloudflare\edge-dwfb.key` usado pelo TORVEN e pelo RUSTEN).
- Agendador do agente do WhatsApp: Cron Trigger `7 * * * *` do Worker → `/api/agent/cron`, com o segredo
  `CRON_SECRET` (Worker) = `APOLVEN_CRON_SECRET` (Supabase), gerado pelo .bat em `%USERPROFILE%\.plataforma-cloudflare\apolven-cron.key`.
  Webhook da Meta: `https://apolven.lorler.com.br/api/whatsapp/webhook` (ver `docs/whatsapp.md`).
- Publicar: `PUBLICAR-CLOUDFLARE.bat` (envia a branch ao GitHub sem alterar a `main`, gera o site e o pacote da API e publica os dois).
- Build manual: `cd backend && npm run build:edge` → `supabase/functions/apolven-api-cf/index.ts`;
  `npx supabase functions deploy apolven-api-cf --project-ref dwfbxrfniarhufltmlhb --no-verify-jwt --use-api`;
  `cd frontend && npm run build:cloudflare && npx wrangler deploy -c ../cloudflare/wrangler.jsonc --domain apolven.lorler.com.br`.

## Central (Master)

Em Master › Sistemas, cadastrar:

| Campo | Valor |
|---|---|
| Código | `apolven` |
| API | `https://dwfbxrfniarhufltmlhb.supabase.co/functions/v1/apolven-api-cf` |
| Site | `https://apolven.lorler.com.br` |
| Página de assinatura | `/assinatura` |

Depois, gravar no banco (SQL Editor da Supabase) o endereço da central e o segredo exibido pelo Master:

```sql
insert into apolven._secrets (key, value) values
  ('platform_hub_url', 'https://master.lorler.com.br'),
  ('platform_secret', '<segredo gerado no Master>')
on conflict (key) do update set value = excluded.value;
```

Sem essas duas linhas o sistema funciona normalmente, apenas sem bloqueio/liberação pela central.
