// Templates de configuração (C.13) e adaptadores de fornecedor (27.4).
// Templates são schemas declarativos mantidos pela plataforma: o usuário nunca informa endpoint, cabeçalho ou
// protocolo, e nada vindo do formulário escolhe host de destino (A41). Requisitos vêm de documentação pública
// com fonte e data de verificação; nenhum endpoint, resposta, preço ou capacidade externa é inventado.
//
// Adaptadores reais só entram aqui depois de contrato, credenciais e homologação. Enquanto isso, o caminho
// fica "sem conector": a empresa pode ser cadastrada, o checklist acompanhado e a consulta segue ASSISTIDA.
//
// Exceção controlada: "API de cotação — padrão APOLVEN" (api_padrao_apolven). Aqui a corretora informa o endereço
// da API que a seguradora/parceiro disponibilizou seguindo o contrato público do APOLVEN (lib/quoteApi.js). O endereço
// é validado contra SSRF no cadastro e em cada chamada (lib/safeHttp.js); o caminho, o protocolo e o formato são fixos.

import { apolvenAdapter } from './apolvenApiAdapter.js';

export const CAPABILITIES = {
  cotacao: 'Incluir no multicálculo automático',
  proposta_status: 'Consultar situação de propostas',
  transmissao: 'Transmitir propostas autorizadas',
  documentos: 'Consultar documentos/apólices',
  parcelas: 'Atualizar parcelas e cobranças oficiais',
  extratos: 'Importar extratos de comissão',
  endosso_sinistro: 'Operar endossos/sinistros',
};

export const METHODS = {
  api_direta: 'API direta da seguradora',
  multicalculo_parceiro: 'Parceiro de multicálculo',
  open_insurance: 'Open Insurance',
  arquivo: 'Arquivos oficiais / importação',
  assistida: 'Operação assistida',
};

export const CONNECTOR_STATUS = {
  disponivel: 'Disponível / configurável',
  condicionado_contrato: 'Condicionado a contrato',
  em_homologacao: 'Em homologação',
  em_implementacao: 'Em implementação',
  indisponivel: 'Indisponível',
  operacao_assistida: 'Operação assistida',
};

const VERIFIED = '2026-10-03';
const req = (code, label, why, provided_by, resolved_by, blocks = [], extra = {}) => ({ code, label, why, provided_by, resolved_by, required: true, blocks, ...extra });
const REG = req('registro_susep', 'Registro da corretora ativo (SUSEP)', 'A operação exige cadastro ativo; consulte a situação e anexe a certidão.', 'corretora', 'responsavel_tecnico',
  ['cotacao', 'transmissao'], { link: 'https://www.gov.br/pt-br/servicos/consultar-corretores-susep' });
const CRED = (blocks = ['cotacao', 'transmissao', 'proposta_status', 'documentos', 'parcelas', 'extratos']) => req('credenciamento', 'Credenciamento comercial aprovado nesta empresa', 'Vínculo da corretora/filial/produtor com a instituição, códigos comerciais e produtos autorizados.', 'seguradora', 'contato_comercial', blocks);

