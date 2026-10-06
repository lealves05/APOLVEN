// Glossário em linguagem simples para termos de seguro (usado nas dicas "?" — principalmente no link do cliente).

export const TERMS = {
  premio: ['Prêmio', 'É o preço do seguro: o valor total que você paga à seguradora pela vigência (normalmente 1 ano).'],
  premio_liquido: ['Prêmio líquido', 'O preço do seguro sem os impostos. Somado ao IOF (e a eventuais custos) dá o prêmio total.'],
  iof: ['IOF', 'Imposto federal cobrado sobre o seguro. Já está incluído no prêmio total.'],
  franquia: ['Franquia', 'A parte do prejuízo que fica por sua conta em caso de sinistro. Ex.: franquia de R$ 3.000 num conserto de R$ 10.000 → a seguradora paga R$ 7.000.'],
  limite: ['Limite', 'O valor máximo que a seguradora paga por aquela cobertura.'],
  vigencia: ['Vigência', 'O período em que o seguro está valendo (data de início e de fim).'],
  cobertura: ['Cobertura', 'O tipo de prejuízo que o seguro paga (ex.: batida, roubo, danos a terceiros).'],
  assistencia: ['Assistência', 'Serviços de apoio incluídos no seguro, como guincho, chaveiro ou socorro mecânico.'],
  valor_indicativo: ['Valor indicativo', 'Uma estimativa de preço. A seguradora ainda precisa confirmar antes de ser possível contratar esta opção.'],
  cotacao_valida: ['Cotação válida', 'Preço formal informado pela seguradora, válido até a data indicada.'],
  classificacao: ['Comparação com o que você pediu', '“Atende ao mínimo” = tem todas as coberturas que você pediu. “Parcialmente equivalente” = falta alguma ou um valor não foi informado — veja os avisos logo abaixo.'],
  validade: ['Validade da cotação', 'Depois desta data o preço pode mudar e a corretora precisa cotar de novo.'],
  sinistro: ['Sinistro', 'O acontecimento coberto pelo seguro (batida, roubo, incêndio…) que gera o pedido de indenização.'],
  apolice: ['Apólice', 'O documento do seguro emitido pela seguradora, com coberturas, valores e vigência.'],
  proposta: ['Proposta', 'O pedido formal de contratação enviado à seguradora, com a opção que você escolheu.'],
  endosso: ['Endosso', 'Uma alteração feita na apólice durante a vigência (troca de veículo, endereço, inclusão de condutor…).'],
  comissao: ['Comissão', 'A remuneração da corretora paga pela seguradora. Não é somada ao preço que o cliente vê.'],
  subscricao: ['Análise de subscrição', 'A seguradora está avaliando o risco antes de dar o preço ou aceitar a proposta.'],
};

/** Coberturas comuns por código (catálogo do backend). */
export const COVERAGE_TERMS = {
  casco: 'Danos ao seu próprio veículo: batida, incêndio, roubo e furto.',
  rcf_dm: 'RCF = Responsabilidade Civil Facultativa. Paga os danos que você causar ao carro ou aos bens de outras pessoas.',
  rcf_dc: 'RCF = Responsabilidade Civil Facultativa. Paga despesas por ferimentos ou morte que você causar a outras pessoas.',
  rcf_morais: 'Paga indenização por danos morais a terceiros, quando você for responsável.',
  app: 'APP = Acidentes Pessoais de Passageiros. Indenização para quem está no veículo em caso de acidente.',
  vidros: 'Conserto ou troca de vidros, faróis, lanternas e retrovisores.',
  carro_reserva: 'Um carro emprestado enquanto o seu está na oficina por sinistro coberto.',
  assist_24h: 'Socorro 24 horas: guincho, chaveiro, pane seca, troca de pneu.',
  incendio: 'Danos causados por fogo, raio ou explosão no imóvel.',
  danos_eletricos: 'Queima de aparelhos e instalações por variação de energia ou raio.',
  roubo: 'Roubo ou furto com sinais de arrombamento.',
  vendaval: 'Danos por ventos fortes, granizo, furacão.',
  rc_familiar: 'Paga danos que você ou sua família causarem a outras pessoas no dia a dia.',
  perda_aluguel: 'Paga o aluguel se o imóvel ficar inabitável por um sinistro coberto.',
  morte: 'Indenização aos beneficiários em caso de morte do segurado.',
  ipa: 'Indenização se um acidente causar invalidez permanente.',
  dmh: 'Despesas médicas e hospitalares durante a viagem.',
  bagagem: 'Indenização se a bagagem for extraviada pela companhia.',
};

export const term = (k) => TERMS[k] || null;
