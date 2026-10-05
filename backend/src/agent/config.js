// Agente do WhatsApp: rotinas automáticas, modelos sugeridos (para aprovar na Meta) e configuração padrão.
// Fora da janela de 24 h aberta pelo cliente, a Meta só aceita MODELOS aprovados: cada rotina tem um modelo
// com a ordem exata das variáveis ({{1}}, {{2}}...). O texto livre equivalente é usado na prévia, no histórico
// e quando a janela de 24 h está aberta.

/** Rotinas para clientes. `consent`: finalidade exigida (consentimento ativo); `params`: ordem das variáveis do modelo. */
export const CLIENT_ROUTINES = {
  parcela_a_vencer: {
    label: 'Parcela a vencer', category: 'UTILITY', consent: 'whatsapp',
    help: 'Lembra o cliente da parcela do seguro alguns dias antes do vencimento, com o link para ver as parcelas e enviar o comprovante.',
    params: ['cliente', 'parcela', 'seguradora', 'vencimento', 'valor', 'link'],
    text: 'Olá {cliente}! A parcela {parcela} do seu seguro {seguradora} vence em {vencimento}, no valor de {valor}. Para ver as parcelas ou enviar o comprovante: {link}. Se já pagou, desconsidere.',
    defaults: { enabled: false, days: [3], template: 'apolven_parcela_a_vencer' },
  },
  parcela_vencida: {
    label: 'Parcela vencida', category: 'UTILITY', consent: 'whatsapp',
    help: 'Avisa que a parcela consta em aberto depois do vencimento (o pagamento informado continua em conferência até a confirmação da seguradora).',
    params: ['cliente', 'parcela', 'seguradora', 'vencimento', 'valor', 'link'],
    text: 'Olá {cliente}! Não localizamos ainda o pagamento da parcela {parcela} do seu seguro {seguradora}, vencida em {vencimento} ({valor}). Atraso pode suspender a cobertura. Se já pagou, envie o comprovante pelo link {link} e desconsidere este aviso.',
    defaults: { enabled: false, days: [1, 7], template: 'apolven_parcela_vencida' },
  },
  renovacao: {
    label: 'Renovação do seguro', category: 'UTILITY', consent: 'whatsapp',
    help: 'Avisa o cliente que o seguro está perto de vencer e convida a revisar as coberturas para a renovação.',
    params: ['cliente', 'ramo', 'seguradora', 'vencimento', 'corretora'],
    text: 'Olá {cliente}! Seu seguro {ramo} com a {seguradora} vence em {vencimento}. Vamos revisar as coberturas e preparar a renovação? Responda esta mensagem que a {corretora} cuida de tudo.',
    defaults: { enabled: false, days: [30, 15], template: 'apolven_renovacao' },
  },
  cotacao_vencendo: {
    label: 'Cotação perto de vencer', category: 'UTILITY', consent: 'whatsapp',
    help: 'Para comparativos enviados e ainda sem escolha: avisa que os valores perdem a validade e reenvia o link do comparativo.',
    params: ['cliente', 'ramo', 'validade', 'link'],
    text: 'Olá {cliente}! As opções do comparativo do seu seguro {ramo} valem até {validade}. Para conferir e escolher, acesse {link} e, se tiver dúvidas, responda esta mensagem.',
    defaults: { enabled: false, days: [2], template: 'apolven_cotacao_vencendo' },
  },
  aniversario: {
    label: 'Aniversário', category: 'MARKETING', consent: 'marketing',
    help: 'Mensagem de parabéns no aniversário do cliente (exige autorização de marketing e respeita o pedido de não receber).',
    params: ['cliente', 'corretora'],
    text: 'Feliz aniversário, {cliente}! A equipe da {corretora} deseja um ótimo dia. Conte sempre com a gente.',
    defaults: { enabled: false, days: [0], template: 'apolven_aniversario' },
  },
};

/** Lembretes da equipe (viram tarefas na Agenda e um resumo diário no WhatsApp de quem pediu). */
export const TEAM_ITEMS = {
  renovacoes: { label: 'Renovações a iniciar (apólices vencendo nos marcos de alerta)' },
  parcelas: { label: 'Parcelas do seguro vencidas' },
  cotacoes: { label: 'Cotações perto de vencer sem proposta' },
  assistidas: { label: 'Consultas assistidas sem resposta da seguradora' },
  comparativos: { label: 'Comparativos enviados sem escolha do cliente' },
  propostas: { label: 'Propostas transmitidas sem retorno da seguradora' },
  documentos: { label: 'Apólices com documento a conferir' },
};

