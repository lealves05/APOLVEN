// Roteiro das vídeo-aulas do APOLVEN. Cada passo: act (o que acontece na tela) e say (falas = legendas).
// Mantenha cada fala curta (até ~2 linhas de legenda).

export const MODULES = [
  { key: 'inicio', label: 'Primeiros passos' },
  { key: 'crm', label: 'Relacionamento' },
  { key: 'vendas', label: 'Vendas e multicálculo' },
  { key: 'carteira', label: 'Carteira e pós-venda' },
  { key: 'financeiro', label: 'Comissões, repasses e financeiro' },
  { key: 'cadastros', label: 'Seguradoras, produtos e documentos' },
  { key: 'gestao', label: 'Gestão e conformidade' },
  { key: 'config', label: 'Configurações e suporte' },
];

const ymd = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => ymd(new Date(Date.now() + n * 86400000));

/** Prepara a venda da demonstração: cotação válida registrada, comparativo e (opcional) escolha e proposta. */
async function flow(api, { upTo = 'comparison' } = {}) {
  const list = await api('GET', '/v1/quote-requests');
  const qr = await api('GET', `/v1/quote-requests/${list[0].id}`);
  const round = qr.round;
  const task = round.tasks.find((t) => t.status === 'pendente_assistida');
  const st = { request: qr, round };
  if (task) {
    st.offer = await api('POST', `/v1/quote-requests/tasks/${task.id}/offers`, {
      product_name: 'Auto Clássico', quote_kind: 'cotacao_valida', origin: 'informada_pela_seguradora', external_id: 'COT-778120', valid_until: inDays(12),
      total_premium_cents: 231000, premium_net_cents: 214000, taxes_cents: 17000, fees_cents: 0,
      coverages: [{ code: 'casco', name: 'Casco (colisão, incêndio e roubo)', limit_cents: null, deductible_text: 'Franquia normal', deductible_cents: 290000 },
        { code: 'rcf_dm', name: 'RCF danos materiais', limit_cents: 15000000 }, { code: 'rcf_dc', name: 'RCF danos corporais', limit_cents: 15000000 }],
      assistances: [{ name: 'Guincho 24h (400 km)' }, { name: 'Carro reserva 7 dias' }],
      payment_options: [{ method: 'cartao', installments: 10, installment_cents: 23100, total_cents: 231000 }, { method: 'boleto', installments: 1, total_cents: 219450 }],
      commission_rate: 20, commission_source: 'retornada',
    });
  }
  if (upTo === 'offer') return st;
  const view = await api('GET', `/v1/quote-requests/${qr.id}`);
  const offers = view.round.offers.filter((o) => o.status === 'ativa');
  st.comparison = await api('POST', '/v1/comparisons', { round_id: round.id, offer_ids: offers.map((o) => o.id), message: 'Olá! Segue o comparativo das opções para o seu carro.' });
  if (upTo === 'comparison') return st;
  const valid = offers.find((o) => o.quote_kind === 'cotacao_valida');
  await api('POST', `/v1/comparisons/${st.comparison.id}/choose`, { offer_id: valid.id, payment_option: valid.payment_options?.[0]?.id || null, via: 'whatsapp', by_name: 'Ana Beatriz Oliveira' });
  st.proposal = await api('POST', '/v1/proposals', { offer_id: valid.id, comparison_id: st.comparison.id });
  if (upTo === 'proposal') return st;
  return st;
}

/** Cartões explicativos da aula 27 (mesmo visual do cartão de abertura). */
const LOGO = '<span class="l"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span>';
const slide = (tag, title, body) => `<div class="k">${LOGO}APOLVEN · TREINAMENTO</div><div class="n">${tag}</div><h1 style="font-size:52px">${title}</h1>${body}<div class="m" style="bottom:auto;top:60px;left:auto;right:110px">Seguradora e credenciais fictícias</div>`;
const list = (items) => `<ul class="b">${items.map((t, i) => `<li data-i="${i + 1}">${t}</li>`).join('')}</ul>`;

