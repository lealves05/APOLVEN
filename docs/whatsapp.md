# Agente do WhatsApp Business

Menu **Relacionamento › Agente do WhatsApp** (`/agente-whatsapp`). Usa a **API oficial (Cloud API) da Meta** —
nenhum aplicativo não oficial, automação de WhatsApp Web ou envio em massa sem consentimento.

## O que faz

| Função | Como funciona |
|---|---|
| **Avisos automáticos aos clientes** | Parcela a vencer, parcela vencida, renovação, cotação perto de vencer (reenvia o link do comparativo) e aniversário. Só para quem tem a autorização *Avisos automáticos por WhatsApp* (aniversário: autorização de marketing), dentro do horário permitido, sem fim de semana (configurável), um aviso por registro e marco (sem duplicidade), com **modelo aprovado pela Meta**. Links de parcelas e comparativo são temporários (portal). |
| **Lembretes da equipe** | Rotina diária que cria tarefas na Agenda para o responsável pelo cliente: renovações a iniciar, parcelas vencidas, cotações perto de vencer, consultas assistidas sem resposta, comparativos sem escolha, propostas sem retorno e documentos a conferir. Quem ligar em *Minha conta › Lembretes no WhatsApp* recebe também um resumo no celular. |
| **Autoatendimento** | Menu para mensagens recebidas: 1 apólices, 2 parcelas (com link para comprovante), 3 sinistro/assistência (registra uma solicitação com protocolo e mostra o telefone 24 h da seguradora), 4 renovação/cotação (tarefa para o corretor), 5 falar com um corretor. Dados de apólice e parcela só depois de conferir a identidade (3 primeiros dígitos do CPF/CNPJ ou data de nascimento; 3 erros → corretor). Nunca promete cobertura, aceite ou valor. |
| **SAIR** | Revoga as autorizações de WhatsApp e marketing, marca *não receber marketing* e bloqueia os avisos automáticos para aquele número. |
| **Conversas** | Caixa de entrada com atendimento humano: assumir, responder (texto livre só dentro da janela de 24 h aberta pelo cliente), devolver ao assistente, encerrar. Carteira própria: o corretor vê só os próprios clientes. Alerta no sino quando há cliente aguardando. |
| **Testar o assistente** | Simulador: escreve como um cliente da carteira; nada sai do sistema. |
| **Histórico** | Cada execução (agendada ou manual), com enviadas, falhas e motivo; ações registradas na auditoria. |

Permissões: **Configurar o agente** (`agent_manage`: proprietário, administrador, gestor) e **Conversas do WhatsApp**
(`agent_inbox`: também corretor, operação e sinistros). Módulo da central: `whatsapp`.

## Conectar (uma vez por corretora)

1. **Meta Business** (business.facebook.com): crie um app do tipo *Empresa* com o produto **WhatsApp** e adicione o
   número da corretora (não pode estar em uso no aplicativo comum do WhatsApp).
2. **Token permanente**: *Configurações do negócio › Usuários do sistema* → usuário do sistema com acesso ao app →
   gerar token com `whatsapp_business_messaging` e `whatsapp_business_management`.
3. No APOLVEN, aba **Conexão**: *ID do número de telefone*, *ID da conta (WABA)*, *token* e *chave secreta do app*
   (Configurações do app › Básico). Trocar credenciais pede o código do autenticador/senha; ficam cifradas no cofre.
4. **Webhook** (app da Meta › WhatsApp › Configuração): URL `https://apolven.lorler.com.br/api/whatsapp/webhook`
   e o **token de verificação** mostrado na tela; assine o campo **messages**. Toda notificação é conferida pela
   assinatura `X-Hub-Signature-256` com a chave secreta do app.
5. **Testar conexão** → **ligar os envios reais**.
6. Aba **Modelos da Meta**: cadastre os 6 modelos sugeridos (mesmo nome, Português BR, categoria indicada, variáveis
   na ordem) e, depois de aprovados, confira o nome em cada rotina.

## Agendador

- Na Cloudflare: Cron Trigger do Worker `apolven-web` (de hora em hora, `7 * * * *`) chama `GET /api/agent/cron` com
  `Authorization: Bearer <CRON_SECRET>`. O `PUBLICAR-CLOUDFLARE.bat` gera a chave (`%USERPROFILE%\.plataforma-cloudflare\apolven-cron.key`)
  e grava nos dois lados (`wrangler secret put CRON_SECRET` e `supabase secrets set APOLVEN_CRON_SECRET`).
- Servidor contínuo (local): a própria API roda as rotinas a cada hora (`AGENT_ROUTINES=off` desliga).
- Cada corretora define o horário (fuso dela); a rotina só envia a partir dele e dentro da janela permitida.
  Corretoras bloqueadas pela central ou sem o módulo `whatsapp` não recebem rotinas; demonstrações também não.

## Testes

`DATABASE_URL=postgres://…/apolven_agent_test npm run test:agent` — 29 verificações contra uma Graph API falsa:
credenciais cifradas e reautenticação, verificação do webhook, teste de conexão, prévia sem envio, modelo obrigatório,
parâmetros na ordem, link do portal válido, sem duplicidade, falha e nova tentativa, status de entrega sem regredir,
assinatura inválida, menu, conferência de identidade, parcelas com link, reentrega do webhook, sinistro com protocolo,
transferência para humano, janela de 24 h, SAIR revogando autorização, número sem cadastro, simulador, lembretes da
equipe (tarefas + resumo, sem duplicar), agendador com segredo, histórico/auditoria e carteira própria.

## Limites

- Não usa IA: o autoatendimento é um menu com regras fixas (não interpreta textos livres além das palavras-chave).
- Mídias recebidas (foto, áudio, documento) não são baixadas: a conversa vai para um corretor.
- Mensagens iniciadas pela corretora dependem dos modelos aprovados pela Meta e são cobradas pela Meta por conversa.
