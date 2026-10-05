// Formulários de risco versionados por ramo (28.3). Campos fundamentais tipados e validados; respostas
// desconhecidas ficam nulas — nunca preenchidas com um valor que facilite a aceitação do risco (8.1-4).
// Questionários clínicos NÃO ficam aqui (área restrita / documento restrito).
import { BRANCHES, bad } from '../util.js';

const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

const COMMON_VALUE = [f('valor_em_risco_cents', 'Valor em risco / importância segurada', 'money')];

export const RISK_SCHEMAS = {
  auto: { version: 'auto-1', fields: [
    f('placa', 'Placa', 'text', { required: false }), f('marca_modelo', 'Marca / modelo', 'text', { required: true }),
    f('ano_modelo', 'Ano do modelo', 'number', { required: true, min: 1950, max: 2100 }), f('chassi', 'Chassi'),
    f('uso', 'Utilização', 'select', { required: true, options: ['particular', 'comercial', 'aplicativo', 'taxi', 'locadora'] }),
    f('cep_pernoite', 'CEP de pernoite', 'text', { required: true, pattern: '^\\d{5}-?\\d{3}$' }),
    f('cep_circulacao', 'CEP de circulação'),
    f('condutor_principal', 'Condutor principal', 'text', { required: true }), f('idade_condutor', 'Idade do condutor', 'number', { min: 16, max: 110 }),
    f('condutores_18_25', 'Há condutor de 18 a 25 anos?', 'boolean'), f('classe_bonus', 'Classe de bônus declarada', 'number', { min: 0, max: 10 }),
    f('sinistros_12m', 'Sinistros nos últimos 12 meses (declarado)', 'number', { min: 0, max: 20 }), f('garagem', 'Garagem na residência/trabalho', 'select', { options: ['ambos', 'residencia', 'trabalho', 'nenhum'] }),
  ] },
  frota: { version: 'frota-1', fields: [f('quantidade_veiculos', 'Quantidade de veículos', 'number', { required: true, min: 2 }), f('lista_versionada', 'Referência da lista de veículos (documento)', 'text', { required: true }), f('utilizacao', 'Utilização predominante', 'text')] },
  residencial: { version: 'residencial-1', fields: [
    f('cep', 'CEP do imóvel', 'text', { required: true, pattern: '^\\d{5}-?\\d{3}$' }), f('tipo_imovel', 'Tipo', 'select', { required: true, options: ['casa', 'apartamento', 'casa_condominio'] }),
    f('ocupacao', 'Ocupação', 'select', { required: true, options: ['habitual', 'veraneio', 'desocupado'] }), f('construcao', 'Construção', 'select', { options: ['alvenaria', 'madeira', 'mista'] }),
    ...COMMON_VALUE] },
  condominio: { version: 'condominio-1', fields: [f('cep', 'CEP', 'text', { required: true }), f('unidades', 'Unidades', 'number', { required: true, min: 1 }), f('area_construida', 'Área construída (m²)', 'number'), f('responsavel', 'Síndico/responsável', 'text'), ...COMMON_VALUE] },
  empresarial: { version: 'empresarial-1', fields: [f('atividade', 'Atividade (CNAE/descrição)', 'text', { required: true }), f('cep', 'CEP do local', 'text', { required: true }), f('valor_predio_cents', 'Prédio', 'money'), f('valor_conteudo_cents', 'Conteúdo/estoque/máquinas', 'money'), f('protecoes', 'Proteções declaradas', 'text')] },
  vida: { version: 'vida-1', fields: [f('data_nascimento', 'Data de nascimento', 'date', { required: true }), f('ocupacao', 'Ocupação', 'text', { required: true }), f('capital_cents', 'Capital segurado', 'money', { required: true }), f('beneficiarios', 'Beneficiários (referência)', 'text')] },
  vida_grupo: { version: 'vida_grupo-1', fields: [f('estipulante', 'Estipulante', 'text', { required: true }), f('vidas', 'Número de vidas', 'number', { required: true, min: 1 }), f('capital_cents', 'Capital por vida', 'money'), f('elegibilidade', 'Critério de elegibilidade', 'text')] },
  saude: { version: 'saude-1', sensitive: true, fields: [f('modalidade', 'Contratação', 'select', { required: true, options: ['individual', 'familiar', 'pme', 'adesao', 'empresarial'] }), f('municipio', 'Município', 'text', { required: true }), f('idades_vidas', 'Idades das vidas (separadas por vírgula)', 'text', { required: true }), f('acomodacao', 'Acomodação', 'select', { options: ['enfermaria', 'apartamento'] }), f('coparticipacao', 'Aceita coparticipação', 'boolean'), f('abrangencia', 'Abrangência', 'select', { options: ['municipal', 'regional', 'estadual', 'nacional'] })] },
  odonto: { version: 'odonto-1', fields: [f('modalidade', 'Contratação', 'select', { required: true, options: ['individual', 'familiar', 'pme', 'empresarial'] }), f('vidas', 'Número de vidas', 'number', { required: true, min: 1 }), f('municipio', 'Município', 'text')] },
  viagem: { version: 'viagem-1', fields: [f('destino', 'Destino', 'text', { required: true }), f('ida', 'Ida', 'date', { required: true }), f('volta', 'Volta', 'date', { required: true }), f('viajantes', 'Viajantes', 'number', { required: true, min: 1 }), f('idades', 'Idades dos viajantes', 'text')] },
  rc: { version: 'rc-1', fields: [f('atividade', 'Atividade', 'text', { required: true }), f('faturamento_cents', 'Faturamento anual', 'money'), f('limite_cents', 'Limite pretendido', 'money', { required: true }), f('claims_made', 'Base de reclamação (claims made)', 'boolean'), f('retroatividade', 'Retroatividade pretendida', 'text')] },
  do_cyber: { version: 'do_cyber-1', fields: [f('estrutura', 'Estrutura empresarial', 'text', { required: true }), f('limite_cents', 'Limite pretendido', 'money', { required: true }), f('questionario_ref', 'Questionário próprio (documento)', 'text')] },
  equipamentos: { version: 'equipamentos-1', fields: [f('bem', 'Bem', 'text', { required: true }), f('modelo', 'Modelo', 'text'), f('identificacao', 'Nº de série / identificação', 'text'), f('uso', 'Uso', 'text'), ...COMMON_VALUE] },
  rural: { version: 'rural-1', fields: [f('atividade', 'Atividade/cultura', 'text', { required: true }), f('municipio', 'Município', 'text', { required: true }), f('area_ha', 'Área (ha)', 'number'), f('safra', 'Safra', 'text'), ...COMMON_VALUE] },
  transportes: { version: 'transportes-1', fields: [f('operacao', 'Operação', 'text', { required: true }), f('mercadoria', 'Mercadoria', 'text', { required: true }), f('trajetos', 'Trajetos', 'text'), f('limite_cents', 'Limite por embarque', 'money')] },
  garantia: { version: 'garantia-1', fields: [f('tomador', 'Tomador', 'text', { required: true }), f('obrigacao', 'Obrigação garantida', 'text', { required: true }), f('beneficiario', 'Beneficiário', 'text'), f('valor_garantia_cents', 'Valor da garantia', 'money', { required: true })] },
  fianca: { version: 'fianca-1', fields: [f('imovel', 'Imóvel (endereço/CEP)', 'text', { required: true }), f('aluguel_cents', 'Aluguel mensal', 'money', { required: true }), f('locatario', 'Locatário', 'text', { required: true }), f('locador', 'Locador', 'text')] },
  previdencia: { version: 'previdencia-1', fields: [f('produto', 'Produto (PGBL/VGBL)', 'select', { required: true, options: ['PGBL', 'VGBL'] }), f('contribuicao_cents', 'Contribuição mensal', 'money'), f('regime', 'Regime tributário informado pelo fornecedor', 'text')] },
};

