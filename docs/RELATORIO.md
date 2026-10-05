# APOLVEN — relatório de entrega (v1.0, outubro/2026)

## O que foi entregue

| Área | Situação |
|---|---|
| Cadastro da corretora, unidades, usuários, perfis e permissões por carteira | Pronto |
| CRM: clientes PF/PJ, contatos, vínculos, consentimentos, duplicidade e união revisada, oportunidades, agenda/tarefas | Pronto |
| Seguradoras e Integrações (Anexo C): catálogo, assistente em 5 etapas, requisitos, credenciais cifradas, testes, funções por evidência, pausa/revogação, histórico | Pronto (modo assistido — ver limites) |
| Multicálculo: questionário versionado por ramo, rodadas imutáveis, tarefas por seguradora, ofertas com origem/validade, pontuação explicada, abrangência real | Pronto |
| Comparativo, link do cliente com escolha registrada, impressão | Pronto |
| Propostas: aprovação interna, autorização do cliente, transmissão idempotente (protocolo assistido), status com evidência | Pronto |
| Apólices: conferência com divergências, versões, itens, endossos, cancelamentos, renovações | Pronto |
| Parcelas do prêmio: plano, pagamento informado × confirmado, comprovante pelo portal, estornos | Pronto |
| Comissões: acordos e regras versionadas, previsões por snapshot, extratos (CSV/OFX), conciliação, ajustes, contestação, liquidações e estornos | Pronto |
| Repasses: regras versionadas, apuração só sobre comissão recebida, lotes com aprovação e pagamento, favorecidos com reautenticação | Pronto |
| Financeiro: contas, importação bancária, conciliação, lançamentos, fechamento de período, projeção, resultado | Pronto |
| Sinistros e solicitações/assistências | Pronto |
| Documentos (checagem do conteúdo real do arquivo, versões, restritos, link temporário) | Pronto |
| Relatórios, indicadores, exportação CSV e exportação completa (JSON), auditoria e eventos | Pronto |
| LGPD: solicitações de titulares, consentimentos, opt-out de marketing | Pronto |
| SaaS/Master: manifesto, bloqueio/liberação, assinatura, redefinição do proprietário (HMAC v1/v1.1) | Pronto |
| Segurança: MFA TOTP obrigatório (proprietário/admin/financeiro), reautenticação, limites de tentativa com IP real, CORS restrito, cabeçalhos, sem cache na API | Pronto |
| Agente do WhatsApp Business (API oficial): avisos automáticos com consentimento e modelos aprovados, lembretes da equipe, autoatendimento, conversas, simulador, agendador — ver `docs/whatsapp.md` | Pronto (depende da conta Meta da corretora) |
| Suporte e treinamento: 25 vídeo-aulas narradas e legendadas (todos os módulos), transcrição clicável, busca, progresso, FAQ e ajuda contextual (?) em cada tela | Pronto |
| Publicação Cloudflare + Supabase (mesmo procedimento do TORVEN) | Pronto (`PUBLICAR-CLOUDFLARE.bat`) |

## Verificações executadas

- `scripts/smoke.mjs` — **165/165** verificações ponta a ponta contra a API real (Postgres): autenticação e MFA,
  isolamento entre corretoras (A01/A02), integrações (Anexo C), multicálculo, comparativo e portal, propostas,
  exemplos financeiros 16.1–16.4 e casos A13–A22, comprovante de parcela (A24), endosso/cancelamento/renovação/sinistro,
  perfis e auditoria.
- `scripts/platform-test.mjs` — **11/11** (contrato com a central, A27, CORS, segredo fraco, TOTP RFC 6238).
- `scripts/agent-test.mjs` — **29/29** (agente do WhatsApp contra Graph API falsa).
- `test/util.test.mjs` — 8 testes unitários (arredondamento, divisão de centavos, documentos, datas, CSV, TOTP).
- Pacote da Edge Function (`npm run build:edge`) executado no **Deno 2.9**: migrações aplicadas do zero, segredos
  gerados em `apolven._secrets`, demonstração criada e rotas principais respondendo.
- Scripts de reversão (`backend/src/migrations/rollback/*.down.sql`) testados do 004 ao 001.
- Interface: `vite build` sem erros; navegação automatizada (Chromium) por todas as 25 telas e pelos detalhes de
  cliente, cotação, apólice, sinistro e integração na demonstração — **0 erros** de console, de página ou HTTP 5xx.

## Limites conhecidos (sem simulação)

- **Nenhum adaptador automático de seguradora está ativo.** As APIs de Porto, Tokio Marine, Bradesco e BB/Brasilseg
  exigem credenciamento e documentação entregues pela própria seguradora à corretora. Até lá, cotação, transmissão e
  acompanhamento funcionam em **modo assistido** (a equipe registra a resposta oficial com evidência). O contrato dos
  adaptadores (`backend/src/lib/connectors.js`) está pronto para receber cada integração quando houver acesso.
- **Open Insurance**: aparece como indisponível (fase regulatória não oferece cotação para corretoras).
- **Webhooks de fornecedores (A23)**: tabela de entrada idempotente pronta (`inbox_events`), sem receptor publicado
  porque não há fornecedor integrado.
- **Módulo de IA (A26)**: não implementado nesta versão; nenhum documento é interpretado por IA.
- Envio de WhatsApp/e-mail: mensagens são preparadas e abertas no aparelho do usuário (sem disparo automático).
- Emissão de boletos/Pix das parcelas: fora do escopo — o prêmio é cobrado pela seguradora.

## Passos que dependem do responsável

1. Rodar `PUBLICAR-CLOUDFLARE.bat` (branch `cloudflare`).
2. Master › Sistemas: cadastrar `apolven` e gravar `platform_hub_url`/`platform_secret` (SQL em `docs/cloudflare.md`).
3. DNS de `apolven.lorler.com.br` (o .bat publica no `*.workers.dev` enquanto o domínio não estiver ativo).
4. Criar o repositório `lealves05/APOLVEN` no GitHub (o .bat só avisa se não conseguir enviar).
