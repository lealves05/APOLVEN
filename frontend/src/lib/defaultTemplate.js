// Modelo padrão de impressão da apólice (resumo emitido pela corretora). Serve de ponto de partida no editor
// e é usado quando a corretora ainda não salvou um modelo próprio.
import { LOGO_SRC } from './printFields.js';

const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}) });
const f = (key, ...marks) => ({ type: 'mergeField', attrs: { key }, ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}) });
const small = { type: 'textStyle', attrs: { fontSize: '8pt', color: '#52525b' } };
const muted = { type: 'textStyle', attrs: { color: '#52525b' } };
const p = (content, textAlign) => ({ type: 'paragraph', ...(textAlign ? { attrs: { textAlign } } : {}), content: content.filter(Boolean) });
const hd = (level, text, textAlign) => ({ type: 'heading', attrs: { level, ...(textAlign ? { textAlign } : {}) }, content: [t(text)] });
const cell = (content, { header = false, colspan = 1, bg } = {}) => ({
  type: header ? 'tableHeader' : 'tableCell', attrs: { colspan, rowspan: 1, colwidth: null, ...(bg ? { backgroundColor: bg } : {}) },
  content: [p(Array.isArray(content) ? content : [content])],
});
const label = (s) => cell(t(s, 'bold', muted), { bg: '#f4f4f5' });
const row = (...cells) => ({ type: 'tableRow', content: cells });
const table = (rows, variant = 'grid') => ({ type: 'table', attrs: { variant }, content: rows });
const data = (source, columns) => ({ type: 'dataTable', attrs: { source, columns } });

export const DEFAULT_PAGE = { paper: 'A4', orientation: 'portrait', margins: { top: 18, right: 16, bottom: 18, left: 16 } };

export const DEFAULT_HEADER = {
  type: 'doc',
  content: [
    table([row(
      { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [190] }, content: [{ type: 'image', attrs: { src: LOGO_SRC, alt: 'Logotipo da corretora', width: 150, align: 'left' } }] },
      { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [
        p([f('corretora.nome', 'bold')], 'right'),
        p([t('CNPJ ', small), f('corretora.cnpj', small), t(' · SUSEP ', small), f('corretora.susep', small)], 'right'),
        p([f('corretora.telefone', small), t(' · ', small), f('corretora.email', small)], 'right'),
      ] },
    )], 'plain'),
    { type: 'horizontalRule' },
  ],
};

export const DEFAULT_FOOTER = {
  type: 'doc',
  content: [
    { type: 'horizontalRule' },
    p([f('corretora.nome', small), t(' · ', small), f('corretora.endereco', small), t(' · Página ', small),
      { type: 'pageNumber', attrs: { kind: 'current' }, marks: [small] }, t(' de ', small), { type: 'pageNumber', attrs: { kind: 'total' }, marks: [small] }], 'center'),
  ],
};

export const DEFAULT_DOC = {
  type: 'doc',
  content: [
    hd(1, 'Resumo da apólice de seguro', 'center'),
    p([f('apolice.ramo', muted), t(' · ', muted), f('apolice.seguradora', muted)], 'center'),
    hd(3, 'Dados da apólice'),
    table([
      row(label('Nº da apólice'), cell(f('apolice.numero', 'bold')), label('Seguradora'), cell(f('apolice.seguradora'))),
      row(label('Produto'), cell(f('apolice.produto')), label('Ramo'), cell(f('apolice.ramo'))),
      row(label('Vigência'), cell(f('apolice.vigencia')), label('Situação'), cell(f('apolice.estado'))),
      row(label('Certificado'), cell(f('apolice.certificado')), label('Emitido em'), cell(f('emissao.data'))),
    ]),
    hd(3, 'Segurado'),
    table([
      row(label('Nome'), cell(f('cliente.nome', 'bold')), label('CPF/CNPJ'), cell(f('cliente.documento'))),
      row(label('Endereço'), cell(f('cliente.endereco'), { colspan: 3 })),
      row(label('Telefone'), cell(f('cliente.telefone')), label('E-mail'), cell(f('cliente.email'))),
    ]),
    hd(3, 'Itens segurados'),
    data('itens', ['descricao', 'identificador', 'tipo']),
    hd(3, 'Coberturas e franquias'),
    data('coberturas', ['nome', 'limite', 'franquia']),
    hd(3, 'Prêmio e pagamento'),
    table([
      row(cell(t('Prêmio líquido', 'bold'), { header: true }), cell(t('IOF', 'bold'), { header: true }), cell(t('Prêmio total', 'bold'), { header: true })),
      row(cell(f('apolice.premio_liquido')), cell(f('apolice.iof')), cell(f('apolice.premio_total', 'bold'))),
    ]),
    p([t('Forma de pagamento: ', 'bold'), f('apolice.forma_pagamento')]),
    data('parcelas', ['numero', 'vencimento', 'valor', 'situacao']),
    hd(3, 'Corretor responsável'),
    p([f('corretor.nome'), t(' — '), f('corretora.nome'), t(' (SUSEP '), f('corretora.susep'), t(')')]),
    p([t('Assistência 24h da seguradora: ', 'bold'), f('apolice.assistencia')]),
    p([t('Este documento é um resumo emitido pela corretora com base na apólice da seguradora. Em caso de divergência, prevalecem a apólice emitida pela seguradora e as condições gerais e especiais do produto.', 'italic', small)]),
  ],
};

export const DEFAULT_TEMPLATE = { doc: DEFAULT_DOC, header: DEFAULT_HEADER, footer: DEFAULT_FOOTER, page: DEFAULT_PAGE };