/** Coberturas de referência por ramo (códigos usados nos requisitos mínimos e nas ofertas). */
export const COVERAGE_CATALOG = {
  auto: [['casco', 'Casco (colisão, incêndio e roubo/furto)'], ['rcf_dm', 'RCF danos materiais'], ['rcf_dc', 'RCF danos corporais'], ['rcf_morais', 'Danos morais'], ['app', 'Acidentes pessoais de passageiros'], ['vidros', 'Vidros, faróis e retrovisores'], ['carro_reserva', 'Carro reserva'], ['assist_24h', 'Assistência 24h']],
  residencial: [['incendio', 'Incêndio, raio e explosão'], ['danos_eletricos', 'Danos elétricos'], ['roubo', 'Roubo/furto qualificado'], ['vendaval', 'Vendaval e granizo'], ['rc_familiar', 'RC familiar'], ['perda_aluguel', 'Perda ou pagamento de aluguel'], ['assist_residencial', 'Assistência residencial']],
  condominio: [['basica', 'Cobertura básica'], ['rc_sindico', 'RC do síndico'], ['danos_eletricos', 'Danos elétricos'], ['vendaval', 'Vendaval'], ['rc_condominio', 'RC do condomínio']],
  empresarial: [['incendio', 'Incêndio, raio e explosão'], ['danos_eletricos', 'Danos elétricos'], ['roubo', 'Roubo de bens'], ['lucros_cessantes', 'Lucros cessantes'], ['rc_operacoes', 'RC operações'], ['equip_eletronicos', 'Equipamentos eletrônicos']],
  vida: [['morte', 'Morte'], ['ipa', 'Invalidez por acidente'], ['dg', 'Doenças graves'], ['dit', 'Diária por incapacidade'], ['funeral', 'Assistência funeral']],
  vida_grupo: [['morte', 'Morte'], ['ipa', 'Invalidez por acidente'], ['funeral', 'Assistência funeral']],
  saude: [['ambulatorial', 'Ambulatorial'], ['hospitalar', 'Hospitalar com obstetrícia'], ['hospitalar_sem_obst', 'Hospitalar sem obstetrícia'], ['referencia', 'Plano referência']],
  odonto: [['odonto_basico', 'Rol básico'], ['orto', 'Ortodontia'], ['protese', 'Prótese']],
  viagem: [['dmh', 'Despesas médico-hospitalares'], ['bagagem', 'Extravio de bagagem'], ['cancelamento', 'Cancelamento de viagem'], ['repatriacao', 'Repatriação']],
  rc: [['rc_profissional', 'RC profissional'], ['defesa', 'Custos de defesa']],
  do_cyber: [['do', 'D&O'], ['cyber', 'Riscos cibernéticos']],
  equipamentos: [['danos', 'Danos acidentais'], ['roubo', 'Roubo/furto qualificado']],
  rural: [['basica', 'Cobertura básica'], ['granizo', 'Granizo'], ['seca', 'Seca']],
  transportes: [['basica', 'Básica'], ['ampla', 'Ampla']],
  garantia: [['performance', 'Execução/performance'], ['judicial', 'Judicial']],
  fianca: [['aluguel', 'Aluguel'], ['encargos', 'Encargos'], ['danos_imovel', 'Danos ao imóvel']],
  previdencia: [['renda', 'Renda/benefício'], ['peculio', 'Pecúlio']],
  frota: [['casco', 'Casco'], ['rcf_dm', 'RCF danos materiais'], ['rcf_dc', 'RCF danos corporais'], ['app', 'APP']],
};