export const TEMPLATES = [
  {
    code: 'porto_api', version: 1, institution_code: 'porto', method: 'api_direta', name: 'Porto — API direta', adapter: null,
    status: 'condicionado_contrato', products: ['auto', 'residencial', 'empresarial', 'vida', 'viagem', 'equipamentos'],
    sources: [{ ref: 'F5', title: 'Porto Seguro — Introdução ao Portal do Desenvolvedor', verified_at: VERIFIED }, { ref: 'F20', title: 'Porto — Autorização (Client ID/Client Secret, token gerado no servidor)', verified_at: VERIFIED }],
    help: 'A Porto exige cadastro no portal do desenvolvedor, aprovação do APP, autorização das APIs e ambiente de testes; a homologação pode exigir acordo de confidencialidade. A aplicação gera o token no servidor a partir do Client ID e Client Secret do APP aprovado.',
    credential_owner: 'definido em contrato (corretora ou parceiro aprovado)',
    fields: [
      { key: 'client_id', label: 'Client ID do APP aprovado', technical: 'client_id', secret: false, where: 'Portal do desenvolvedor Porto › seu APP aprovado' },
      { key: 'client_secret', label: 'Client Secret do APP aprovado', technical: 'client_secret', secret: true, where: 'Portal do desenvolvedor Porto › seu APP aprovado (não é a senha do portal do corretor)' },
    ],
    requirements: [REG, CRED(),
      req('app_aprovado', 'APP cadastrado e aprovado no portal do desenvolvedor', 'Sem APP aprovado não existem Client ID/Secret válidos.', 'seguradora', 'responsavel_tecnico', ['cotacao', 'transmissao', 'proposta_status', 'documentos', 'parcelas']),
      req('apis_liberadas', 'APIs/produtos liberados para o APP', 'Cada API é autorizada separadamente; cotação não implica emissão.', 'seguradora', 'contato_comercial', ['cotacao', 'transmissao']),
      req('nda', 'Acordo de confidencialidade para homologação', 'Pode ser exigido para acesso à homologação.', 'seguradora', 'administrador', [], { required: false }),
      req('producao', 'Liberação do ambiente de produção', 'Teste em sandbox não libera produção.', 'seguradora', 'responsavel_tecnico', ['cotacao', 'transmissao']),
    ],
    capabilities: ['cotacao', 'proposta_status', 'transmissao', 'documentos', 'parcelas'],
  },
  {
    code: 'tokio_api', version: 1, institution_code: 'tokio_marine', method: 'api_direta', name: 'Tokio Marine — integração', adapter: null,
    status: 'condicionado_contrato', products: ['auto', 'residencial'],
    sources: [{ ref: 'F6', title: 'Tokio Marine — Portal de Integrações e API', verified_at: VERIFIED }, { ref: 'F23', title: 'Tokio Marine — cadastro comercial (identificação, CPF/CNPJ, código SUSEP/IBRACOR, responsável)', verified_at: VERIFIED }],
    help: 'Primeiro o cadastro comercial; o formato técnico definitivo (tipo de autenticação e campos) depende da documentação liberada após a aprovação. Nenhum campo de API foi inventado aqui.',
    credential_owner: 'a confirmar na documentação liberada',
    fields: [],
    requirements: [REG, CRED(), req('cadastro_comercial', 'Cadastro comercial na Tokio Marine', 'Solicita identificação, CPF/CNPJ, código SUSEP/IBRACOR e dados do responsável.', 'corretora', 'administrador', ['cotacao']),
      req('documentacao_tecnica', 'Documentação técnica liberada', 'Define autenticação, produtos e aprovação técnica.', 'seguradora', 'responsavel_tecnico', ['cotacao', 'transmissao'])],
    capabilities: ['cotacao', 'transmissao'],
  },
  {
    code: 'bradesco_re_api', version: 1, institution_code: 'bradesco_seguros', method: 'api_direta', name: 'Bradesco Seguros — API empresarial (RE)', adapter: null,
    status: 'condicionado_contrato', products: ['empresarial'],
    sources: [{ ref: 'F7', title: 'Bradesco Seguros — APIs para Seguro Empresarial', verified_at: VERIFIED }, { ref: 'F21', title: 'Solicitação de credenciais (client-id/client secret) por interlocução comercial/TI', verified_at: VERIFIED }, { ref: 'F22', title: 'mTLS com certificado de produção ICP-Brasil A1 na integração consultada', verified_at: VERIFIED }],
    help: 'Credenciais solicitadas via interlocução comercial/TI. A documentação consultada desta integração prevê mTLS com certificado ICP-Brasil A1 de produção — requisito deste produto, não de toda seguradora.',
    credential_owner: 'corretora (confirmar titular do certificado em contrato)',
    fields: [
      { key: 'client_id', label: 'client-id', technical: 'client_id', secret: false, where: 'Fornecido pela interlocução comercial/TI do Bradesco' },
      { key: 'client_secret', label: 'client secret', technical: 'client_secret', secret: true, where: 'Fornecido pela interlocução comercial/TI do Bradesco' },
      { key: 'certificate_ref', label: 'Certificado A1 (referência do cofre)', technical: 'mTLS', secret: true, where: 'Certificado ICP-Brasil A1 registrado no fornecedor; a chave privada nunca é enviada por e-mail' },
    ],
    requirements: [REG, CRED(), req('credenciais_solicitadas', 'Credenciais solicitadas e recebidas', 'Par client-id/client secret fornecido pelo Bradesco.', 'seguradora', 'contato_comercial', ['cotacao', 'transmissao']),
      req('certificado_mtls', 'Certificado A1 registrado no fornecedor', 'Exigido pela documentação consultada para este produto.', 'corretora', 'responsavel_tecnico', ['cotacao', 'transmissao'])],
    capabilities: ['cotacao', 'transmissao', 'proposta_status', 'parcelas', 'endosso_sinistro'],
  },
  {
    code: 'bb_brasilseg_api', version: 1, institution_code: 'bb_brasilseg', method: 'api_direta', name: 'BB / Brasilseg — API de Seguros', adapter: null,
    status: 'condicionado_contrato', products: ['residencial', 'vida', 'empresarial'],
    sources: [{ ref: 'F8', title: 'Banco do Brasil — API de Seguros (cadastro/parceria, conta BB, contrato/cadastro ativo com a Brasilseg)', verified_at: VERIFIED }],
    help: 'Exige condições de parceria: cadastro, conta comercial no BB quando aplicável e contrato/cadastro ativo com a Brasilseg. Não é uma API pública irrestrita.',
    credential_owner: 'parceiro da jornada', fields: [],
    requirements: [REG, CRED(), req('parceria', 'Parceria/cadastro aprovado', 'Condição comercial da API.', 'seguradora', 'contato_comercial', ['cotacao']),
      req('conta_bb', 'Conta comercial BB (quando exigida pela jornada)', 'Requisito do parceiro desta jornada.', 'corretora', 'administrador', ['cotacao'], { required: false })],
    capabilities: ['cotacao'],
  },
  {
    code: 'multicalculo_parceiro', version: 1, institution_code: null, method: 'multicalculo_parceiro', name: 'Parceiro de multicálculo contratado', adapter: null,
    status: 'condicionado_contrato', products: ['auto', 'residencial', 'empresarial', 'vida'],
    sources: [{ ref: 'F1-F4', title: 'Fornecedores de multicálculo (TEx, Quiver, Agger, Segfy)', verified_at: VERIFIED }],
    help: 'Amplia a cobertura com um único contrato, se o parceiro oferecer API/SDK com licença para integração externa, uso por várias corretoras e condições por corretora. Uma assinatura comum não comprova direito a API. Cada companhia ainda precisa do seu vínculo.',
    credential_owner: 'definido em contrato com o parceiro', fields: [],
    requirements: [REG, req('contrato_parceiro', 'Contrato com licença de integração externa', 'Plataforma comum não basta: confirmar API/SDK, direitos de uso e cobrança.', 'parceiro', 'administrador', ['cotacao', 'transmissao']),
      req('vinculo_companhias', 'Vínculo de cada companhia no parceiro', 'Requisitos variam por companhia.', 'parceiro', 'contato_comercial', ['cotacao'])],
    capabilities: ['cotacao', 'transmissao'],
  },
  {
    code: 'api_padrao_apolven', version: 1, institution_code: null, method: 'api_direta', name: 'API de cotação — padrão APOLVEN', adapter: 'padrao_apolven',
    status: 'disponivel', products: [], sources: [], self_service: true, api_config: true,
    help: 'Para quando a seguradora, um parceiro de multicálculo ou um middleware oferecer uma API que siga o contrato público "padrão APOLVEN" (Seguradoras e Integrações › Contrato da API). Você informa o endereço https, a autenticação e as credenciais; o APOLVEN testa a conexão e, em produção e com credenciamento confirmado, passa a consultar essa seguradora automaticamente.',
    credential_owner: 'corretora (ou parceiro, conforme o contrato com a seguradora)', fields: [], requirements: [],
    capabilities: ['cotacao'],
  },
  {
    code: 'open_insurance', version: 1, institution_code: null, method: 'open_insurance', name: 'Open Insurance (participante/parceiro habilitado)', adapter: null,
    status: 'indisponivel', products: [],
    sources: [{ ref: 'F9', title: 'SUSEP — Open Insurance', verified_at: VERIFIED }],
    help: 'Compartilhamento consentido entre participantes autorizados/credenciados. Depende da modalidade de participação, escopo, certificados e homologação. Consentimento do CRM não substitui o consentimento Open Insurance.',
    credential_owner: 'participante habilitado', fields: [], requirements: [req('participacao', 'Modalidade de participação definida', 'Sem participação/parceiro habilitado não há jornada.', 'plataforma', 'suporte', ['cotacao'])],
    capabilities: [],
  },
  {
    code: 'arquivos_oficiais', version: 1, institution_code: null, method: 'arquivo', name: 'Arquivos oficiais (extratos/planilhas)', adapter: 'arquivo',
    status: 'disponivel', products: [],
    sources: [],
    help: 'Importação de arquivos formalmente recebidos da seguradora (extratos de comissão). Opera por importação com origem; não finge consulta em tempo real.',
    credential_owner: 'não se aplica', fields: [], requirements: [],
    capabilities: ['extratos'],
  },
  {
    code: 'assistida', version: 1, institution_code: null, method: 'assistida', name: 'Operação assistida', adapter: 'assistida',
    status: 'operacao_assistida', products: [],
    sources: [],
    help: 'Cadastro comercial com consulta assistida: a equipe solicita a cotação pelo canal oficial da seguradora e registra a resposta formal com origem e validade. Não pede segredo de API.',
    credential_owner: 'não se aplica', fields: [], requirements: [CRED(['cotacao'])],
    capabilities: [],
  },
];