export const TEAM_TEMPLATE = {
  name: 'apolven_lembretes_equipe', category: 'UTILITY', params: ['nome', 'corretora', 'resumo'],
  text: 'Bom dia, {nome}! Seus lembretes de hoje na {corretora}: {resumo}. Abra o APOLVEN para ver os detalhes.',
};

export const DEFAULT_AGENT_SETTINGS = {
  sendHour: 9,                 // rotinas rodam a partir desta hora (fuso da corretora)
  windowStart: 8, windowEnd: 20, // nunca envia a clientes fora deste intervalo
  weekends: false,             // sábado e domingo sem avisos automáticos
  maxPerRun: 150,
  templateLang: 'pt_BR',
  autoReply: true,             // menu de autoatendimento nas mensagens recebidas
  routines: Object.fromEntries(Object.entries(CLIENT_ROUTINES).map(([k, r]) => [k, { ...r.defaults }])),
  team: {
    enabled: true, hour: 8, tasks: true, whatsapp: true, template: TEAM_TEMPLATE.name,
    items: Object.fromEntries(Object.keys(TEAM_ITEMS).map((k) => [k, true])),
    staleDays: { assistidas: 1, comparativos: 2, propostas: 5 },
  },
  texts: {
    menu: 'Olá{nome_virgula}! Aqui é o atendimento automático da {corretora}. Responda com o número da opção:\n1 - Minhas apólices\n2 - Parcelas e comprovantes\n3 - Sinistro ou assistência 24h\n4 - Renovação ou nova cotação\n5 - Falar com um corretor\n\nPara não receber mais avisos automáticos, responda SAIR.',
    handoff: 'Certo! Já avisei a equipe da {corretora}. Um corretor vai continuar o atendimento por aqui, em horário comercial.',
    optout: 'Pronto: você não vai mais receber avisos automáticos da {corretora} por aqui. Se precisar, é só mandar uma mensagem.',
  },
};

const clampHour = (h, d) => (Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 23 ? Number(h) : d);

/** Configuração completa (padrões + o que a corretora salvou). */
export function agentSettings(saved = {}) {
  const d = DEFAULT_AGENT_SETTINGS;
  const s = saved || {};
  return {
    ...d, ...s,
    sendHour: clampHour(s.sendHour, d.sendHour), windowStart: clampHour(s.windowStart, d.windowStart), windowEnd: Number.isInteger(Number(s.windowEnd)) && Number(s.windowEnd) >= 1 && Number(s.windowEnd) <= 24 ? Number(s.windowEnd) : d.windowEnd,
    routines: Object.fromEntries(Object.keys(CLIENT_ROUTINES).map((k) => [k, { ...d.routines[k], ...(s.routines?.[k] || {}) }])),
    team: { ...d.team, ...(s.team || {}), items: { ...d.team.items, ...(s.team?.items || {}) }, staleDays: { ...d.team.staleDays, ...(s.team?.staleDays || {}) } },
    texts: { ...d.texts, ...(s.texts || {}) },
  };
}

/** Substitui {chave} pelo valor (chave ausente fica vazia). */
export const render = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));

/** Modelos sugeridos para cadastrar no Gerenciador do WhatsApp (corpo com {{n}} na ordem dos parâmetros). */
export function suggestedTemplates() {
  const toMeta = (text, params) => params.reduce((t, p, i) => t.replaceAll(`{${p}}`, `{{${i + 1}}}`), text);
  return [
    ...Object.entries(CLIENT_ROUTINES).map(([key, r]) => ({ routine: key, label: r.label, name: r.defaults.template, category: r.category, language: 'pt_BR',
      body: toMeta(r.text, r.params), variables: r.params })),
    { routine: 'equipe', label: 'Lembretes da equipe', name: TEAM_TEMPLATE.name, category: TEAM_TEMPLATE.category, language: 'pt_BR',
      body: toMeta(TEAM_TEMPLATE.text, TEAM_TEMPLATE.params), variables: TEAM_TEMPLATE.params },
  ];
}