export function schemaFor(branch) {
  if (!BRANCHES[branch]) throw bad('Ramo inválido.');
  return RISK_SCHEMAS[branch] || { version: `${branch}-1`, fields: [f('descricao', 'Descrição do risco', 'textarea', { required: true }), ...COMMON_VALUE] };
}

/**
 * Valida os dados do risco contra o schema do ramo. Campos desconhecidos são descartados; respostas ausentes ficam null.
 * Devolve { data, missing } — "missing" lista obrigatórios não informados (estado "dados insuficientes").
 */
export function validateRisk(branch, input = {}) {
  const schema = schemaFor(branch);
  const data = {};
  const missing = [];
  for (const fld of schema.fields) {
    let v = input[fld.key];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (fld.type === 'number' || fld.type === 'money') {
        const n = Number(v);
        if (!Number.isFinite(n) || (fld.type === 'money' && !Number.isSafeInteger(n))) throw bad(`${fld.label}: número inválido`);
        if ((fld.min != null && n < fld.min) || (fld.max != null && n > fld.max)) throw bad(`${fld.label}: fora do intervalo aceito`);
        v = n;
      } else if (fld.type === 'boolean') {
        if (typeof v !== 'boolean') throw bad(`${fld.label}: use sim ou não`);
      } else if (fld.type === 'select') {
        if (!fld.options.includes(v)) throw bad(`${fld.label}: opção inválida`);
      } else if (fld.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad(`${fld.label}: data inválida`);
      } else {
        v = String(v).trim().slice(0, 2000);
        if (fld.pattern && !new RegExp(fld.pattern).test(v)) throw bad(`${fld.label}: formato inválido`);
      }
    }
    if (v === null && fld.required) missing.push(fld.label);
    data[fld.key] = v;
  }
  return { data, missing, version: schema.version };
}