// Adaptador interno de testes (só com APOLVEN_TEST_ADAPTERS=1 — nunca na publicação): exercita autenticação,
// vínculo, capacidades e multicálculo automático nos testes ponta a ponta. Os dados são de teste e identificados.
if (globalThis.process?.env?.APOLVEN_TEST_ADAPTERS === '1') {
  TEMPLATES.push({
    code: 'teste_interno', version: 1, institution_code: null, method: 'api_direta', name: 'Conector de teste interno', adapter: 'teste_interno',
    status: 'em_homologacao', products: ['auto', 'residencial'], sources: [], help: 'Somente ambiente de testes automatizados.',
    credential_owner: 'corretora',
    fields: [
      { key: 'client_id', label: 'Client ID', technical: 'client_id', secret: false, where: 'teste' },
      { key: 'client_secret', label: 'Client Secret', technical: 'client_secret', secret: true, where: 'teste' },
    ],
    requirements: [CRED(['cotacao', 'transmissao'])],
    capabilities: ['cotacao', 'transmissao', 'proposta_status'],
    allowed_hosts: ['teste.invalid'],
  });
}

export const templateBy = (code) => TEMPLATES.find((t) => t.code === code) || null;

/** Visão pública do template (sem nada sensível — templates não têm segredos). */
export const publicTemplate = (t) => t && ({
  code: t.code, version: t.version, institution_code: t.institution_code, method: t.method, method_label: METHODS[t.method], name: t.name,
  adapter_available: hasAutomaticAdapter(t), api_config: !!t.api_config, self_service: !!t.self_service, status: t.status, status_label: CONNECTOR_STATUS[t.status], products: t.products, sources: t.sources,
  help: t.help, credential_owner: t.credential_owner, fields: t.fields.map(({ key, label, technical, secret, where }) => ({ key, label, technical, secret, where })),
  requirements: t.requirements, capabilities: t.capabilities.map((c) => ({ code: c, label: CAPABILITIES[c] })),
});

