# APOLVEN — referência da API

Gerado a partir de `backend/src/routes`. Contratos detalhados (validação zod e mensagens) estão nos próprios arquivos.

Autenticação: `Authorization: Bearer <token>` em `/api/v1/*`. Dinheiro em centavos inteiros (`*_cents`). Erros: `{ error, code?, correlation_id }`.

## /api/auth  
_(routes/auth.js)_

| Método | Caminho | Permissão |
|---|---|---|
| POST | `/api/auth/register` |  |
| POST | `/api/auth/login` |  |
| POST | `/api/auth/mfa/verify` |  |
| POST | `/api/auth/mfa/setup` |  |
| POST | `/api/auth/mfa/enable` |  |
| POST | `/api/auth/mfa/disable` |  |
| GET | `/api/auth/reset-options` |  |
| POST | `/api/auth/forgot` |  |
| POST | `/api/auth/reset` |  |
| GET | `/api/auth/me` |  |
| PUT | `/api/auth/me` |  |
| POST | `/api/auth/demo` |  |
| POST | `/api/auth/activate` |  |

## /api/public  
_(routes/public.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/public/comparativo/:token` |  |
| POST | `/api/public/comparativo/:token/choose` |  |
| GET | `/api/public/parcelas/:token` |  |
| POST | `/api/public/parcelas/:token/comprovante` |  |
| GET | `/api/public/documento/:token` |  |

## /api/platform/v1  
_(routes/platform.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/platform/v1/manifest` |  |
| GET | `/api/platform/v1/tenants` |  |
| GET | `/api/platform/v1/tenants/:id` |  |
| POST | `/api/platform/v1/tenants/:id/access` |  |
| POST | `/api/platform/v1/tenants/:id/owner-reset` |  |
| GET | `/api/platform/v1/settings` |  |
| PUT | `/api/platform/v1/settings` |  |
| GET | `/api/platform/v1/tenants/:id/settings` |  |
| PUT | `/api/platform/v1/tenants/:id/settings` |  |

## /api/whatsapp  
_(routes/whatsapp.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/whatsapp/webhook` |  |
| POST | `/api/whatsapp/webhook` |  |

## /api/agent  
_(routes/whatsapp.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/agent/cron` |  |

## /api/v1/billing  
_(routes/platform.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/billing` |  |
| POST | `/api/v1/billing/checkout` |  |
| POST | `/api/v1/billing/renew` |  |
| POST | `/api/v1/billing/change-plan` |  |
| POST | `/api/v1/billing/cancel` |  |
| POST | `/api/v1/billing/refresh` |  |

## /api/v1/company  
_(routes/company.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/company` |  |
| PUT | `/api/v1/company` | settings |
| GET | `/api/v1/company/units` |  |
| POST | `/api/v1/company/units` | units_manage |
| PUT | `/api/v1/company/units/:id` | units_manage |
| GET | `/api/v1/company/users` |  |
| POST | `/api/v1/company/users` | users |
| PUT | `/api/v1/company/users/:id` | users |
| POST | `/api/v1/company/users/:id/reset-mfa` | users |
| GET | `/api/v1/company/permissions` |  |
| GET | `/api/v1/company/logo` |  |
| PUT | `/api/v1/company/logo` | settings |
| DELETE | `/api/v1/company/logo` | settings |

## /api/v1/print-templates  
_(routes/printTemplates.js)_ — modelo de impressão da apólice (JSON do editor, validado em `lib/printTemplate.js`)

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/print-templates/policy?branch=&exact=1` | policies_view |
| PUT | `/api/v1/print-templates/policy` | settings |
| DELETE | `/api/v1/print-templates/policy?branch=` | settings |

## /api/v1/clients  
_(routes/clients.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/clients` | clients_view |
| POST | `/api/v1/clients` | clients_edit |
| GET | `/api/v1/clients/duplicates` | clients_edit |
| GET | `/api/v1/clients/export` | clients_export |
| GET | `/api/v1/clients/:id` | clients_view |
| PUT | `/api/v1/clients/:id` | clients_edit |
| POST | `/api/v1/clients/:id/contacts` | clients_edit |
| DELETE | `/api/v1/clients/:id/contacts/:cid` | clients_edit |
| POST | `/api/v1/clients/:id/relationships` | clients_edit |
| DELETE | `/api/v1/clients/:id/relationships/:rid` | clients_edit |
| POST | `/api/v1/clients/:id/consents` | clients_edit |
| POST | `/api/v1/clients/:id/consents/:cid/revoke` | clients_edit |
| POST | `/api/v1/clients/:id/activities` | clients_view |
| POST | `/api/v1/clients/:id/merge` | clients_edit |

## /api/v1/privacy-requests  
_(routes/clients.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/privacy-requests` | privacy |
| POST | `/api/v1/privacy-requests` | privacy |
| PUT | `/api/v1/privacy-requests/:id` | privacy |

## /api/v1/opportunities  
_(routes/crm.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/opportunities` | opportunities |
| POST | `/api/v1/opportunities` | opportunities |
| PUT | `/api/v1/opportunities/:id` | opportunities |
| GET | `/api/v1/opportunities/:id` | opportunities |

## /api/v1/tasks  
_(routes/crm.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/tasks` |  |
| POST | `/api/v1/tasks` |  |
| PUT | `/api/v1/tasks/:id` |  |

## /api/v1/catalog  
_(routes/catalog.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/catalog/meta` |  |
| GET | `/api/v1/catalog/institutions` |  |
| GET | `/api/v1/catalog/products` |  |
| POST | `/api/v1/catalog/products` | products |
| PUT | `/api/v1/catalog/products/:id` | products |
| POST | `/api/v1/catalog/products/:id/status` | products |
| GET | `/api/v1/catalog/eligible` | quotes_view |

## /api/v1/integrations  
_(routes/integrations.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/integrations/catalog` | integrations_view |
| GET | `/api/v1/integrations/templates/:code` | integrations_view |
| POST | `/api/v1/integrations/institutions` | integrations_manage |
| PUT | `/api/v1/integrations/institutions/:id` | integrations_manage |
| GET | `/api/v1/integrations/connections` | integrations_view |
| POST | `/api/v1/integrations/connections` | integrations_manage |
| GET | `/api/v1/integrations/connections/:id` | integrations_view |
| PATCH | `/api/v1/integrations/connections/:id` | integrations_manage |
| PUT | `/api/v1/integrations/connections/:id/requirements/:code` | integrations_manage |
| POST | `/api/v1/integrations/connections/:id/request-text` | integrations_manage |
| POST | `/api/v1/integrations/connections/:id/request-evaluation` | integrations_manage |
| PUT | `/api/v1/integrations/connections/:id/credentials` | credentials_manage |
| POST | `/api/v1/integrations/connections/:id/connection-tests` | integrations_manage |
| POST | `/api/v1/integrations/connections/:id/capabilities/:cap/evidence` | integrations_manage |
| POST | `/api/v1/integrations/connections/:id/capabilities/activate` | integrations_manage |
| POST | `/api/v1/integrations/connections/:id/pause` | integrations_manage |
| POST | `/api/v1/integrations/connections/:id/revoke` | credentials_manage |
| GET | `/api/v1/integrations/pendencias` | integrations_view |
| GET | `/api/v1/integrations/history` | integrations_view |
| GET | `/api/v1/integrations/api-contract` | integrations_view |
| PUT | `/api/v1/integrations/connections/:id/api-config` | credentials_manage (+ MFA/reautenticação) |

API de cotação "padrão APOLVEN" (`apolven-cotacao/1`): o APOLVEN chama `GET {base}/v1/status` (teste) e `POST {base}/v1/cotacoes`
(cotação). JSON Schemas e exemplos em `docs/api-cotacao/` (gerados por `node scripts/api-contract.mjs`). Endereços informados pela
corretora passam pela proteção contra SSRF de `lib/safeHttp.js` (https, IP público conferido no cadastro e em cada chamada, conexão no
IP conferido, sem redirecionamento, resposta até 512 KB). `APOLVEN_ALLOW_LOCAL_API=1` libera somente localhost, para desenvolvimento
e testes (`node scripts/fake-insurer.mjs`); nunca use em produção. `APOLVEN_QUOTE_API_RATE` = consultas por minuto por corretora (padrão 120).

## /api/v1/quote-requests  
_(routes/quotes.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/quote-requests` | quotes_view |
| POST | `/api/v1/quote-requests` | quotes_manage |
| GET | `/api/v1/quote-requests/:id` | quotes_view |
| POST | `/api/v1/quote-requests/:id/rounds` | quotes_manage |
| POST | `/api/v1/quote-requests/:id/rounds/:rid/cancel` | quotes_manage |
| POST | `/api/v1/quote-requests/:id/rounds/:rid/run` | quotes_manage |
| PUT | `/api/v1/quote-requests/tasks/:tid` | quotes_manage |
| POST | `/api/v1/quote-requests/tasks/:tid/offers` | quotes_manage |
| POST | `/api/v1/quote-requests/offers/:oid/withdraw` | quotes_manage |
| GET | `/api/v1/quote-requests/tasks/:tid/api-calls` | quotes_manage |

## /api/v1/comparisons  
_(routes/quotes.js)_

| Método | Caminho | Permissão |
|---|---|---|
| POST | `/api/v1/comparisons` | quotes_manage |
| GET | `/api/v1/comparisons/:id` | quotes_view |
| POST | `/api/v1/comparisons/:id/approve` | comparisons_send |
| POST | `/api/v1/comparisons/:id/link` | comparisons_send |
| POST | `/api/v1/comparisons/:id/links/:lid/revoke` | comparisons_send |
| POST | `/api/v1/comparisons/:id/choose` | quotes_manage |

## /api/v1/proposals  
_(routes/proposals.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/proposals` | quotes_view |
| POST | `/api/v1/proposals` | proposals_manage |
| GET | `/api/v1/proposals/:id` | quotes_view |
| POST | `/api/v1/proposals/:id/approve-internal` | proposals_approve |
| POST | `/api/v1/proposals/:id/authorizations` | proposals_manage |
| POST | `/api/v1/proposals/:id/submit` | proposals_submit |
| POST | `/api/v1/proposals/:id/operations/:oid/resolve` | proposals_submit |
| POST | `/api/v1/proposals/:id/status` | proposals_manage |
| POST | `/api/v1/proposals/:id/policy` | policies_manage |

## /api/v1/policies  
_(routes/policies.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/policies` | policies_view |
| POST | `/api/v1/policies` | policies_manage |
| GET | `/api/v1/policies/:id` | policies_view |
| GET | `/api/v1/policies/:id/print-data` | policies_view |
| PUT | `/api/v1/policies/:id` | policies_manage |
| POST | `/api/v1/policies/:id/verify` | policies_verify |
| POST | `/api/v1/policies/:id/status` | policies_manage |
| POST | `/api/v1/policies/:id/items` | policies_manage |
| POST | `/api/v1/policies/:id/installments` | policies_manage |
| POST | `/api/v1/policies/:id/installments/plan` | policies_manage |
| POST | `/api/v1/policies/:id/commission` | commissions_rules |
| POST | `/api/v1/policies/:id/splits` | splits_manage |
| DELETE | `/api/v1/policies/:id/splits/:sid` | splits_manage |
| POST | `/api/v1/policies/:id/endorsements` | endorsements |
| PUT | `/api/v1/policies/endorsements/:eid` | endorsements |
| POST | `/api/v1/policies/:id/cancellations` | endorsements |
| PUT | `/api/v1/policies/cancellations/:cid` | endorsements |

## /api/v1/renewals  
_(routes/policies.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/renewals` | renewals |
| POST | `/api/v1/renewals/:id/opportunity` | renewals |
| POST | `/api/v1/renewals/generate` | renewals |

## /api/v1/premium-installments  
_(routes/installments.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/premium-installments` | installments |
| GET | `/api/v1/premium-installments/:id` | installments |
| PUT | `/api/v1/premium-installments/:id` | installments |
| POST | `/api/v1/premium-installments/:id/payments` | installments |
| POST | `/api/v1/premium-installments/:id/payments/:pid/void` | installments_confirm |
| POST | `/api/v1/premium-installments/:id/status` | installments_confirm |
| POST | `/api/v1/premium-installments/:id/reminder` | installments |

## /api/v1/commissions  
_(routes/commissions.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/commissions/agreements` | commissions_view |
| POST | `/api/v1/commissions/agreements` | commissions_rules |
| POST | `/api/v1/commissions/agreements/:id/versions` | commissions_rules |
| GET | `/api/v1/commissions/receivables` | commissions_view |
| POST | `/api/v1/commissions/receivables/:id/confirm` | commissions_settle |
| POST | `/api/v1/commissions/receivables/:id/adjustments` | commissions_adjust |
| POST | `/api/v1/commissions/receivables/:id/contest` | commissions_adjust |
| GET | `/api/v1/commissions/disputes` | commissions_view |
| PUT | `/api/v1/commissions/disputes/:id` | commissions_adjust |
| GET | `/api/v1/commissions/settlements` | commissions_view |
| GET | `/api/v1/commissions/settlements/:id` | commissions_view |
| POST | `/api/v1/commissions/settlements` | commissions_settle |
| POST | `/api/v1/commissions/settlements/:id/reverse` | commissions_adjust |
| POST | `/api/v1/commissions/statements/preview` | commissions_settle |
| POST | `/api/v1/commissions/statements/import` | commissions_settle |
| GET | `/api/v1/commissions/statements/files` | commissions_view |
| GET | `/api/v1/commissions/statements/lines` | commissions_view |
| POST | `/api/v1/commissions/statements/reconcile` | commissions_settle |
| POST | `/api/v1/commissions/statements/lines/:id/resolve` | commissions_settle |

## /api/v1/partners  
_(routes/splits.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/partners` | splits_view |
| POST | `/api/v1/partners` | splits_manage |
| PUT | `/api/v1/partners/:id` | splits_manage |
| PUT | `/api/v1/partners/:id/bank` | splits_manage |

## /api/v1/splits  
_(routes/splits.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/splits/rules` | splits_view |
| POST | `/api/v1/splits/rules` | splits_manage |
| POST | `/api/v1/splits/rules/:id/deactivate` | splits_manage |
| GET | `/api/v1/splits/accruals` | splits_view |
| GET | `/api/v1/splits/batches` | splits_view |
| GET | `/api/v1/splits/batches/:id` | splits_view |
| POST | `/api/v1/splits/batches` | splits_manage |
| POST | `/api/v1/splits/batches/:id/approve` | splits_approve |
| POST | `/api/v1/splits/batches/:id/pay` | splits_pay |
| POST | `/api/v1/splits/batches/:id/cancel` | splits_manage |
| POST | `/api/v1/splits/accruals/:id/resolve` | splits_approve |

## /api/v1/finance  
_(routes/finance.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/finance/accounts` | finance |
| POST | `/api/v1/finance/accounts` | finance |
| POST | `/api/v1/finance/bank/import` | finance |
| GET | `/api/v1/finance/bank/transactions` | finance |
| GET | `/api/v1/finance/bank/transactions/:id/suggestions` | finance |
| POST | `/api/v1/finance/bank/reconcile` | finance |
| POST | `/api/v1/finance/bank/transactions/:id/entry` | finance |
| POST | `/api/v1/finance/bank/matches/:id/undo` | finance |
| GET | `/api/v1/finance/entries` | finance |
| POST | `/api/v1/finance/entries` | finance |
| POST | `/api/v1/finance/entries/:id/settle` | finance |
| POST | `/api/v1/finance/entries/:id/cancel` | finance |
| GET | `/api/v1/finance/periods` | finance |
| POST | `/api/v1/finance/periods/close` | finance_close |
| POST | `/api/v1/finance/periods/:id/reopen` | finance_close |
| GET | `/api/v1/finance/projection` | finance |
| GET | `/api/v1/finance/result` | finance |

## /api/v1/claims  
_(routes/claims.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/claims` | claims |
| POST | `/api/v1/claims` | claims |
| GET | `/api/v1/claims/:id` | claims |
| PUT | `/api/v1/claims/:id` | claims |
| POST | `/api/v1/claims/:id/events` | claims |

## /api/v1/service-requests  
_(routes/claims.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/service-requests` | service_requests |
| POST | `/api/v1/service-requests` | service_requests |
| PUT | `/api/v1/service-requests/:id` | service_requests |

## /api/v1/documents  
_(routes/documents.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/documents` |  |
| POST | `/api/v1/documents` |  |
| GET | `/api/v1/documents/:id/download` |  |
| POST | `/api/v1/documents/:id/link` |  |
| GET | `/api/v1/documents/links` |  |
| POST | `/api/v1/documents/links/:id/revoke` |  |

## /api/v1/reports  
_(routes/reports.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/reports/dashboard` |  |
| GET | `/api/v1/reports/indicators` | reports |
| GET | `/api/v1/reports/export/:what` | data_export |
| GET | `/api/v1/reports/export-all` | data_export |
| GET | `/api/v1/reports/audit` | audit_view |
| GET | `/api/v1/reports/events` | audit_view |
| POST | `/api/v1/reports/imports/clients` | imports |
| POST | `/api/v1/reports/imports/policies` | imports |

## /api/v1/agent  
_(routes/agent.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/agent` | agent_manage, agent_inbox |
| PUT | `/api/v1/agent/connection` | agent_manage |
| POST | `/api/v1/agent/connection/test` | agent_manage |
| POST | `/api/v1/agent/connection/verify-token` | agent_manage |
| POST | `/api/v1/agent/connection/disconnect` | agent_manage |
| PUT | `/api/v1/agent/settings` | agent_manage |
| GET | `/api/v1/agent/routines/:key/preview` | agent_manage |
| POST | `/api/v1/agent/routines/:key/run` | agent_manage |
| POST | `/api/v1/agent/team/run` | agent_manage |
| GET | `/api/v1/agent/runs` | agent_manage |
| PUT | `/api/v1/agent/me` |  |
| GET | `/api/v1/agent/me` |  |
| GET | `/api/v1/agent/conversations` | agent_manage, agent_inbox |
| GET | `/api/v1/agent/conversations/:id` | agent_manage, agent_inbox |
| POST | `/api/v1/agent/conversations/:id/messages` | agent_manage, agent_inbox |
| POST | `/api/v1/agent/conversations/:id/status` | agent_manage, agent_inbox |
| POST | `/api/v1/agent/simulate` | agent_manage, agent_inbox |
| DELETE | `/api/v1/agent/simulate` | agent_manage, agent_inbox |

## /api/v1  
_(routes/workspace.js)_

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/v1/search` |  |
| GET | `/api/v1/notifications` |  |
| POST | `/api/v1/automations/run` |  |
| POST | `/api/v1/portal-links` |  |
| GET | `/api/v1/messages` |  |
| POST | `/api/v1/messages` |  |

## /api/v1/export

| GET | `/api/v1/export` | data_export |