export const LESSONS = [
  // ───────────────────────── Primeiros passos
  {
    n: 1, file: '01-conhecendo-o-apolven', mod: 'inicio', title: 'Conhecendo o APOLVEN', routes: ['/'], start: '/',
    desc: 'O painel, o menu, a busca rápida, o botão Novo e os alertas.',
    learn: ['O que o painel mostra', 'Como o menu está organizado', 'Busca, botão Novo e alertas'],
    steps: [
      { say: ['Este é o painel do APOLVEN, o sistema de gestão da sua corretora de seguros.', 'Ele reúne, em uma tela, tudo o que precisa da sua atenção hoje.'] },
      { act: (h) => h.spot('Vendas em andamento'), say: ['Em Vendas em andamento ficam as cotações abertas, as consultas sem resposta e as propostas em contratação.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(380); await h.spot('Carteira e renovações'); }, say: ['Na carteira: apólices que vencem em 30 e 90 dias, apólices vigentes e documentos a conferir.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(420); await h.spot('Comissões da corretora'); }, say: ['Comissões da corretora e repasses a parceiros ficam em blocos próprios, sem misturar com o prêmio do seguro.'] },
      { act: async (h) => { await h.unspot(); await h.top(); await h.spot('Minhas tarefas'); }, say: ['À direita, as suas próximas tarefas, com prazo e prioridade.'] },
      { act: async (h) => { await h.unspot(); await h.click('Vendas'); await h.click('Carteira'); await h.spot(h.page.locator('aside nav, nav').first()); }, say: ['O menu lateral reúne os módulos: relacionamento, vendas, carteira, financeiro, cadastros, gestão e configurações.'] },
      { act: async (h) => { await h.unspot(); await h.page.keyboard.press('Control+k'); await h.sleep(500); await h.page.keyboard.type('Ana', { delay: 120 }); await h.sleep(1200); }, say: ['Para achar um cliente, apólice, proposta ou placa, use a busca, com Control mais K.', 'Os resultados respeitam a sua carteira e as suas permissões.'] },
      { act: async (h) => { await h.esc(); await h.click('Novo'); }, say: ['O botão Novo abre os atalhos do dia a dia: nova cotação, novo cliente, cadastrar apólice e nova solicitação.'] },
      { act: async (h) => { await h.page.getByRole('button', { name: 'Novo', exact: true }).click().catch(() => {}); await h.sleep(500); await h.spot(h.page.locator('header a[aria-label^="Ajuda"]').first()); }, say: ['O ponto de interrogação abre a vídeo-aula da tela em que você está.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.locator('button[aria-label^="Alertas"]')); }, say: ['No sino ficam as pendências. Gerar tarefas cria os lembretes de renovação, de parcelas vencidas e de cotações perto de vencer.'] },
      { act: async (h) => { await h.page.locator('button[aria-label^="Alertas"]').click(); await h.sleep(400); await h.spot('Ativar uso normal'); }, say: ['Na demonstração, os dados são fictícios. Quando quiser, use Ativar uso normal para começar com os dados da sua corretora.'] },
    ],
  },
  {
    n: 2, file: '02-conta-e-seguranca', mod: 'inicio', title: 'Sua conta e a verificação em duas etapas', routes: ['/conta'], start: '/conta',
    desc: 'Perfil, senha, verificação em duas etapas e aparência.',
    learn: ['Atualizar perfil e senha', 'Ativar o aplicativo autenticador', 'Quem precisa da verificação'],
    steps: [
      { say: ['Em Minha conta e segurança você cuida do seu acesso.'] },
      { act: (h) => h.spot('Perfil'), say: ['No perfil ficam o seu nome e os seus contatos.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Senha'); }, say: ['Para trocar a senha, informe a atual e a nova. Senhas fracas ou muito comuns são recusadas.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Verificação em duas etapas'); }, say: ['A verificação em duas etapas usa um aplicativo autenticador no celular, como Google Authenticator ou Microsoft Authenticator.', 'Ela é obrigatória para proprietário, administrador e financeiro.'] },
      { act: (h) => h.click('Configurar com aplicativo autenticador'), say: ['Você escaneia o código QR, digita os seis números do aplicativo e guarda os códigos de recuperação em lugar seguro.'] },
      { act: async (h) => { await h.esc(); await h.scroll(500); await h.spot('Aparência'); }, say: ['Em Aparência, escolha o tema claro, escuro ou o mesmo do sistema.', 'Operações sensíveis, como trocar credenciais ou dados bancários, pedem o código de novo.'] },
    ],
  },

  // ───────────────────────── Relacionamento
  {
    n: 3, file: '03-clientes', mod: 'crm', title: 'Cadastro de clientes', routes: ['/clientes'], start: '/clientes',
    desc: 'Pessoa física ou jurídica, duplicidades e exportação.',
    learn: ['Cadastrar pessoa física ou jurídica', 'Evitar cadastros duplicados', 'Buscar e exportar'],
    steps: [
      { say: ['Em Clientes e grupos fica toda a sua base, com o responsável e as apólices vigentes de cada cliente.'] },
      { act: (h) => h.click('Novo cliente'), say: ['Para cadastrar, clique em Novo cliente e escolha pessoa física ou jurídica.'] },
      { act: async (h) => { await h.type('Nome completo', 'Carlos Henrique Prado'); await h.type('E-mail', 'carlos.prado@exemplo.com'); await h.type('Telefone', '19988776655'); },
        say: ['Preencha o nome, os contatos e, se tiver, o CPF ou CNPJ.', 'O documento é conferido e evita cadastrar a mesma pessoa duas vezes.'] },
      { act: (h) => h.scroll(300), say: ['Abaixo ficam o endereço e as observações. Só o nome é obrigatório.'] },
      { act: (h) => h.click('Cadastrar cliente', { wait: 1500 }), say: ['Ao salvar, a ficha do cliente é aberta.'] },
      { act: async (h) => { await h.go('/clientes'); await h.spot('Possíveis duplicidades'); }, say: ['Possíveis duplicidades lista cadastros parecidos para você revisar e unir, sempre com confirmação.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Exportar CSV'); }, say: ['E Exportar CSV gera a planilha da sua carteira.'] },
    ],
  },
  {
    n: 4, file: '04-ficha-do-cliente', mod: 'crm', title: 'A ficha do cliente', routes: ['/clientes/'], start: '/clientes',
    desc: 'Contatos, vínculos, autorizações, atendimento, apólices e documentos.',
    learn: ['Abas da ficha', 'Autorizações (consentimentos)', 'Atendimento e histórico'],
    steps: [
      { act: async (h) => { await h.click('Ana Beatriz Oliveira', { wait: 1200 }); }, say: ['A ficha reúne tudo sobre o cliente. No topo, atalhos para ligar, mandar e-mail, abrir oportunidade ou cotação.'] },
      { act: (h) => h.click('Contatos (0)'), say: ['Em Contatos, cadastre outras pessoas: o sócio, a secretária, quem decide.'] },
      { act: (h) => h.click('Vínculos (1)'), say: ['Vínculos ligam clientes entre si: cônjuge, filhos, empresa e sócios.'] },
      { act: (h) => h.click('Autorizações (1)'), say: ['Em Autorizações ficam os consentimentos do cliente: para cotar, para compartilhar dados e para receber ofertas.', 'Se a autorização for revogada, o sistema bloqueia o uso daquela finalidade.'] },
      { act: (h) => h.click('Atendimento'), say: ['Atendimento guarda o histórico de contatos, tarefas e mensagens.'] },
      { act: (h) => h.click('Apólices e mais (1)'), say: ['Aqui aparecem apólices, propostas, cotações e sinistros do cliente.'] },
      { act: (h) => h.click('Documentos'), say: ['E em Documentos você anexa RG, CNH, comprovantes e laudos, com controle de versão.'] },
    ],
  },
  {
    n: 5, file: '05-oportunidades-e-agenda', mod: 'crm', title: 'Oportunidades e agenda', routes: ['/oportunidades', '/agenda'], start: '/oportunidades',
    desc: 'O funil de vendas e as tarefas da equipe.',
    learn: ['Funil de oportunidades', 'Próxima ação', 'Agenda e tarefas'],
    steps: [
      { say: ['O CRM organiza as oportunidades em um funil, do primeiro contato até a venda.'] },
      { act: (h) => h.spot('Seguro auto — carro novo'), say: ['Cada cartão mostra o cliente, o ramo e o prêmio estimado. Mude a etapa conforme a negociação avança.'] },
      { act: async (h) => { await h.unspot(); await h.click('Lista'); }, say: ['Na visão em lista, filtre e ordene as oportunidades.', 'Oportunidade sem próxima ação aparece em destaque no painel, para nada ficar esquecido.'] },
      { act: (h) => h.click('Nova oportunidade'), say: ['Para criar, escolha o cliente, o ramo, a necessidade e a próxima ação com data.'] },
      { act: async (h) => { await h.esc(); await h.go('/agenda'); }, say: ['Na Agenda ficam as tarefas de hoje e das próximas datas.'] },
      { act: (h) => h.spot('Concluir'), say: ['Conclua ou cancele cada tarefa. Filtre entre as suas tarefas e as da equipe.'] },
      { act: async (h) => { await h.unspot(); await h.click('Nova tarefa'); }, say: ['Nova tarefa permite definir responsável, prazo, prioridade e o cliente relacionado.'] },
      { act: (h) => h.esc() },
    ],
  },

  {
    n: 26, file: '26-agente-whatsapp', mod: 'crm', title: 'Agente do WhatsApp', routes: ['/agente-whatsapp'], start: '/agente-whatsapp',
    desc: 'Avisos automáticos aos clientes, lembretes da equipe e atendimento pelo WhatsApp Business.',
    learn: ['Conectar o número (API oficial)', 'Avisos e lembretes automáticos', 'Assistente, conversas e SAIR'],
    steps: [
      { say: ['O Agente do WhatsApp liga o número de WhatsApp Business da corretora ao APOLVEN, pela API oficial da Meta.'] },
      { act: (h) => h.spot('Número do WhatsApp Business'), say: ['Informe o ID do número, o token permanente e a chave secreta do app. As credenciais ficam cifradas, e trocá-las exige o código do autenticador.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(420); await h.spot('Webhook (mensagens recebidas)'); }, say: ['No app da Meta, cadastre a URL de retorno e o token de verificação. Toda mensagem recebida tem a assinatura conferida.'] },
      { act: async (h) => { await h.unspot(); await h.top(); await h.click('Avisos aos clientes'); }, say: ['Em Avisos aos clientes, ligue as rotinas: parcela a vencer, parcela vencida, renovação, cotação perto de vencer e aniversário.', 'Só recebe quem autorizou os avisos por WhatsApp, no horário permitido e nunca duas vezes o mesmo aviso.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: /Prévia de hoje/ }).nth(2), { wait: 1200 }); }, say: ['A prévia mostra quem receberia hoje e o texto, sem enviar nada.'] },
      { act: async (h) => { await h.esc(); await h.click('Modelos da Meta'); }, say: ['Mensagens iniciadas pela corretora precisam de modelo aprovado pela Meta. Copie os textos sugeridos e cadastre com o mesmo nome.'] },
      { act: (h) => h.click('Lembretes da equipe'), say: ['Os lembretes da equipe criam tarefas na Agenda: renovações, parcelas vencidas, cotações e propostas paradas.', 'Quem quiser recebe também um resumo diário no próprio WhatsApp, ligado em Minha conta.'] },
      { act: async (h) => {
        await h.click('Testar o assistente');
        const c = await h.label('Escrever como'); if (c) { await c.click(); await h.page.keyboard.type('Ana', { delay: 110 }); await h.sleep(1200); await h.page.getByText('Ana Beatriz Oliveira').locator('visible=true').first().click().catch(() => h.warn('cliente')); }
        await h.type(h.page.getByLabel('Mensagem do cliente'), 'oi'); await h.page.keyboard.press('Enter'); await h.sleep(1600);
      }, say: ['Em Testar o assistente, você conversa como se fosse o cliente, sem enviar nada. O assistente responde com o menu.'] },
      { act: async (h) => { for (const m of ['1', '123']) { await h.type(h.page.getByLabel('Mensagem do cliente'), m); await h.page.keyboard.press('Enter'); await h.sleep(1500); } },
        say: ['Para mostrar apólices e parcelas, ele confere antes os três primeiros dígitos do CPF.'] },
      { act: async (h) => { for (const m of ['3', 'Bati o carro no estacionamento do mercado agora']) { await h.type(h.page.getByLabel('Mensagem do cliente'), m); await h.page.keyboard.press('Enter'); await h.sleep(1500); } },
        say: ['No aviso de sinistro, ele indica a assistência 24 horas e registra uma solicitação com protocolo para o corretor.'] },
      { act: async (h) => { await h.type(h.page.getByLabel('Mensagem do cliente'), '5'); await h.page.keyboard.press('Enter'); await h.sleep(1500); },
        say: ['Com a opção 5, a conversa passa para a equipe e o assistente fica em silêncio.'] },
      { act: async (h) => { await h.click('Conversas'); await h.click(h.page.locator('main button', { hasText: 'Bruno Carvalho' }).first(), { wait: 1200 }); },
        say: ['Em Conversas, a equipe assume o atendimento, responde dentro da janela de 24 horas e depois devolve ao assistente.', 'E quem responde SAIR deixa de receber os avisos automáticos.'] },
    ],
  },

  // ───────────────────────── Vendas
  {
    n: 6, file: '06-nova-cotacao', mod: 'vendas', title: 'Nova cotação: o questionário do risco', routes: ['/cotacoes/nova'], start: '/cotacoes',
    desc: 'Cliente e ramo, dados do risco, coberturas mínimas e fontes.',
    learn: ['As quatro etapas da cotação', 'Coberturas mínimas e preferências', 'Fontes elegíveis e compartilhamento'],
    steps: [
      { say: ['Em Cotações e multicálculo ficam todas as cotações, com a situação, as ofertas e as pendências.'] },
      { act: (h) => h.click('Nova cotação', { wait: 1000 }), say: ['A nova cotação tem quatro etapas: cliente e ramo, dados do risco, coberturas e preferências, e fontes e envio.'] },
      { act: async (h) => {
        const c = await h.label('Cliente'); if (c) { await c.click(); await h.page.keyboard.type('Ana', { delay: 110 }); await h.sleep(1200); await h.page.getByText('Ana Beatriz Oliveira').locator('visible=true').first().click().catch(() => h.warn('cliente')); }
        await h.select('Ramo', 'Auto, moto e caminhão');
      }, say: ['Escolha o cliente e o ramo. O questionário muda conforme o ramo escolhido.'] },
      { act: (h) => h.click('Avançar'), say: ['Nos dados do risco, preencha o que a seguradora precisa para calcular. Os campos obrigatórios têm asterisco.'] },
      { act: async (h) => {
        await h.type('Marca / modelo', 'Hatch 1.0 Flex 2025'); await h.type('Ano do modelo', '2025');
        await h.select('Utilização', { index: 1 }); await h.type('CEP de pernoite', '13010-000'); await h.type('Condutor principal', 'Ana Beatriz Oliveira');
      }, say: ['Responda só o que o cliente informou. O que ficar em branco segue como não informado: o sistema nunca inventa respostas.'] },
      { act: (h) => h.click('Avançar', { wait: 900 }), say: ['Em coberturas, marque as coberturas mínimas e os limites. As ofertas são comparadas primeiro contra esses requisitos.'] },
      { act: (h) => h.scroll(450), say: ['Depois vêm as preferências: franquia, assistências e forma de pagamento, e a vigência pretendida.'] },
      { act: async (h) => { await h.top(); await h.click('Avançar', { wait: 1200 }); }, say: ['Na última etapa aparecem as fontes elegíveis: seguradoras com credenciamento para este ramo. As demais aparecem com o motivo da exclusão.'] },
      { act: async (h) => { await h.type('Base para compartilhar', 'Pedido do cliente para cotação, por WhatsApp'); }, say: ['Informe a base para compartilhar os dados do cliente com as seguradoras. Ela fica registrada na rodada e na auditoria.'] },
      { act: (h) => h.click(h.page.getByRole('button', { name: /Criar cotação/ }), { wait: 2000 }), say: ['Ao enviar, a rodada é criada e não pode mais ser alterada. Se algo mudar, você faz uma nova rodada.'] },
    ],
  },
  {
    n: 7, file: '07-rodada-e-respostas', mod: 'vendas', title: 'Rodada de multicálculo e respostas das seguradoras', routes: ['/cotacoes/'], start: '/cotacoes',
    desc: 'Abrangência da pesquisa, consultas assistidas e registro da resposta formal.',
    learn: ['Ler a abrangência da pesquisa', 'Consulta automática × assistida', 'Registrar a resposta da seguradora'],
    steps: [
      { act: async (h) => { const href = await h.firstLink('/cotacoes/'); if (href) await h.go(href); }, say: ['Ao abrir a cotação, o topo mostra a abrangência real da pesquisa: quantas seguradoras eram elegíveis, quantas responderam e quantas estão pendentes.'] },
      { act: (h) => h.spot('Comparação parcial.', { pad: true }), say: ['Se faltar resposta, o sistema avisa que a comparação é parcial. Falha técnica ou falta de resposta nunca é tratada como recusa.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(560); await h.spot('Consultas por seguradora'); }, say: ['Cada seguradora vira uma consulta. Com integração ativa, a consulta é automática; sem ela, é assistida.'] },
      { act: async (h) => { await h.unspot(); await h.click('Registrar resposta', { wait: 900 }); }, say: ['Na consulta assistida, você pede a cotação no canal oficial da seguradora e registra aqui a resposta formal.'] },
      { act: async (h) => {
        await h.type('Produto', 'Auto Clássico'); await h.type('protocolo da cotação', 'COT-778120');
        await h.select('Origem', { value: 'informada_pela_seguradora' });
        const d = await h.label('Validade'); if (d) await d.fill(inDays(12));
      }, say: ['Informe o produto, o número da cotação, se é cotação válida ou só valor indicativo, a origem e a validade.'] },
      { act: async (h) => { await h.type('Prêmio total', '2310,00'); await h.scroll(380); }, say: ['Depois, o prêmio e as coberturas, com limites e franquias. Campo que a seguradora não informou fica em branco: nunca use zero.'] },
      { act: async (h) => {
        for (const t of ['Casco', 'RCF danos materiais']) { const lb = h.page.locator('.fixed.inset-0 label', { hasText: t }).first(); if (await lb.count()) { await lb.scrollIntoViewIfNeeded(); await lb.click(); await h.sleep(500); } else h.warn(`cobertura ${t}`); }
        await h.scroll(420);
        const tot = h.page.locator('.fixed.inset-0').getByLabel('Total da opção', { exact: false }).first();
        if (await tot.count()) { await tot.scrollIntoViewIfNeeded(); await tot.click(); await tot.pressSequentially('2310,00', { delay: 45 }); }
      }, say: ['Inclua as assistências, as exigências e as formas de pagamento com o total de cada opção.'] },
      { act: async (h) => { await h.click(h.page.locator('.fixed.inset-0 button.btn-primary', { hasText: 'Registrar resposta' }), { wait: 1500 }); await h.scroll(700); },
        say: ['Pronto: a resposta entra na comparação com a origem e a validade visíveis.', 'Valor indicativo também aparece, mas não pode virar proposta sem a confirmação da seguradora.'] },
    ],
  },
  {
    n: 8, file: '08-comparativo-do-cliente', mod: 'vendas', title: 'Comparativo e link para o cliente', routes: ['/comparativos/'], start: '/cotacoes',
    desc: 'Comparação técnica, comparativo para o cliente e escolha registrada.',
    learn: ['Comparar as ofertas', 'Gerar o comparativo', 'Enviar o link e registrar a escolha'],
    setup: (api) => flow(api, { upTo: 'offer' }),
    steps: [
      { act: async (h, s) => { await h.go(`/cotacoes/${s.request.id}`); await h.scroll(900); await h.spot('Comparação das ofertas'); },
        say: ['Com as respostas registradas, a comparação mostra lado a lado prêmio, coberturas, franquias, assistências, validade e pagamento.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(350); }, say: ['Primeiro, cada oferta é classificada frente às coberturas mínimas. A pontuação só vale para as que atendem e estão na validade.', 'A comissão aparece só para a equipe e nunca entra na pontuação.'] },
      { act: async (h) => { const boxes = h.page.locator('main input[type=checkbox]'); const n = await boxes.count(); for (let i = 0; i < n; i += 1) await boxes.nth(i).check().catch(() => {}); await h.sleep(500); await h.click(h.page.getByRole('button', { name: /Gerar comparativo/ })); },
        say: ['Selecione as ofertas e clique em Gerar comparativo. Escreva uma mensagem para o cliente, se quiser.'] },
      { act: async (h) => { await h.click(h.page.locator('.fixed button.btn-primary', { hasText: 'Gerar comparativo' }), { wait: 1600 }); }, say: ['O comparativo mostra ao cliente só o que ele precisa: sem comissão e sem dados internos.'] },
      { act: async (h) => { await h.top(); await h.click('Gerar link para o cliente', { wait: 1200 }); }, say: ['Daqui você gera o link temporário, envia pelo WhatsApp ou imprime em PDF.', 'O cliente abre o link, compara as opções e escolhe, autorizando expressamente aquela versão.'] },
      { act: async (h) => { await h.esc(); await h.spot('Registrar escolha do cliente'); }, say: ['Se a escolha vier por telefone ou pessoalmente, registre aqui com o canal e o nome de quem escolheu. A escolha não é aceitação da seguradora.'] },
    ],
  },
  {
    n: 9, file: '09-propostas-e-transmissao', mod: 'vendas', title: 'Propostas e transmissão', routes: ['/propostas'], start: '/propostas',
    desc: 'Autorização do cliente, transmissão, análise, aceite e emissão.',
    learn: ['Etapas da proposta', 'Transmissão assistida com protocolo', 'Registrar aceite com evidência'],
    setup: (api) => flow(api, { upTo: 'proposal' }),
    steps: [
      { act: async (h) => { await h.click('Todas'); }, say: ['Em Propostas e transmissão você acompanha cada proposta, da escolha do cliente até a apólice.'] },
      { act: async (h, s) => { await h.go(`/propostas/${s.proposal.id}`); }, say: ['A proposta guarda uma cópia exata da oferta escolhida. Se a cotação vencer, é preciso recalcular e pedir nova autorização.'] },
      { act: (h) => h.spot(h.page.locator('main ol, main [aria-label*="tapas"]').first()), say: ['Autorização do cliente, transmissão, recepção, análise, aceite e emissão são etapas diferentes, e cada uma fica registrada.'] },
      { act: async (h) => { await h.unspot(); await h.click('Registrar autorização do cliente'); }, say: ['Registre como o cliente autorizou aquela opção exata: o canal, o nome de quem autorizou e a evidência.'] },
      { act: async (h, s) => { await h.esc(); await h.api('POST', `/v1/proposals/${s.proposal.id}/authorizations`, { via: 'whatsapp', authorized_by_name: 'Ana Beatriz Oliveira', evidence: 'Mensagem de WhatsApp de 05/10 autorizando a opção Tokio Auto Clássico' }); await h.page.reload(); await h.settle(800); await h.click('Transmitir à seguradora'); },
        say: ['Com a autorização, a proposta pode ser transmitida. Sem integração automática, você envia pelo portal da seguradora e registra o protocolo.'] },
      { act: async (h) => { const f = h.page.locator('.fixed.inset-0 input').first(); if (await f.count()) { await f.click(); await f.pressSequentially('PRT-552310', { delay: 50 }); } await h.sleep(400);
        await h.click(h.page.locator('.fixed.inset-0 button.btn-primary', { hasText: 'Transmitir' }), { wait: 1500 }); },
        say: ['A transmissão fica registrada com o protocolo, e o sistema bloqueia envios em duplicidade.'] },
      { act: (h) => h.top(), say: ['Depois, registre a análise e o aceite, sempre com a evidência da seguradora. Com o documento emitido, a proposta vira apólice.'] },
    ],
  },

  // ───────────────────────── Carteira
  {
    n: 10, file: '10-apolices', mod: 'carteira', title: 'Apólices: cadastro e conferência', routes: ['/apolices', '/apolices/nova'], start: '/apolices',
    desc: 'Cadastrar a apólice, conferir o documento e tratar divergências.',
    learn: ['Cadastrar apólice', 'Conferir o documento emitido', 'Abas da apólice'],
    steps: [
      { say: ['Em Apólices e certificados fica a carteira: número, cliente, seguradora, ramo, vigência e prêmio.'] },
      { act: (h) => h.click('Nova apólice', { wait: 1000 }), say: ['Para apólices que vieram de fora do sistema, use Nova apólice: partes do contrato, vigência, prêmio, coberturas, itens e parcelas.'] },
      { act: async (h) => { await h.scroll(900); await h.spot('Comissão (regra vigente na contratação)'); }, say: ['Ao cadastrar, você pode aplicar a regra de comissão vigente. Ela é copiada para a apólice e mudanças futuras de percentual não alteram o que já foi contratado.'] },
      { act: async (h) => { await h.go('/apolices'); const href = await h.firstLink('/apolices/'); if (href) await h.go(href); }, say: ['Na apólice, o documento emitido é conferido com o que o cliente autorizou. Divergência vira pendência até ser resolvida.'] },
      { act: (h) => h.spot('Conferir documento'), say: ['Depois de conferida, a apólice não é mais editada diretamente: mudanças são feitas por endosso.'] },
      { act: async (h) => { await h.unspot(); await h.click('Itens (1)'); }, say: ['As abas mostram itens segurados, parcelas, comissão, repasses, endossos, cancelamento, sinistros, documentos, versões e renovação.'] },
      { act: (h) => h.click('Versões'), say: ['Em Versões, cada alteração fica guardada, com quem fez e o motivo.'] },
    ],
  },
  {
    n: 11, file: '11-endossos-e-cancelamentos', mod: 'carteira', title: 'Endossos e cancelamentos', routes: ['/apolices/'], start: '/apolices',
    desc: 'Pedir alterações na apólice e registrar cancelamentos.',
    learn: ['Solicitar endosso', 'Diferença de prêmio e comissão', 'Cancelamento com motivo'],
    steps: [
      { act: async (h) => { const href = await h.firstLink('/apolices/'); if (href) await h.go(href); await h.click('Endossos (0)'); }, say: ['Endosso é qualquer alteração na apólice: troca de veículo, inclusão de condutor, mudança de endereço ou de cobertura.'] },
      { act: async (h) => { const b = h.page.getByRole('button', { name: /endosso/i }).first(); if (await b.count()) await h.click(b); }, say: ['Registre o pedido com o tipo e a descrição. Depois, acompanhe o protocolo e a resposta da seguradora.'] },
      { act: (h) => h.esc(), say: ['Quando o endosso é emitido, informe a diferença de prêmio. Se houver diferença de comissão, ela entra no controle de comissões.'] },
      { act: (h) => h.click('Cancelamento'), say: ['Em Cancelamento, registre o motivo, a data e a evidência. A apólice muda de estado e as parcelas futuras são tratadas.', 'Estornos de comissão já liquidada geram ajuste nos repasses, sem apagar o histórico.'] },
    ],
  },
  {
    n: 12, file: '12-renovacoes', mod: 'carteira', title: 'Renovações', routes: ['/renovacoes'], start: '/renovacoes',
    desc: 'Acompanhar vencimentos e iniciar a renovação com antecedência.',
    learn: ['Faixas de vencimento', 'Iniciar a renovação', 'Gerar tarefas de alerta'],
    steps: [
      { say: ['Renovações mostra as apólices por faixa de vencimento, para você agir com antecedência.'] },
      { act: (h) => h.spot('Iniciar'), say: ['Iniciar abre uma oportunidade de renovação ligada à apólice atual, com o lembrete de revisar o risco com o cliente.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Cotar'); }, say: ['Cotar inicia a renovação e já abre a nova cotação para o mesmo cliente e ramo. Declarações antigas não são reenviadas sem revisão.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Gerar tarefas de alerta'); }, say: ['Gerar tarefas de alerta cria lembretes conforme os prazos definidos nas configurações.', 'Quando a nova apólice é cadastrada, a anterior fica marcada como renovada.'] },
    ],
  },
  {
    n: 13, file: '13-parcelas-do-seguro', mod: 'carteira', title: 'Parcelas do seguro', routes: ['/parcelas'], start: '/parcelas',
    desc: 'Vencidas, próximas, pagamento informado e divergências.',
    learn: ['Acompanhar parcelas', 'Informado × confirmado', 'Link de parcelas para o cliente'],
    steps: [
      { say: ['Parcelas do seguro acompanha o prêmio que o cliente paga à seguradora. Isso é diferente da comissão da corretora.'] },
      { act: (h) => h.click('Vencidas'), say: ['Filtre as vencidas, as próximas, os pagamentos informados para conferência e as divergências.'] },
      { act: async (h) => { await h.click('Todas'); }, say: ['Abra a parcela para registrar o pagamento ou o contato com o cliente.'] },
      { act: (h) => h.click('Pagamento informado (conferência)'), say: ['Pagamento informado pelo cliente não é pagamento confirmado. Ele fica em conferência até a confirmação pela fonte oficial.'] },
      { act: (h) => h.click('Todas'), say: ['Na apólice, você gera um link para o cliente ver as parcelas e enviar o comprovante.', 'E com CSV você exporta a lista para trabalhar em planilha.'] },
    ],
  },
  {
    n: 14, file: '14-sinistros-e-solicitacoes', mod: 'carteira', title: 'Sinistros e solicitações', routes: ['/sinistros'], start: '/sinistros',
    desc: 'Aviso de sinistro, andamento, decisão da seguradora e pós-venda.',
    learn: ['Abrir um sinistro', 'Andamento e prazos', 'Solicitações e assistências'],
    steps: [
      { say: ['Em Sinistros e solicitações você acompanha o pós-venda.'] },
      { act: async (h) => { const href = await h.firstLink('/sinistros/'); if (href) await h.go(href); }, say: ['O sinistro registra a ocorrência, o protocolo da seguradora, os documentos pedidos e entregues e o histórico.'] },
      { act: (h) => h.spot('Decisão informada pela seguradora'), say: ['A decisão sobre cobertura é sempre da seguradora e só é registrada com a evidência.'] },
      { act: async (h) => { await h.unspot(); await h.click('Atualizar andamento'); }, say: ['Atualize o andamento, o prazo e a regra aplicada, e o responsável.'] },
      { act: async (h) => { await h.esc(); await h.go('/sinistros'); await h.click('Solicitações'); }, say: ['Em Solicitações ficam segunda via, assistência, atualização cadastral, dúvidas e reclamações, com prioridade e responsável.'] },
    ],
  },

  // ───────────────────────── Financeiro
  {
    n: 15, file: '15-comissoes-acordos-e-regras', mod: 'financeiro', title: 'Comissões: acordos, regras e a receber', routes: ['/comissoes'], start: '/comissoes',
    desc: 'Comissão prevista, confirmada, ajustes e contestações.',
    learn: ['Acordos e regras versionadas', 'Comissões a receber', 'Ajustar e contestar'],
    steps: [
      { say: ['Comissões controla o que a seguradora deve à corretora: prevista, confirmada, recebida e ajustada.'] },
      { act: (h) => h.click('Acordos e regras'), say: ['Em Acordos e regras, cadastre o acordo com cada seguradora e as regras por ramo e produto.', 'Cada regra tem versão e vigência. A apólice guarda a regra da contratação.'] },
      { act: (h) => h.click('A receber'), say: ['Em A receber, cada parcela de comissão mostra o vencimento, o saldo confirmado e a situação.'] },
      { act: (h) => h.spot('Confirmar'), say: ['Confirme o valor informado pela seguradora, registre um ajuste com motivo ou abra uma contestação.'] },
      { act: async (h) => { await h.unspot(); await h.click('Contestações'); }, say: ['As contestações ficam abertas até a resposta da seguradora, com o histórico de cada uma.'] },
    ],
  },
  {
    n: 16, file: '16-extratos-e-liquidacoes', mod: 'financeiro', title: 'Extratos da seguradora e liquidações', routes: ['/comissoes'], start: '/comissoes',
    desc: 'Importar o extrato de comissões, conciliar e dar baixa.',
    learn: ['Importar extrato da seguradora', 'Conciliar linha a linha', 'Liquidação e estorno'],
    steps: [
      { act: (h) => h.click('Extratos da seguradora'), say: ['Em Extratos da seguradora, importe o arquivo de comissões em CSV.', 'Antes de gravar, você vê a prévia, e as linhas com problema são apontadas.'] },
      { act: (h) => h.spot('Extratos da seguradora'), say: ['Cada linha é conciliada com a comissão prevista. Diferenças viram ajuste ou contestação.'] },
      { act: async (h) => { await h.unspot(); await h.click('Liquidações'); }, say: ['Em Liquidações, registre o recebimento: valor bruto, impostos retidos e conta de destino.', 'O valor é distribuído entre as comissões em centavos exatos, sem sobra nem falta.'] },
      { act: (h) => h.spot('Liquidações'), say: ['Uma liquidação errada é estornada com motivo. O histórico continua visível na auditoria.'] },
    ],
  },
  {
    n: 17, file: '17-repasses', mod: 'financeiro', title: 'Repasses a parceiros', routes: ['/repasses'], start: '/repasses',
    desc: 'Parceiros, regras de divisão, liberações e lotes de pagamento.',
    learn: ['Cadastrar parceiro e favorecido', 'Regras de divisão', 'Lotes com aprovação'],
    steps: [
      { say: ['Repasses controla a parte da comissão que vai para produtores, indicadores e parceiros.'] },
      { act: (h) => h.click('Novo parceiro'), say: ['Cadastre o parceiro e os dados do favorecido. Mudar a conta de pagamento pede a sua senha ou o código do autenticador.'] },
      { act: async (h) => { await h.esc(); await h.click('Regras'); }, say: ['As regras dizem quanto cada parceiro recebe, por percentual ou valor, com vigência.'] },
      { act: (h) => h.click('Liberações'), say: ['O repasse só é liberado sobre comissão efetivamente recebida, nunca sobre a prevista.'] },
      { act: (h) => h.click('Lotes de pagamento'), say: ['Agrupe as liberações em um lote, aprove e registre o pagamento. Itens de lote aprovado não podem ser alterados.'] },
    ],
  },
  {
    n: 18, file: '18-financeiro-da-corretora', mod: 'financeiro', title: 'Financeiro da corretora', routes: ['/financeiro'], start: '/financeiro',
    desc: 'Contas, extrato bancário, conciliação, projeção e fechamento.',
    learn: ['Importar extrato bancário', 'Conciliar lançamentos', 'Projeção, resultado e fechamento'],
    steps: [
      { say: ['O Financeiro da corretora cuida do dinheiro da própria corretora.'] },
      { act: (h) => h.spot('Importar extrato (OFX/CSV)'), say: ['Cadastre as contas bancárias e importe o extrato em OFX ou CSV.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Conciliar'); }, say: ['Cada lançamento do extrato é conciliado com uma liquidação de comissão, um repasse ou uma conta a pagar.', 'O sistema sugere as correspondências, mas a decisão é sua.'] },
      { act: async (h) => { await h.unspot(); await h.click('Contas a pagar e receber'); }, say: ['Em Contas a pagar e receber, lance despesas e receitas da corretora.'] },
      { act: (h) => h.click('Projeção de caixa'), say: ['A projeção de caixa soma o que está previsto para entrar e sair.'] },
      { act: (h) => h.click('Resultado gerencial'), say: ['O resultado gerencial mostra receitas de comissão, repasses e despesas do período.'] },
      { act: (h) => h.click('Períodos'), say: ['Ao fechar um período, os lançamentos daquele mês ficam travados contra alterações.'] },
    ],
  },

  // ───────────────────────── Cadastros e integrações
  {
    n: 19, file: '19-seguradoras-e-integracoes', mod: 'cadastros', title: 'Seguradoras e integrações', routes: ['/integracoes'], start: '/integracoes',
    desc: 'Adicionar uma seguradora e configurar o caminho em cinco etapas.',
    learn: ['Adicionar empresa', 'As cinco etapas da conexão', 'Automático só quando validado'],
    steps: [
      { say: ['Em Seguradoras e integrações você cadastra as seguradoras e parceiros com quem a corretora trabalha.'] },
      { act: (h) => h.click('Adicionar empresa'), say: ['Pesquise a empresa e escolha o caminho: API da seguradora, plataforma de multicálculo, arquivos oficiais ou atendimento assistido.'] },
      { act: async (h) => { await h.esc(); await h.go('/integracoes'); await h.click('Continuar configuração', { wait: 1200 }); }, say: ['A configuração tem cinco etapas, e o progresso mostra exatamente o que falta.'] },
      { act: (h) => h.spot('Cadastro reaproveitado'), say: ['Os dados da corretora são reaproveitados do cadastro: razão social, CNPJ e registro SUSEP.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(500); await h.spot('Checklist do caminho'); }, say: ['O checklist lista os requisitos e documentos do credenciamento. Prepare o texto da solicitação de acesso e registre o protocolo.'] },
      { act: async (h) => { await h.unspot(); await h.top(); await h.spot(h.page.getByText('Etapa 3', { exact: false }).first()); }, say: ['Com o credenciamento aprovado, você informa as credenciais. Elas são guardadas cifradas e nunca voltam para a tela.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.getByText('Etapa 5', { exact: false }).first()); }, say: ['Depois do teste de conexão, cada função é ativada separadamente: cotação, transmissão, parcelas.', 'Enquanto isso não acontece, o trabalho continua no modo assistido, sem nenhum resultado simulado.'] },
    ],
  },
  {
    n: 27, file: '27-api-de-cotacao-da-seguradora', mod: 'cadastros', title: 'API de cotação da seguradora', routes: ['/integracoes/'], start: '/integracoes?tab=adicionar',
    externalPages: true,
    desc: 'Do pedido de acesso à cotação automática: OAuth2, teste de conexão, resultados ao vivo e contrato da API.',
    learn: ['O que pedir à seguradora (credenciais, URLs, ambientes)', 'Configurar OAuth2 e testar a conexão', 'Cotar automaticamente e acompanhar os resultados', 'Contrato da API, segurança e LGPD'],
    intro: 'Aula 27. API de cotação da seguradora: do pedido de acesso à cotação automática.',
    setup: async (api) => {
      // só seguradoras fictícias na tela: as conexões e produtos de exemplo da demonstração saem de cena
      for (const c of await api('GET', '/v1/integrations/connections')) if (!c.revoked_at) await api('POST', `/v1/integrations/connections/${c.id}/revoke`, { reason: 'Aula: somente seguradoras fictícias' });
      for (const p of await api('GET', '/v1/catalog/products')) if (['validado', 'ativo'].includes(p.status)) await api('POST', `/v1/catalog/products/${p.id}/status`, { status: 'retirado' });
      const mk = async (name, template, path) => {
        const i = await api('POST', '/v1/integrations/institutions', { kind: 'seguradora', name });
        const c = await api('POST', '/v1/integrations/connections', { institution_id: i.id, template_code: template, products: ['auto'], accreditation: 'sim', environment: 'producao' });
        if (path) {
          await api('PUT', `/v1/integrations/connections/${c.id}/api-config`, { base_url: `https://api.seguradora-exemplo.com.br/${path}`, auth_type: 'bearer', secrets: { token: `tok-${path}` }, timeout_ms: 15000 });
          await api('POST', `/v1/integrations/connections/${c.id}/connection-tests`, {});
        }
      };
      await mk('Seguradora Modelo S.A.', 'api_padrao_apolven', 'modelo');
      await mk('Seguradora Ilustrativa S.A.', 'api_padrao_apolven', 'ilustrativa');
      await mk('Seguradora Demonstrativa S.A.', 'assistida', null);
      const client = (await api('GET', '/v1/clients')).find((c) => c.kind === 'pf');
      await api('POST', `/v1/clients/${client.id}/consents`, { purpose: 'cotacao', evidence: 'autorização por e-mail registrada' });
      return { client };
    },
    steps: [
      { act: (h) => h.card(slide('Passo 1 · Conceito', 'O que é a API de cotação', `<div class="flow"><div>API de cotação<b>automática · ofertas em segundos</b></div><div>Consulta assistida<b>a equipe pede e registra a resposta</b></div></div>`)),
        say: ['Com a API de cotação, o APOLVEN consulta a seguradora sozinho e recebe as ofertas em segundos, sem digitação.',
          'Sem API, a consulta é assistida: a equipe pede pelo canal oficial e registra a resposta. As duas convivem.'] },
      { act: (h) => h.card(slide('Passo 2 · Antes de começar', 'O que pedir à seguradora', list(['Credenciamento da corretora e código comercial', 'Acesso ao portal do desenvolvedor', 'Credenciais de homologação e de produção (Client ID e Client Secret)', 'URL base da API de cotação', 'URL do token e escopos liberados']))),
        say: ['Peça à seguradora, ou ao parceiro de integração: o credenciamento da corretora e o acesso ao portal do desenvolvedor.',
          'Lá ficam as credenciais de homologação e de produção, a URL base da API, a URL do token e os escopos liberados.'] },
      { act: (h) => h.card(slide('Passo 3 · O modelo das seguradoras', 'OAuth2 com client credentials', `<div class="flow"><div>1. APOLVEN envia Client ID + Client Secret<b>POST /oauth/token</b></div><span class="ar">→</span><div>2. Seguradora devolve o token de acesso<b>expires_in: 3600 (1 hora)</b></div><span class="ar">→</span><div>3. APOLVEN cota com o token<b>Authorization: Bearer …</b></div></div>`)),
        say: ['A maioria das seguradoras usa OAuth2 com client credentials: o APOLVEN envia o Client ID e o Client Secret e recebe um token de acesso.',
          'Com o token, válido por exemplo por uma hora, ele chama a API de cotação. Quando vence, pede outro sozinho.'] },
      { act: async (h) => { await h.card(null); await h.page.goto('https://portal.seguradora-exemplo.com.br/'); await h.settle(600); await h.step('Passo 4 · Portal da seguradora'); await h.spot(h.page.locator('.tabs')); },
        say: ['As credenciais ficam no portal do desenvolvedor da seguradora, aqui um portal fictício.',
          'Homologação é o ambiente de testes; produção, o das cotações reais. Cada um tem o seu Client ID e o seu Client Secret.'] },
      { act: async (h) => { await h.spot(h.page.locator('#cid')); await h.sleep(600); await h.click(h.page.locator('#gen')); await h.spot(h.page.locator('#credenciais')); },
        say: ['Este é o Client ID. O Client Secret aparece uma única vez, ao ser gerado: guarde com cuidado, ele vale como uma senha.'] },
      { act: async (h) => { await h.spot(h.page.locator('#enderecos')); },
        say: ['Anote também a URL do token, a URL base da API e o escopo, aqui “cotacao”.'] },
      { act: async (h) => { await h.unspot(); await h.go('/integracoes?tab=adicionar'); await h.step('Passo 5 · Cadastro da seguradora'); await h.type('Pesquisar empresa', 'Seguradora Exemplo', { delay: 18 }); await h.sleep(500); },
        say: ['Agora, no APOLVEN: Seguradoras e integrações, Adicionar empresa. Pesquise a seguradora; se ela não estiver no catálogo, cadastre.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Cadastrar empresa não encontrada' }).last()); await h.type('Nome comercial', 'Seguradora Exemplo S.A.', { delay: 18 }); await h.click(h.page.getByText('Esta empresa tem API de cotação', { exact: false })); },
        say: ['Informe o nome e marque: “Esta empresa tem API de cotação”.'] },
      { act: async (h) => { await h.click('Salvar cadastro assistido', { wait: 1500 }); await h.spot(h.page.getByText('API de cotação — padrão APOLVEN', { exact: true }).first()); },
        say: ['O caminho “API de cotação, padrão APOLVEN” já vem escolhido.'] },
      { act: async (h) => { await h.spot(h.page.getByLabel('Ambiente')); await h.page.getByLabel('Auto, moto e caminhão').check().catch(() => {}); await h.spot(h.page.getByText('Produtos desejados').first()); },
        say: ['Confira o ambiente, produção, o credenciamento e marque os ramos que a seguradora cota pela API.'] },
      { act: async (h) => { await h.click('Salvar e continuar', { wait: 1500 }); await h.step('Passo 6 · Configurar a API'); await h.type('Endereço base da API', 'https://api.seguradora-exemplo.com.br/apolven', { delay: 12 }); },
        say: ['Na etapa 3 fica a API de cotação. Cole a URL base, sempre com https.'] },
      { act: async (h) => { await h.select('Autenticação', 'OAuth2 (client credentials)'); await h.type('Endereço do token', 'https://api.seguradora-exemplo.com.br/oauth/token', { delay: 12 }); await h.type('Escopo', 'cotacao', { delay: 18 }); },
        say: ['Em Autenticação, escolha OAuth2 client credentials e informe a URL do token e o escopo.'] },
      { act: async (h) => { await h.type(h.page.locator('input[name="apv-api-client_id"]'), 'apolven-demo-01', { delay: 18 }); await h.type(h.page.locator('input[name="apv-api-client_secret"]'), 'sx-demo-8f3k-2025', { delay: 18 }); await h.spot(h.page.locator('input[name="apv-api-client_secret"]')); },
        say: ['Digite o Client ID e o Client Secret. O secret fica mascarado na tela.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.getByLabel('Tempo máximo de resposta (segundos)')); await h.type('Sua senha de acesso ao APOLVEN', h.password, { delay: 18 }); await h.click('Salvar API de cotação', { wait: 1500 }); },
        say: ['Defina o tempo máximo, confirme com a sua senha e salve. As credenciais vão cifradas e nunca mais voltam para a tela.'] },
      { act: async (h) => { await h.step('Passo 7 · Testar conexão'); await h.click(h.page.getByRole('button', { name: 'Testar conexão' }).last(), { wait: 2200 }); await h.spot(h.page.getByText('recusou as credenciais', { exact: false }).first()); },
        say: ['Clique em Testar conexão. Aqui, um erro comum: o servidor de autorização recusou as credenciais.',
          'Quase sempre é o secret digitado errado, de outro ambiente, ou já substituído no portal.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: /Credenciais e acesso/ }).first(), { wait: 1000 }); await h.type(h.page.locator('input[name="apv-api-client_id"]'), 'apolven-demo-01', { delay: 18 }); await h.type(h.page.locator('input[name="apv-api-client_secret"]'), 'sx-demo-8f3k-2026', { delay: 18 }); await h.type('Sua senha de acesso ao APOLVEN', h.password, { delay: 18 }); await h.click('Salvar alterações', { wait: 1500 }); },
        say: ['Para corrigir, volte à etapa 3, digite o secret correto e salve de novo.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Testar conexão' }).last(), { wait: 2200 }); await h.spot(h.page.getByText('Acesso autenticado', { exact: false }).first()); },
        say: ['Conexão aprovada: o token foi obtido, a API respondeu no padrão e a cotação automática foi ativada.'] },
      { act: async (h, st) => { await h.unspot(); await h.go(`/cotacoes/nova?client=${st.client.id}&branch=auto`); await h.step('Passo 8 · Cotar'); await h.click('Avançar'); },
        say: ['Vamos cotar. Em Nova cotação, escolha o cliente e o ramo, como de costume.'] },
      { act: async (h, st) => {
        await h.type('Marca / modelo', 'Hatch 1.0 Flex', { delay: 18 }); await h.type('Ano do modelo', '2024', { delay: 18 }); await h.select('Utilização', { value: 'particular' });
        await h.type('CEP de pernoite', '13025-000', { delay: 18 }); await h.type('Condutor principal', st.client.name, { delay: 12 }); await h.click('Avançar');
        await h.page.getByLabel(/^Casco/).check(); await h.page.getByLabel(/^RCF danos materiais/).check(); await h.page.getByLabel(/^RCF danos corporais/).check(); await h.sleep(500); await h.click('Avançar'); },
        say: ['Preencha os dados do risco e as coberturas desejadas.'] },
      { act: async (h) => { await h.spot(h.page.getByText('Seguradora Exemplo S.A.', { exact: true }).first()); },
        say: ['Na etapa 4, a Seguradora Exemplo já aparece como automática, ao lado das outras fontes: automáticas ou assistidas.'] },
      { act: async (h) => { await h.unspot(); await h.type('Base para compartilhar', 'pedido do cliente para cotação', { delay: 12 }); },
        say: ['Informe a base para compartilhar os dados, exigida pela LGPD, e envie.'] },
      { act: async (h) => { await h.click('Enviar cotação', { wait: 300 }); await h.step('Passo 9 · Resultados ao vivo'); },
        say: ['Na etapa 5, Resultados, cada seguradora aparece com a situação ao vivo: consultando, cotação recebida, valor indicativo, recusa ou erro.'] },
      { act: async (h) => { await h.sleep(800); await h.spot(h.page.locator('ul[aria-live] > li', { hasText: 'Seguradora Exemplo S.A.' })); },
        say: ['A Seguradora Exemplo respondeu pela API: a oferta entra na comparação na hora. As assistidas aparecem quando a equipe registrar.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.locator('ul[aria-live] > li', { hasText: 'Seguradora Exemplo S.A.' }).getByRole('button', { name: 'Dados enviados e resposta' }), { wait: 1200 }); },
        say: ['Em “Dados enviados e resposta” você vê quais dados foram para a seguradora e a resposta original. Só a equipe vê isso.'] },
      { act: async (h) => { await h.esc(); await h.click('Escolher a melhor opção', { wait: 1000 }); await h.click('Gerar link para enviar', { wait: 1500 }); },
        say: ['Escolha a melhor opção e gere o link do comparativo, pronto para enviar ao cliente pelo WhatsApp ou e-mail.'] },
      { act: async (h) => { await h.esc(); await h.go('/integracoes?tab=contrato'); await h.step('Passo 10 · Contrato da API'); await h.spot(h.page.getByText('Regras', { exact: true }).first()); },
        say: ['Por fim, a aba Contrato da API: é o que você envia à seguradora, ao parceiro ou ao integrador, com endereços, autenticação e regras.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(560); await h.spot(h.page.getByText('Schemas e exemplos', { exact: true }).first()); },
        say: ['Os JSON Schemas e os exemplos de requisição e resposta estão aqui, para copiar ou baixar.'] },
      { act: async (h) => { await h.unspot(); await h.step(''); await h.card(slide('Segurança e LGPD', 'O que o APOLVEN garante', list(['Somente endereços https públicos; redes internas e redirecionamentos são bloqueados', 'Credenciais cifradas no servidor, nunca exibidas de novo', 'Só os dados necessários para cotar: sem e-mail, telefone ou observações internas', 'Cada envio registrado: quais dados foram para qual seguradora, e quando']))); },
        say: ['Segurança: só https público, credenciais cifradas, apenas os dados necessários e cada envio na auditoria.',
          'Pronto: a sua seguradora com API já cota automaticamente.'] },
    ],
  },
  {
    n: 20, file: '20-produtos-e-documentos', mod: 'cadastros', title: 'Produtos, documentos e importações', routes: ['/produtos', '/documentos'], start: '/produtos',
    desc: 'Catálogo de produtos, documentos, importação de carteira e links.',
    learn: ['Cadastrar produtos e coberturas', 'Guardar documentos', 'Importar clientes e apólices'],
    steps: [
      { say: ['Em Planos, produtos e coberturas fica o catálogo de produtos de cada seguradora, por ramo e versão.'] },
      { act: (h) => h.click('Novo produto'), say: ['Cadastre o produto com o ramo, a vigência, as coberturas e as assistências. Os produtos aparecem nas fontes elegíveis de cada cotação.'] },
      { act: async (h) => { await h.esc(); await h.go('/documentos'); }, say: ['Em Documentos ficam todos os arquivos da corretora. O sistema confere o tipo real do arquivo e guarda as versões.'] },
      { act: (h) => h.click('Importações'), say: ['Em Importações, traga sua carteira atual de clientes e apólices por planilha CSV.', 'Antes de gravar, as linhas com erro são separadas para correção.'] },
      { act: (h) => h.click('Links temporários'), say: ['E em Links temporários você vê e revoga os links enviados aos clientes.'] },
    ],
  },
  {
    n: 21, file: '21-comunicacao', mod: 'cadastros', title: 'Comunicação com o cliente', routes: ['/comunicacao'], start: '/comunicacao',
    desc: 'Mensagens preparadas, modelos de WhatsApp e consentimento de marketing.',
    learn: ['Preparar mensagens', 'Modelos de WhatsApp', 'Regras de marketing'],
    steps: [
      { say: ['Em Comunicação ficam as mensagens enviadas aos clientes.'] },
      { act: (h) => h.click('Nova mensagem'), say: ['Escolha o cliente, o canal e a finalidade. A mensagem abre no seu WhatsApp ou e-mail, e o envio é feito pelo seu aparelho.'] },
      { act: async (h) => { await h.esc(); await h.spot('Modelos de WhatsApp'); }, say: ['Os modelos de WhatsApp agilizam lembretes de parcela, renovação e comparativo.'] },
      { act: (h) => h.unspot(), say: ['Mensagens de marketing só vão para quem autorizou e não pediu para sair. Tudo fica registrado no atendimento do cliente.'] },
    ],
  },

  // ───────────────────────── Gestão
  {
    n: 22, file: '22-relatorios-e-exportacao', mod: 'gestao', title: 'Relatórios e exportação de dados', routes: ['/relatorios'], start: '/relatorios',
    desc: 'Indicadores, produção por ramo e seguradora e exportações.',
    learn: ['Indicadores do período', 'Produção por ramo e seguradora', 'Exportar CSV e cópia completa'],
    steps: [
      { say: ['Relatórios e indicadores mostra a produção da corretora no período escolhido.'] },
      { act: (h) => h.spot('Produção por ramo e seguradora'), say: ['Veja apólices e prêmio intermediado por ramo e por seguradora.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(600); await h.spot('Exportações'); }, say: ['Em Exportações, baixe apólices, parcelas e comissões em CSV.', 'A cópia completa dos dados gera um arquivo com tudo da sua corretora. Os seus dados são seus.'] },
    ],
  },
  {
    n: 23, file: '23-auditoria-e-privacidade', mod: 'gestao', title: 'Auditoria e privacidade (LGPD)', routes: ['/auditoria', '/privacidade'], start: '/auditoria',
    desc: 'Trilha de auditoria, eventos de negócio e pedidos de titulares.',
    setup: async (api) => { const st = await flow(api, { upTo: 'proposal' }); await api('POST', `/v1/proposals/${st.proposal.id}/authorizations`, { via: 'whatsapp', authorized_by_name: 'Ana Beatriz Oliveira', evidence: 'Mensagem de WhatsApp autorizando a opção escolhida' }); await api('POST', `/v1/proposals/${st.proposal.id}/submit`, { protocol: 'PRT-552310', evidence: 'Enviada pelo portal da seguradora' }, { 'idempotency-key': `video-${Date.now()}` }); return st; },
    learn: ['Quem fez o quê e quando', 'Eventos de negócio', 'Solicitações da LGPD'],
    steps: [
      { say: ['A Auditoria registra quem fez o quê e quando: alterações, aprovações, downloads e acessos sensíveis.', 'Os registros não podem ser apagados nem alterados.'] },
      { act: (h) => h.click('Eventos de negócio'), say: ['Eventos de negócio mostram os marcos de cada processo, como cotação recebida, proposta transmitida e comissão liquidada.'] },
      { act: (h) => h.go('/privacidade'), say: ['Em Privacidade, registre os pedidos dos titulares de dados: acesso, correção, exportação, eliminação, revogação e informação.'] },
      { act: (h) => h.click('Nova solicitação'), say: ['Cada pedido tem prazo, responsável e resposta registrada. Dados que a lei obriga a guardar são mantidos, com a justificativa.'] },
      { act: (h) => h.esc() },
    ],
  },

  // ───────────────────────── Configurações
  {
    n: 24, file: '24-configuracoes-usuarios-e-perfis', mod: 'config', title: 'Configurações, usuários e perfis', routes: ['/configuracoes'], start: '/configuracoes',
    desc: 'Dados da corretora, unidades, usuários, perfis, regras e aparência.',
    learn: ['Dados e logotipo da corretora', 'Usuários e perfis de acesso', 'Regras de numeração, prazos e aprovações'],
    steps: [
      { say: ['Em Configurações da corretora ficam os dados que aparecem nos documentos: razão social, CNPJ, SUSEP, contatos e logotipo.'] },
      { act: (h) => h.click('Unidades'), say: ['Cadastre as unidades ou filiais da corretora.'] },
      { act: (h) => h.click('Usuários'), say: ['Em Usuários, cadastre a equipe e defina o perfil de cada pessoa. O sistema gera uma senha provisória para o primeiro acesso.'] },
      { act: (h) => h.click('Perfis de acesso'), say: ['Os perfis definem o que cada um pode ver e fazer. Um corretor pode ver só a própria carteira, por exemplo.'] },
      { act: (h) => h.click('Regras'), say: ['Em Regras: numeração dos documentos, prazos de renovação e de parcelas, pesos da pontuação e aprovações internas.'] },
      { act: (h) => h.click('Aparência'), say: ['E em Aparência, a cor e o estilo do sistema para toda a equipe.'] },
    ],
  },
  {
    n: 25, file: '25-suporte-e-treinamento', mod: 'config', title: 'Suporte e treinamento', routes: ['/suporte'], start: '/suporte',
    desc: 'Vídeo-aulas, transcrição, dúvidas frequentes e contato.',
    learn: ['Assistir às aulas', 'Ler a transcrição', 'Falar com o suporte'],
    steps: [
      { say: ['Em Suporte estão todas as vídeo-aulas do APOLVEN, organizadas por módulo, com o seu progresso.'] },
      { act: async (h) => { await h.click(h.page.locator('aside button', { hasText: 'Cadastro de clientes' }).first(), { wait: 1500 }); await h.sleep(3500); },
        say: ['Clique em uma aula para assistir. Todas têm narração e legenda, e ao terminar a próxima já fica pronta.'] },
      { act: async (h) => { await h.page.evaluate(() => document.querySelector('main video')?.pause()); await h.scroll(560); await h.spot('Transcrição'); },
        say: ['A transcrição acompanha o vídeo. Clique em uma frase para ir direto àquele ponto.'] },
      { act: async (h) => { await h.unspot(); await h.top(); await h.type(h.page.getByPlaceholder('Buscar aula'), 'comissão'); },
        say: ['Use a busca para encontrar a aula pelo assunto, inclusive pelo que é dito nela.'] },
      { act: async (h) => { await h.page.getByPlaceholder('Buscar aula').fill(''); await h.scroll(1400, 1400); },
        say: ['Abaixo ficam as perguntas frequentes, o fluxo de uma venda, os atalhos e o contato com o suporte.'] },
      { act: async (h) => { await h.top(); await h.go('/parcelas'); await h.spot(h.page.locator('header a[aria-label^="Ajuda"]').first()); },
        say: ['E em qualquer tela, o ponto de interrogação abre a aula daquele assunto.'] },
      { act: async (h) => { await h.click(h.page.locator('header a[aria-label^="Ajuda"]').first(), { wait: 1500 }); }, say: ['Bons estudos!'] },
    ],
  },
];