// ---------------- Adaptadores ----------------
// Contrato (27.4): operação não suportada devolve UNSUPPORTED_CAPABILITY — nunca sucesso fictício.
const unsupported = () => ({ ok: false, code: 'UNSUPPORTED_CAPABILITY' });

const ADAPTERS = {
  assistida: { testConnection: async () => ({ code: 'CONNECTOR_NOT_AVAILABLE' }), quote: unsupported, submitProposal: unsupported },
  arquivo: { testConnection: async () => ({ code: 'CONNECTOR_NOT_AVAILABLE' }), quote: unsupported, submitProposal: unsupported },
  padrao_apolven: apolvenAdapter,
  teste_interno: {
    // decide pelo client_id para cobrir os casos A33/A35/A38 sem rede
    async testConnection({ credentials, connection, environment }) {
      const id = String(credentials.client_id || '');
      if (id.includes('invalido')) return { auth: 'invalida', code: 'AUTHENTICATION_REJECTED' };
      if (id.includes('fora')) return { auth: 'indisponivel', code: 'PROVIDER_TEMPORARILY_UNAVAILABLE' };
      const brokerCode = id.includes('divergente') ? 'XYZ-999' : connection.broker_code;
      return {
        auth: 'valida', environment, broker_code: brokerCode,
        capabilities: {
          cotacao: id.includes('semcotacao') ? 'nao_autorizada' : 'autorizada',
          transmissao: id.includes('comtransmissao') ? 'autorizada' : 'nao_autorizada',
          proposta_status: 'nao_verificada',
        },
        limitations: ['Conector de teste: nenhum dado real é consultado.'],
      };
    },
    async quote({ round, task, connection }) {
      if (connection?.broker_code === 'FALHA') return { ok: false, status: 'fonte_indisponivel', reason: 'Falha técnica no teste (não é recusa)' };
      return {
        ok: true, status: 'cotacao_valida',
        offer: {
          product_name: 'Produto de teste', external_id: `T-${task.id.slice(0, 8)}`, quote_kind: 'cotacao_valida', origin: 'api',
          valid_until: null, total_premium_cents: 250000, premium_net_cents: 232000, taxes_cents: 18000,
          coverages: (round.min_coverages || []).map((m) => ({ code: m.code, name: m.name, limit_cents: m.min_limit_cents ?? 5000000, deductible_cents: 300000 })),
          payment_options: [{ id: 'av', method: 'boleto', installments: 1, first_cents: 250000, installment_cents: 250000, total_cents: 250000 }],
          fields_definition: 'Teste interno: total = líquido + IOF', commission_source: 'nao_informada',
        },
      };
    },
    submitProposal: unsupported,
  },
};
export const adapterFor = (t) => (t?.adapter ? ADAPTERS[t.adapter] || null : null);
/** Adaptador com integração automática real (não assistida/arquivo). */
export const hasAutomaticAdapter = (t) => !!t?.adapter && !['assistida', 'arquivo'].includes(t.adapter) && !!ADAPTERS[t.adapter];

