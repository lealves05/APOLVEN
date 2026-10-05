# APOLVEN — gestão para corretoras de seguros

Sistema SaaS multiempresa para corretoras: relacionamento (CRM), multicálculo e comparativos, propostas e transmissão,
apólices e endossos, renovações, parcelas do prêmio, comissões, repasses, conciliação, financeiro, sinistros e
solicitações, portal do cliente por link, central de **Seguradoras e Integrações** (Anexo C), privacidade (LGPD) e
integração com a central da plataforma (Master). Implementa a *Especificação do Sistema de Gestão para Corretoras de
Seguros v1.1* (`docs/` + arquivo original na pasta do projeto).

Mesma arquitetura e hospedagem do TORVEN (branch `cloudflare`): site + `/api` em um Worker da Cloudflare e a API em
uma Edge Function da Supabase com o pacote embutido. Detalhes: [`docs/cloudflare.md`](docs/cloudflare.md).

## Estrutura

```
backend/   Node 20+ · Express 5 · pg · zod  (API em /api; migrações SQL em src/migrations, schema "apolven")
  src/routes/      um arquivo por módulo (contratos zod)        src/lib/   regras de negócio (comissão, parcelas, comparação, conectores)
  scripts/smoke.mjs   165 verificações ponta a ponta (casos de aceite A01–A42 aplicáveis e exemplos 16.1–16.4)
  scripts/platform-test.mjs   contrato com a central (Master)    test/   testes unitários (dinheiro, documentos, TOTP)
frontend/  React 18 · Vite · Tailwind · React Router (rotas em português)
cloudflare/  worker.js (igual ao dos outros sistemas) + wrangler.jsonc (apolven-web)
docs/      API.md (rotas e permissões), FRONTEND_CONVENTIONS.md, cloudflare.md, RELATORIO.md (verificações e limites)
tools/videos/  roteiro e gravação das 25 vídeo-aulas do Suporte (Playwright + narração Kokoro + ffmpeg)
PUBLICAR-CLOUDFLARE.bat   publica a branch cloudflare (site + API) em apolven.lorler.com.br
```

## Rodar localmente

```bash
docker compose up -d                       # Postgres local (ou use um existente)
cd backend && cp .env.example .env && npm install && npm run dev      # API em http://localhost:3334
cd frontend && npm install && npm run dev  # site em http://localhost:5173 (proxy /api → 3334)
```

Na tela de entrada, **Experimentar a demonstração** cria uma corretora fictícia (apagada após 7 dias sem ativação).
Em desenvolvimento, `APOLVEN_MFA=off` desliga o MFA obrigatório.

Testes: `npm test` (smoke com o servidor rodando em 3334 e `APOLVEN_TEST_ADAPTERS=1`), `npm run test:unit`,
`DATABASE_URL=postgres://.../apolven_agent_test npm run test:agent` (agente do WhatsApp contra uma Graph API falsa),
`DATABASE_URL=postgres://.../apolven_platform_test node scripts/platform-test.mjs`.

## Agente do WhatsApp

Relacionamento › Agente do WhatsApp: conexão com a API oficial do WhatsApp Business (Meta), avisos automáticos aos
clientes que autorizaram (parcelas, renovação, cotação perto de vencer, aniversário), lembretes diários da equipe
(tarefas na Agenda + resumo no WhatsApp), autoatendimento com conferência de identidade, caixa de conversas e
simulador. Guia completo: [`docs/whatsapp.md`](docs/whatsapp.md).

## Suporte e treinamento

Em Configurações › Suporte ficam 25 vídeo-aulas (≈23 min) que cobrem todos os módulos, com narração em português,
legenda na imagem, transcrição clicável (WebVTT), busca, progresso por usuário, perguntas frequentes e contato.
O ícone de ajuda (?) no topo de cada tela abre a aula daquele assunto. Para regravar: `tools/videos/README.md`.

## Regras que o sistema garante

- Nenhuma cotação, aceite ou integração é simulada: sem conector automático validado, o fluxo é **assistido**
  (a equipe registra a resposta da seguradora com origem, evidência e validade). Valor indicativo não vira proposta.
- Falha técnica, tempo excedido e ausência de resposta nunca aparecem como recusa; a abrangência real da pesquisa é sempre exibida.
- Prêmio (parcelas do cliente) ≠ comissão da corretora ≠ repasse a parceiros ≠ assinatura SaaS — tabelas e telas separadas.
- Dinheiro em centavos inteiros, arredondamento half-up, resíduo distribuído de forma determinística; liquidações idempotentes.
- Isolamento por corretora (chaves compostas `company_id, id`), carteira própria por perfil, trilha de auditoria imutável.
- MFA (TOTP) obrigatório para proprietário, administrador e financeiro; reautenticação para credenciais e favorecidos.
- Credenciais das seguradoras cifradas (AES-256-GCM, chave separada) e nunca devolvidas ao navegador.
- Sem credencial fixa de administrador: a central (Master) libera e bloqueia por chamadas assinadas (HMAC).

## Perfis

Proprietário, administrador da corretora, gestor comercial, corretor/produtor, operação/emissão, financeiro,
sinistros/pós-venda e auditor/leitura — permissões ajustáveis por corretora em Configurações.
