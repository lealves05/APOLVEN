# APOLVEN — convenções do frontend

React 18 + Vite + Tailwind + React Router 6 (JSX, sem TypeScript), mesmo padrão do TORVEN. Toda a interface em português do Brasil.

## Estrutura

- `src/App.jsx` — mapa de rotas (não altere sem necessidade). Cada página exporta `default` e, quando indicado, exports nomeados.
- `src/pages/*.jsx` — uma página por módulo. Componentes auxiliares de uma página ficam no próprio arquivo.
- `src/components/ui.jsx` — biblioteca de UI compartilhada (não alterar sem combinar).
- `src/lib/api.js`, `src/lib/format.js`, `src/context/AuthContext.jsx`, `src/context/UIContext.jsx`.

## API

- Base: `/api`. Rotas de negócio em `/api/v1/...` → no código: `api.get('/v1/clients')`.
- Contratos exatos (payloads, validações, mensagens): `backend/src/routes/*.js` (schemas zod) e `docs/API.md`.
- **Dinheiro sempre em centavos inteiros** (`*_cents`). Exibir com `money(cents)`; entrada com `<CentsInput value={cents} onChange={setCents} />` (vazio = `null` = "não informado"; nunca transformar desconhecido em zero).
- Percentuais: número (ex.: `20` = 20%).
- Datas: `YYYY-MM-DD`. Exibir com `fmt(d)` / `fmtDateTime(d)`.
- Erros: a API devolve `{ error, code?, correlation_id }`. Use `useAction()` → `const [run, busy] = useAction(); const r = await run(() => api.post(...), 'Mensagem de sucesso'); if (r !== FAIL) ...` (o toast de erro é automático).
- Carregamento: `const { data, loading, reload } = useFetch(() => api.get('/v1/...'), [deps])`.
- Operações sensíveis (liquidação, transmissão): enviar cabeçalho `Idempotency-Key` com `idemKey('prefixo')` gerado UMA vez por abertura do formulário: `api.post(path, body, { 'Idempotency-Key': key })`.
- Arquivos: upload → `const payload = await fileToPayload(file)` e `api.post('/v1/documents', { entity, entity_id, client_id, kind, ...payload })` (devolve `{ id, filename, ... }`). Download autenticado → `download('/v1/documents/<id>/download')`. CSV de importação → `fileToText(file)`.
- Reautenticação (credenciais, favorecido de repasse): enviar `mfa_code` (6 dígitos do autenticador) quando `user.mfa_enabled`, senão `password`. Erro `REAUTH_REQUIRED` → pedir de novo.

## Sessão e permissões

`const { user, company, can, scope, feature, meta, branchLabel } = useAuth();`

- `can('perm', ...)` — qualquer uma das permissões. `scope('clients_view')` → `'all' | 'own' | 'none'`.
- `meta` (carregado após login): `{ branches, risk_schemas: { ramo: { version, fields:[{key,label,type,required,options,min,max}] } }, coverage_catalog: { ramo: [{code,name}] }, relations, purposes, stages, task_status }`. Pode ser `null` nos primeiros instantes — trate com `meta?.`.
- `company.settings` tem as regras da corretora (numeração, renovações, parcelas, pontuação, aprovações, modelos de WhatsApp).

## Componentes (`components/ui.jsx`)

`PageHeader({title, subtitle, actions})`, `Section({title, subtitle, actions, children})`, `KV({items:[[rótulo, valor]], cols})`, `Tabs({tabs:[{value,label}], value, onChange})`,
`Stat({label, value, hint, icon, tone})`, `Modal({open, onClose, title, subtitle, footer, size:'sm'|'md'|'lg'|'xl'})`, `PromptModal({open, title, fields:[{key,label,required,textarea,type}], onSubmit(values), onClose, danger, confirmText})`,
`Input`, `Textarea`, `Select`, `Toggle({checked,onChange,label,hint})`, `CentsInput`, `FileButton({accept, onFile})`, `StatusChip({map, value})`, `Notice({tone:'info'|'warn'|'danger'|'ok'})`,
`Empty({icon,title,text,action})`, `Loading`, `Spinner`, `Avatar`, `cx(...)`.
Confirmação simples: `const { confirm, toast } = useUI(); if (await confirm({ title, message, confirmText, danger })) ...`.

Tabelas: `<div className="card overflow-x-auto"><table className="table-clean">…</table></div>` — no celular viram cartões automaticamente (o texto do `<th>` vira rótulo). Ordenação/paginação: `useTable`, `SortTh`, `Pager` de `components/Table.jsx`.

Classes: `btn-primary`, `btn-outline`, `btn-ghost`, `btn-danger`, `btn-icon`, `input`, `label`, `chip`, `card`. Cores do tema: `text-ink`, `text-ink-soft`, `text-ink-faint`, `bg-muted`, `bg-surface`, `border-line`, `text-primary`, `bg-primary/10`.
Ícones: `lucide-react`.

## Estados (`lib/format.js`)

Dicionários `{ chave: { label, cls } }` para `StatusChip`: `STAGES`, `TASK_STATUS`, `QUOTE_REQUEST_STATUS`, `COMPARISON_STATUS`, `CLASSIFICATION`, `PROPOSAL_STATUS`, `CONTRACT_STATE`, `DOC_STATE`, `INSTALLMENT_STATUS`, `COMMISSION_STATUS`, `ACCRUAL_STATUS`, `BATCH_STATUS`, `CLAIM_STATUS`, `REQUEST_STATUS`, `LINE_STATUS`, `CAPABILITY_STATE`, `TECH_STATE`, `COMMERCIAL_STATE`, `REQ_STATUS`. Também `ACCRUAL_KIND`, `ENV_LABEL`, `ROLES`, `BRANCHES`, `PRIORITY`, `docNumber(settings, kind, n)`, `maskDoc`, `maskPhone`, `maskCep`, `lookupCep`, `waLink(phone, text)`, `fillTemplate`, `downloadCSV`, `ago(date)`.

## Regras de produto que a interface deve respeitar

- Nunca apresentar dado simulado como cotação real; mostrar a origem (API, documento formal, informada pela seguradora) e a validade.
- Falha técnica, tempo excedido e ausência de resposta nunca aparecem como recusa.
- Mostrar a abrangência real da pesquisa (`round.summary.text`) e que a comparação é parcial quando for.
- Comissão nunca aparece em telas/links do cliente nem como critério de "melhor oferta".
- Autorização do cliente, transmissão, recepção, aceite e emissão são etapas distintas.
- Prêmio do seguro (parcelas) ≠ comissão da corretora ≠ repasse ≠ assinatura SaaS: telas separadas, sem somar.
- "Pagamento informado" ≠ "pagamento confirmado".
- Ações destrutivas/financeiras pedem confirmação contextual e motivo (use `PromptModal`).
- Estados não dependem só de cor: o chip sempre tem texto. Campos com rótulo; navegação por teclado.
- Celular: listas viram cartões; formulários em uma coluna (`grid gap-4 sm:grid-cols-2`).
