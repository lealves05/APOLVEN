// Vídeo-aulas do APOLVEN — gerado por videokit-apolven/gen-training.mjs (não edite à mão).
// Arquivos em /public/treinamento/<file>.mp4 (narração + legenda na imagem), .vtt (transcrição), -capa.jpg e .jpg.
// `routes`: telas em que a aula é sugerida pelo botão de ajuda; `text`: falas (usadas na busca).
export const MODULES = [
  {
    "key": "inicio",
    "label": "Primeiros passos"
  },
  {
    "key": "crm",
    "label": "Relacionamento"
  },
  {
    "key": "vendas",
    "label": "Vendas e multicálculo"
  },
  {
    "key": "carteira",
    "label": "Carteira e pós-venda"
  },
  {
    "key": "financeiro",
    "label": "Comissões, repasses e financeiro"
  },
  {
    "key": "cadastros",
    "label": "Seguradoras, produtos e documentos"
  },
  {
    "key": "gestao",
    "label": "Gestão e conformidade"
  },
  {
    "key": "config",
    "label": "Configurações e suporte"
  }
];

export const LESSONS = [
  {
    "n": 1,
    "file": "01-conhecendo-o-apolven",
    "mod": "inicio",
    "s": 99,
    "title": "Conhecendo o APOLVEN",
    "routes": [
      "/"
    ],
    "desc": "O painel, o menu, a busca rápida, o botão Novo e os alertas.",
    "learn": [
      "O que o painel mostra",
      "Como o menu está organizado",
      "Busca, botão Novo e alertas"
    ],
    "text": "Este é o painel do APOLVEN, o sistema de gestão da sua corretora de seguros. Ele reúne, em uma tela, tudo o que precisa da sua atenção hoje. Em Vendas em andamento ficam as cotações abertas, as consultas sem resposta e as propostas em contratação. Na carteira: apólices que vencem em 30 e 90 dias, apólices vigentes e documentos a conferir. Comissões da corretora e repasses a parceiros ficam em blocos próprios, sem misturar com o prêmio do seguro. À direita, as suas próximas tarefas, com prazo e prioridade. O menu lateral reúne os módulos: relacionamento, vendas, carteira, financeiro, cadastros, gestão e configurações. Para achar um cliente, apólice, proposta ou placa, use a busca, com Control mais K. Os resultados respeitam a sua carteira e as suas permissões. O botão Novo abre os atalhos do dia a dia: nova cotação, novo cliente, cadastrar apólice e nova solicitação. O ponto de interrogação abre a vídeo-aula da tela em que você está. No sino ficam as pendências. Gerar tarefas cria os lembretes de renovação, de parcelas vencidas e de cotações perto de vencer. Na demonstração, os dados são fictícios. Quando quiser, use Ativar uso normal para começar com os dados da sua corretora."
  },
  {
    "n": 2,
    "file": "02-conta-e-seguranca",
    "mod": "inicio",
    "s": 55,
    "title": "Sua conta e a verificação em duas etapas",
    "routes": [
      "/conta"
    ],
    "desc": "Perfil, senha, verificação em duas etapas e aparência.",
    "learn": [
      "Atualizar perfil e senha",
      "Ativar o aplicativo autenticador",
      "Quem precisa da verificação"
    ],
    "text": "Em Minha conta e segurança você cuida do seu acesso. No perfil ficam o seu nome e os seus contatos. Para trocar a senha, informe a atual e a nova. Senhas fracas ou muito comuns são recusadas. A verificação em duas etapas usa um aplicativo autenticador no celular, como Google Authenticator ou Microsoft Authenticator. Ela é obrigatória para proprietário, administrador e financeiro. Você escaneia o código QR, digita os seis números do aplicativo e guarda os códigos de recuperação em lugar seguro. Em Aparência, escolha o tema claro, escuro ou o mesmo do sistema. Operações sensíveis, como trocar credenciais ou dados bancários, pedem o código de novo."
  },
  {
    "n": 3,
    "file": "03-clientes",
    "mod": "crm",
    "s": 55,
    "title": "Cadastro de clientes",
    "routes": [
      "/clientes"
    ],
    "desc": "Pessoa física ou jurídica, duplicidades e exportação.",
    "learn": [
      "Cadastrar pessoa física ou jurídica",
      "Evitar cadastros duplicados",
      "Buscar e exportar"
    ],
    "text": "Em Clientes e grupos fica toda a sua base, com o responsável e as apólices vigentes de cada cliente. Para cadastrar, clique em Novo cliente e escolha pessoa física ou jurídica. Preencha o nome, os contatos e, se tiver, o CPF ou CNPJ. O documento é conferido e evita cadastrar a mesma pessoa duas vezes. Abaixo ficam o endereço e as observações. Só o nome é obrigatório. Ao salvar, a ficha do cliente é aberta. Possíveis duplicidades lista cadastros parecidos para você revisar e unir, sempre com confirmação. E Exportar CSV gera a planilha da sua carteira."
  },
  {
    "n": 4,
    "file": "04-ficha-do-cliente",
    "mod": "crm",
    "s": 60,
    "title": "A ficha do cliente",
    "routes": [
      "/clientes/"
    ],
    "desc": "Contatos, vínculos, autorizações, atendimento, apólices e documentos.",
    "learn": [
      "Abas da ficha",
      "Autorizações (consentimentos)",
      "Atendimento e histórico"
    ],
    "text": "A ficha reúne tudo sobre o cliente. No topo, atalhos para ligar, mandar e-mail, abrir oportunidade ou cotação. Em Contatos, cadastre outras pessoas: o sócio, a secretária, quem decide. Vínculos ligam clientes entre si: cônjuge, filhos, empresa e sócios. Em Autorizações ficam os consentimentos do cliente: para cotar, para compartilhar dados e para receber ofertas. Se a autorização for revogada, o sistema bloqueia o uso daquela finalidade. Atendimento guarda o histórico de contatos, tarefas e mensagens. Aqui aparecem apólices, propostas, cotações e sinistros do cliente. E em Documentos você anexa RG, CNH, comprovantes e laudos, com controle de versão."
  },
  {
    "n": 5,
    "file": "05-oportunidades-e-agenda",
    "mod": "crm",
    "s": 55,
    "title": "Oportunidades e agenda",
    "routes": [
      "/oportunidades",
      "/agenda"
    ],
    "desc": "O funil de vendas e as tarefas da equipe.",
    "learn": [
      "Funil de oportunidades",
      "Próxima ação",
      "Agenda e tarefas"
    ],
    "text": "O CRM organiza as oportunidades em um funil, do primeiro contato até a venda. Cada cartão mostra o cliente, o ramo e o prêmio estimado. Mude a etapa conforme a negociação avança. Na visão em lista, filtre e ordene as oportunidades. Oportunidade sem próxima ação aparece em destaque no painel, para nada ficar esquecido. Para criar, escolha o cliente, o ramo, a necessidade e a próxima ação com data. Na Agenda ficam as tarefas de hoje e das próximas datas. Conclua ou cancele cada tarefa. Filtre entre as suas tarefas e as da equipe. Nova tarefa permite definir responsável, prazo, prioridade e o cliente relacionado."
  },
  {
    "n": 26,
    "file": "26-agente-whatsapp",
    "mod": "crm",
    "s": 139,
    "title": "Agente do WhatsApp",
    "routes": [
      "/agente-whatsapp"
    ],
    "desc": "Avisos automáticos aos clientes, lembretes da equipe e atendimento pelo WhatsApp Business.",
    "learn": [
      "Conectar o número (API oficial)",
      "Avisos e lembretes automáticos",
      "Assistente, conversas e SAIR"
    ],
    "text": "O Agente do WhatsApp liga o número de WhatsApp Business da corretora ao APOLVEN, pela API oficial da Meta. Informe o ID do número, o token permanente e a chave secreta do app. As credenciais ficam cifradas, e trocá-las exige o código do autenticador. No app da Meta, cadastre a URL de retorno e o token de verificação. Toda mensagem recebida tem a assinatura conferida. Em Avisos aos clientes, ligue as rotinas: parcela a vencer, parcela vencida, renovação, cotação perto de vencer e aniversário. Só recebe quem autorizou os avisos por WhatsApp, no horário permitido e nunca duas vezes o mesmo aviso. A prévia mostra quem receberia hoje e o texto, sem enviar nada. Mensagens iniciadas pela corretora precisam de modelo aprovado pela Meta. Copie os textos sugeridos e cadastre com o mesmo nome. Os lembretes da equipe criam tarefas na Agenda: renovações, parcelas vencidas, cotações e propostas paradas. Quem quiser recebe também um resumo diário no próprio WhatsApp, ligado em Minha conta. Em Testar o assistente, você conversa como se fosse o cliente, sem enviar nada. O assistente responde com o menu. Para mostrar apólices e parcelas, ele confere antes os três primeiros dígitos do CPF. No aviso de sinistro, ele indica a assistência 24 horas e registra uma solicitação com protocolo para o corretor. Com a opção 5, a conversa passa para a equipe e o assistente fica em silêncio. Em Conversas, a equipe assume o atendimento, responde dentro da janela de 24 horas e depois devolve ao assistente. E quem responde SAIR deixa de receber os avisos automáticos."
  },
  {
    "n": 6,
    "file": "06-nova-cotacao",
    "mod": "vendas",
    "s": 96,
    "title": "Nova cotação: o questionário do risco",
    "routes": [
      "/cotacoes/nova"
    ],
    "desc": "Cliente e ramo, dados do risco, coberturas mínimas e fontes.",
    "learn": [
      "As quatro etapas da cotação",
      "Coberturas mínimas e preferências",
      "Fontes elegíveis e compartilhamento"
    ],
    "text": "Em Cotações e multicálculo ficam todas as cotações, com a situação, as ofertas e as pendências. A nova cotação tem quatro etapas: cliente e ramo, dados do risco, coberturas e preferências, e fontes e envio. Escolha o cliente e o ramo. O questionário muda conforme o ramo escolhido. Nos dados do risco, preencha o que a seguradora precisa para calcular. Os campos obrigatórios têm asterisco. Responda só o que o cliente informou. O que ficar em branco segue como não informado: o sistema nunca inventa respostas. Em coberturas, marque as coberturas mínimas e os limites. As ofertas são comparadas primeiro contra esses requisitos. Depois vêm as preferências: franquia, assistências e forma de pagamento, e a vigência pretendida. Na última etapa aparecem as fontes elegíveis: seguradoras com credenciamento para este ramo. As demais aparecem com o motivo da exclusão. Informe a base para compartilhar os dados do cliente com as seguradoras. Ela fica registrada na rodada e na auditoria. Ao enviar, a rodada é criada e não pode mais ser alterada. Se algo mudar, você faz uma nova rodada."
  },
  {
    "n": 7,
    "file": "07-rodada-e-respostas",
    "mod": "vendas",
    "s": 85,
    "title": "Rodada de multicálculo e respostas das seguradoras",
    "routes": [
      "/cotacoes/"
    ],
    "desc": "Abrangência da pesquisa, consultas assistidas e registro da resposta formal.",
    "learn": [
      "Ler a abrangência da pesquisa",
      "Consulta automática × assistida",
      "Registrar a resposta da seguradora"
    ],
    "text": "Ao abrir a cotação, o topo mostra a abrangência real da pesquisa: quantas seguradoras eram elegíveis, quantas responderam e quantas estão pendentes. Se faltar resposta, o sistema avisa que a comparação é parcial. Falha técnica ou falta de resposta nunca é tratada como recusa. Cada seguradora vira uma consulta. Com integração ativa, a consulta é automática; sem ela, é assistida. Na consulta assistida, você pede a cotação no canal oficial da seguradora e registra aqui a resposta formal. Informe o produto, o número da cotação, se é cotação válida ou só valor indicativo, a origem e a validade. Depois, o prêmio e as coberturas, com limites e franquias. Campo que a seguradora não informou fica em branco: nunca use zero. Inclua as assistências, as exigências e as formas de pagamento com o total de cada opção. Pronto: a resposta entra na comparação com a origem e a validade visíveis. Valor indicativo também aparece, mas não pode virar proposta sem a confirmação da seguradora."
  },
  {
    "n": 8,
    "file": "08-comparativo-do-cliente",
    "mod": "vendas",
    "s": 69,
    "title": "Comparativo e link para o cliente",
    "routes": [
      "/comparativos/"
    ],
    "desc": "Comparação técnica, comparativo para o cliente e escolha registrada.",
    "learn": [
      "Comparar as ofertas",
      "Gerar o comparativo",
      "Enviar o link e registrar a escolha"
    ],
    "text": "Com as respostas registradas, a comparação mostra lado a lado prêmio, coberturas, franquias, assistências, validade e pagamento. Primeiro, cada oferta é classificada frente às coberturas mínimas. A pontuação só vale para as que atendem e estão na validade. A comissão aparece só para a equipe e nunca entra na pontuação. Selecione as ofertas e clique em Gerar comparativo. Escreva uma mensagem para o cliente, se quiser. O comparativo mostra ao cliente só o que ele precisa: sem comissão e sem dados internos. Daqui você gera o link temporário, envia pelo WhatsApp ou imprime em PDF. O cliente abre o link, compara as opções e escolhe, autorizando expressamente aquela versão. Se a escolha vier por telefone ou pessoalmente, registre aqui com o canal e o nome de quem escolheu. A escolha não é aceitação da seguradora."
  },
  {
    "n": 9,
    "file": "09-propostas-e-transmissao",
    "mod": "vendas",
    "s": 69,
    "title": "Propostas e transmissão",
    "routes": [
      "/propostas"
    ],
    "desc": "Autorização do cliente, transmissão, análise, aceite e emissão.",
    "learn": [
      "Etapas da proposta",
      "Transmissão assistida com protocolo",
      "Registrar aceite com evidência"
    ],
    "text": "Em Propostas e transmissão você acompanha cada proposta, da escolha do cliente até a apólice. A proposta guarda uma cópia exata da oferta escolhida. Se a cotação vencer, é preciso recalcular e pedir nova autorização. Autorização do cliente, transmissão, recepção, análise, aceite e emissão são etapas diferentes, e cada uma fica registrada. Registre como o cliente autorizou aquela opção exata: o canal, o nome de quem autorizou e a evidência. Com a autorização, a proposta pode ser transmitida. Sem integração automática, você envia pelo portal da seguradora e registra o protocolo. A transmissão fica registrada com o protocolo, e o sistema bloqueia envios em duplicidade. Depois, registre a análise e o aceite, sempre com a evidência da seguradora. Com o documento emitido, a proposta vira apólice."
  },
  {
    "n": 10,
    "file": "10-apolices",
    "mod": "carteira",
    "s": 68,
    "title": "Apólices: cadastro e conferência",
    "routes": [
      "/apolices",
      "/apolices/nova"
    ],
    "desc": "Cadastrar a apólice, conferir o documento e tratar divergências.",
    "learn": [
      "Cadastrar apólice",
      "Conferir o documento emitido",
      "Abas da apólice"
    ],
    "text": "Em Apólices e certificados fica a carteira: número, cliente, seguradora, ramo, vigência e prêmio. Para apólices que vieram de fora do sistema, use Nova apólice: partes do contrato, vigência, prêmio, coberturas, itens e parcelas. Ao cadastrar, você pode aplicar a regra de comissão vigente. Ela é copiada para a apólice e mudanças futuras de percentual não alteram o que já foi contratado. Na apólice, o documento emitido é conferido com o que o cliente autorizou. Divergência vira pendência até ser resolvida. Depois de conferida, a apólice não é mais editada diretamente: mudanças são feitas por endosso. As abas mostram itens segurados, parcelas, comissão, repasses, endossos, cancelamento, sinistros, documentos, versões e renovação. Em Versões, cada alteração fica guardada, com quem fez e o motivo."
  },
  {
    "n": 11,
    "file": "11-endossos-e-cancelamentos",
    "mod": "carteira",
    "s": 47,
    "title": "Endossos e cancelamentos",
    "routes": [
      "/apolices/"
    ],
    "desc": "Pedir alterações na apólice e registrar cancelamentos.",
    "learn": [
      "Solicitar endosso",
      "Diferença de prêmio e comissão",
      "Cancelamento com motivo"
    ],
    "text": "Endosso é qualquer alteração na apólice: troca de veículo, inclusão de condutor, mudança de endereço ou de cobertura. Registre o pedido com o tipo e a descrição. Depois, acompanhe o protocolo e a resposta da seguradora. Quando o endosso é emitido, informe a diferença de prêmio. Se houver diferença de comissão, ela entra no controle de comissões. Em Cancelamento, registre o motivo, a data e a evidência. A apólice muda de estado e as parcelas futuras são tratadas. Estornos de comissão já liquidada geram ajuste nos repasses, sem apagar o histórico."
  },
  {
    "n": 12,
    "file": "12-renovacoes",
    "mod": "carteira",
    "s": 39,
    "title": "Renovações",
    "routes": [
      "/renovacoes"
    ],
    "desc": "Acompanhar vencimentos e iniciar a renovação com antecedência.",
    "learn": [
      "Faixas de vencimento",
      "Iniciar a renovação",
      "Gerar tarefas de alerta"
    ],
    "text": "Renovações mostra as apólices por faixa de vencimento, para você agir com antecedência. Iniciar abre uma oportunidade de renovação ligada à apólice atual, com o lembrete de revisar o risco com o cliente. Cotar inicia a renovação e já abre a nova cotação para o mesmo cliente e ramo. Declarações antigas não são reenviadas sem revisão. Gerar tarefas de alerta cria lembretes conforme os prazos definidos nas configurações. Quando a nova apólice é cadastrada, a anterior fica marcada como renovada."
  },
  {
    "n": 13,
    "file": "13-parcelas-do-seguro",
    "mod": "carteira",
    "s": 46,
    "title": "Parcelas do seguro",
    "routes": [
      "/parcelas"
    ],
    "desc": "Vencidas, próximas, pagamento informado e divergências.",
    "learn": [
      "Acompanhar parcelas",
      "Informado × confirmado",
      "Link de parcelas para o cliente"
    ],
    "text": "Parcelas do seguro acompanha o prêmio que o cliente paga à seguradora. Isso é diferente da comissão da corretora. Filtre as vencidas, as próximas, os pagamentos informados para conferência e as divergências. Abra a parcela para registrar o pagamento ou o contato com o cliente. Pagamento informado pelo cliente não é pagamento confirmado. Ele fica em conferência até a confirmação pela fonte oficial. Na apólice, você gera um link para o cliente ver as parcelas e enviar o comprovante. E com CSV você exporta a lista para trabalhar em planilha."
  },
  {
    "n": 14,
    "file": "14-sinistros-e-solicitacoes",
    "mod": "carteira",
    "s": 42,
    "title": "Sinistros e solicitações",
    "routes": [
      "/sinistros"
    ],
    "desc": "Aviso de sinistro, andamento, decisão da seguradora e pós-venda.",
    "learn": [
      "Abrir um sinistro",
      "Andamento e prazos",
      "Solicitações e assistências"
    ],
    "text": "Em Sinistros e solicitações você acompanha o pós-venda. O sinistro registra a ocorrência, o protocolo da seguradora, os documentos pedidos e entregues e o histórico. A decisão sobre cobertura é sempre da seguradora e só é registrada com a evidência. Atualize o andamento, o prazo e a regra aplicada, e o responsável. Em Solicitações ficam segunda via, assistência, atualização cadastral, dúvidas e reclamações, com prioridade e responsável."
  },
  {
    "n": 15,
    "file": "15-comissoes-acordos-e-regras",
    "mod": "financeiro",
    "s": 47,
    "title": "Comissões: acordos, regras e a receber",
    "routes": [
      "/comissoes"
    ],
    "desc": "Comissão prevista, confirmada, ajustes e contestações.",
    "learn": [
      "Acordos e regras versionadas",
      "Comissões a receber",
      "Ajustar e contestar"
    ],
    "text": "Comissões controla o que a seguradora deve à corretora: prevista, confirmada, recebida e ajustada. Em Acordos e regras, cadastre o acordo com cada seguradora e as regras por ramo e produto. Cada regra tem versão e vigência. A apólice guarda a regra da contratação. Em A receber, cada parcela de comissão mostra o vencimento, o saldo confirmado e a situação. Confirme o valor informado pela seguradora, registre um ajuste com motivo ou abra uma contestação. As contestações ficam abertas até a resposta da seguradora, com o histórico de cada uma."
  },
  {
    "n": 16,
    "file": "16-extratos-e-liquidacoes",
    "mod": "financeiro",
    "s": 43,
    "title": "Extratos da seguradora e liquidações",
    "routes": [
      "/comissoes"
    ],
    "desc": "Importar o extrato de comissões, conciliar e dar baixa.",
    "learn": [
      "Importar extrato da seguradora",
      "Conciliar linha a linha",
      "Liquidação e estorno"
    ],
    "text": "Em Extratos da seguradora, importe o arquivo de comissões em CSV. Antes de gravar, você vê a prévia, e as linhas com problema são apontadas. Cada linha é conciliada com a comissão prevista. Diferenças viram ajuste ou contestação. Em Liquidações, registre o recebimento: valor bruto, impostos retidos e conta de destino. O valor é distribuído entre as comissões em centavos exatos, sem sobra nem falta. Uma liquidação errada é estornada com motivo. O histórico continua visível na auditoria."
  },
  {
    "n": 17,
    "file": "17-repasses",
    "mod": "financeiro",
    "s": 43,
    "title": "Repasses a parceiros",
    "routes": [
      "/repasses"
    ],
    "desc": "Parceiros, regras de divisão, liberações e lotes de pagamento.",
    "learn": [
      "Cadastrar parceiro e favorecido",
      "Regras de divisão",
      "Lotes com aprovação"
    ],
    "text": "Repasses controla a parte da comissão que vai para produtores, indicadores e parceiros. Cadastre o parceiro e os dados do favorecido. Mudar a conta de pagamento pede a sua senha ou o código do autenticador. As regras dizem quanto cada parceiro recebe, por percentual ou valor, com vigência. O repasse só é liberado sobre comissão efetivamente recebida, nunca sobre a prevista. Agrupe as liberações em um lote, aprove e registre o pagamento. Itens de lote aprovado não podem ser alterados."
  },
  {
    "n": 18,
    "file": "18-financeiro-da-corretora",
    "mod": "financeiro",
    "s": 52,
    "title": "Financeiro da corretora",
    "routes": [
      "/financeiro"
    ],
    "desc": "Contas, extrato bancário, conciliação, projeção e fechamento.",
    "learn": [
      "Importar extrato bancário",
      "Conciliar lançamentos",
      "Projeção, resultado e fechamento"
    ],
    "text": "O Financeiro da corretora cuida do dinheiro da própria corretora. Cadastre as contas bancárias e importe o extrato em OFX ou CSV. Cada lançamento do extrato é conciliado com uma liquidação de comissão, um repasse ou uma conta a pagar. O sistema sugere as correspondências, mas a decisão é sua. Em Contas a pagar e receber, lance despesas e receitas da corretora. A projeção de caixa soma o que está previsto para entrar e sair. O resultado gerencial mostra receitas de comissão, repasses e despesas do período. Ao fechar um período, os lançamentos daquele mês ficam travados contra alterações."
  },
  {
    "n": 19,
    "file": "19-seguradoras-e-integracoes",
    "mod": "cadastros",
    "s": 70,
    "title": "Seguradoras e integrações",
    "routes": [
      "/integracoes"
    ],
    "desc": "Adicionar uma seguradora e configurar o caminho em cinco etapas.",
    "learn": [
      "Adicionar empresa",
      "As cinco etapas da conexão",
      "Automático só quando validado"
    ],
    "text": "Em Seguradoras e integrações você cadastra as seguradoras e parceiros com quem a corretora trabalha. Pesquise a empresa e escolha o caminho: API da seguradora, plataforma de multicálculo, arquivos oficiais ou atendimento assistido. A configuração tem cinco etapas, e o progresso mostra exatamente o que falta. Os dados da corretora são reaproveitados do cadastro: razão social, CNPJ e registro SUSEP. O checklist lista os requisitos e documentos do credenciamento. Prepare o texto da solicitação de acesso e registre o protocolo. Com o credenciamento aprovado, você informa as credenciais. Elas são guardadas cifradas e nunca voltam para a tela. Depois do teste de conexão, cada função é ativada separadamente: cotação, transmissão, parcelas. Enquanto isso não acontece, o trabalho continua no modo assistido, sem nenhum resultado simulado."
  },
  {
    "n": 20,
    "file": "20-produtos-e-documentos",
    "mod": "cadastros",
    "s": 49,
    "title": "Produtos, documentos e importações",
    "routes": [
      "/produtos",
      "/documentos"
    ],
    "desc": "Catálogo de produtos, documentos, importação de carteira e links.",
    "learn": [
      "Cadastrar produtos e coberturas",
      "Guardar documentos",
      "Importar clientes e apólices"
    ],
    "text": "Em Planos, produtos e coberturas fica o catálogo de produtos de cada seguradora, por ramo e versão. Cadastre o produto com o ramo, a vigência, as coberturas e as assistências. Os produtos aparecem nas fontes elegíveis de cada cotação. Em Documentos ficam todos os arquivos da corretora. O sistema confere o tipo real do arquivo e guarda as versões. Em Importações, traga sua carteira atual de clientes e apólices por planilha CSV. Antes de gravar, as linhas com erro são separadas para correção. E em Links temporários você vê e revoga os links enviados aos clientes."
  },
  {
    "n": 21,
    "file": "21-comunicacao",
    "mod": "cadastros",
    "s": 33,
    "title": "Comunicação com o cliente",
    "routes": [
      "/comunicacao"
    ],
    "desc": "Mensagens preparadas, modelos de WhatsApp e consentimento de marketing.",
    "learn": [
      "Preparar mensagens",
      "Modelos de WhatsApp",
      "Regras de marketing"
    ],
    "text": "Em Comunicação ficam as mensagens enviadas aos clientes. Escolha o cliente, o canal e a finalidade. A mensagem abre no seu WhatsApp ou e-mail, e o envio é feito pelo seu aparelho. Os modelos de WhatsApp agilizam lembretes de parcela, renovação e comparativo. Mensagens de marketing só vão para quem autorizou e não pediu para sair. Tudo fica registrado no atendimento do cliente."
  },
  {
    "n": 22,
    "file": "22-relatorios-e-exportacao",
    "mod": "gestao",
    "s": 27,
    "title": "Relatórios e exportação de dados",
    "routes": [
      "/relatorios"
    ],
    "desc": "Indicadores, produção por ramo e seguradora e exportações.",
    "learn": [
      "Indicadores do período",
      "Produção por ramo e seguradora",
      "Exportar CSV e cópia completa"
    ],
    "text": "Relatórios e indicadores mostra a produção da corretora no período escolhido. Veja apólices e prêmio intermediado por ramo e por seguradora. Em Exportações, baixe apólices, parcelas e comissões em CSV. A cópia completa dos dados gera um arquivo com tudo da sua corretora. Os seus dados são seus."
  },
  {
    "n": 23,
    "file": "23-auditoria-e-privacidade",
    "mod": "gestao",
    "s": 46,
    "title": "Auditoria e privacidade (LGPD)",
    "routes": [
      "/auditoria",
      "/privacidade"
    ],
    "desc": "Trilha de auditoria, eventos de negócio e pedidos de titulares.",
    "learn": [
      "Quem fez o quê e quando",
      "Eventos de negócio",
      "Solicitações da LGPD"
    ],
    "text": "A Auditoria registra quem fez o quê e quando: alterações, aprovações, downloads e acessos sensíveis. Os registros não podem ser apagados nem alterados. Eventos de negócio mostram os marcos de cada processo, como cotação recebida, proposta transmitida e comissão liquidada. Em Privacidade, registre os pedidos dos titulares de dados: acesso, correção, exportação, eliminação, revogação e informação. Cada pedido tem prazo, responsável e resposta registrada. Dados que a lei obriga a guardar são mantidos, com a justificativa."
  },
  {
    "n": 24,
    "file": "24-configuracoes-usuarios-e-perfis",
    "mod": "config",
    "s": 51,
    "title": "Configurações, usuários e perfis",
    "routes": [
      "/configuracoes"
    ],
    "desc": "Dados da corretora, unidades, usuários, perfis, regras e aparência.",
    "learn": [
      "Dados e logotipo da corretora",
      "Usuários e perfis de acesso",
      "Regras de numeração, prazos e aprovações"
    ],
    "text": "Em Configurações da corretora ficam os dados que aparecem nos documentos: razão social, CNPJ, SUSEP, contatos e logotipo. Cadastre as unidades ou filiais da corretora. Em Usuários, cadastre a equipe e defina o perfil de cada pessoa. O sistema gera uma senha provisória para o primeiro acesso. Os perfis definem o que cada um pode ver e fazer. Um corretor pode ver só a própria carteira, por exemplo. Em Regras: numeração dos documentos, prazos de renovação e de parcelas, pesos da pontuação e aprovações internas. E em Aparência, a cor e o estilo do sistema para toda a equipe."
  },
  {
    "n": 25,
    "file": "25-suporte-e-treinamento",
    "mod": "config",
    "s": 57,
    "title": "Suporte e treinamento",
    "routes": [
      "/suporte"
    ],
    "desc": "Vídeo-aulas, transcrição, dúvidas frequentes e contato.",
    "learn": [
      "Assistir às aulas",
      "Ler a transcrição",
      "Falar com o suporte"
    ],
    "text": "Em Suporte estão todas as vídeo-aulas do APOLVEN, organizadas por módulo, com o seu progresso. Clique em uma aula para assistir. Todas têm narração e legenda, e ao terminar a próxima já fica pronta. A transcrição acompanha o vídeo. Clique em uma frase para ir direto àquele ponto. Use a busca para encontrar a aula pelo assunto, inclusive pelo que é dito nela. Abaixo ficam as perguntas frequentes, o fluxo de uma venda, os atalhos e o contato com o suporte. E em qualquer tela, o ponto de interrogação abre a aula daquele assunto. Bons estudos!"
  }
];

export const TOTAL_SECONDS = 1542;

const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const videoUrl = (l) => `${base}/treinamento/${l.file}.mp4`;
export const posterUrl = (l) => `${base}/treinamento/${l.file}-capa.jpg`;
export const thumbUrl = (l) => `${base}/treinamento/${l.file}.jpg`;
export const captionsUrl = (l) => `${base}/treinamento/${l.file}.vtt`;
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Aula sugerida para a tela atual (a rota mais específica que combina). */
export function lessonFor(pathname) {
  let best = null; let len = -1;
  for (const l of LESSONS) {
    for (const r of l.routes) {
      const ok = r === '/' ? pathname === '/' : r.endsWith('/') ? pathname.startsWith(r) && pathname.length > r.length : pathname === r || pathname.startsWith(`${r}/`);
      if (ok && r.length > len) { best = l; len = r.length; }
    }
  }
  return best;
}