/** Mensagens de erro e próximo passo (C.17). */
export const ERROR_MESSAGES = {
  CONNECTOR_NOT_AVAILABLE: ['Esta empresa ainda não possui integração automática disponível neste sistema.', 'Usar consulta assistida ou solicitar avaliação'],
  ACCREDITATION_PENDING: ['Falta confirmar seu credenciamento para este produto.', 'Consultar a empresa e registrar evidência'],
  CREDENTIAL_MISSING: ['Preencha o dado de acesso indicado para continuar.', 'Veja a orientação do campo'],
  AUTHENTICATION_REJECTED: ['O fornecedor não aceitou os dados de acesso.', 'Conferir ambiente, validade e credenciais'],
  ACCESS_NOT_AUTHORIZED: ['O acesso foi reconhecido, mas esta operação não está autorizada.', 'Solicitar liberação do produto/operação'],
  BROKER_IDENTITY_MISMATCH: ['A identificação retornada não corresponde ao vínculo informado.', 'Revisar unidade e código comercial'],
  CERTIFICATE_ACTION_REQUIRED: ['O certificado precisa ser validado ou atualizado.', 'Ajuda técnica com motivo não secreto'],
  TEST_ONLY_CONNECTION: ['A conexão está validada somente no ambiente de testes.', 'Obter liberação e validar produção'],
  PROVIDER_TEMPORARILY_UNAVAILABLE: ['O fornecedor está indisponível no momento.', 'Repetir com limite ou acompanhar'],
  CAPABILITY_UNVERIFIED: ['Não foi possível confirmar esta função automaticamente.', 'Anexar aprovação e concluir homologação'],
};
