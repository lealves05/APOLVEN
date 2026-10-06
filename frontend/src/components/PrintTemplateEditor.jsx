// Configurações › Aparência › Modelo de impressão da apólice: editor no estilo Word (TipTap) com cabeçalho e rodapé,
// campos de mesclagem, tabelas repetidas, configuração de página e pré-visualização paginada com dados de exemplo
// ou de uma apólice real. Salvo por corretora (padrão) e, opcionalmente, por ramo.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import {
  Undo2, Redo2, Bold, Italic, Underline as UIcon, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
  Table as TableIcon, Minus, SeparatorHorizontal, ImagePlus, Building, Eye, Pencil, Save, RotateCcw, Trash2, Highlighter, Palette, Rows3, Columns3,
  Merge, Split, Square, Hash, Info,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Section, Select, Notice, Loading, Spinner, FileButton, cx, useAction, FAIL } from './ui';
import { printExtensions, cleanDoc, setEditorLogo } from '../lib/tiptapPrint';
import { FIELD_GROUPS, TABLE_SOURCES, LOGO_SRC, SAMPLE_RAW, buildPrintData } from '../lib/printFields';
import { DEFAULT_TEMPLATE, DEFAULT_PAGE } from '../lib/defaultTemplate';
import PrintSheets, { sheetSize } from './PrintSheets';

const SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt'];
const AREAS = { doc: 'Corpo', header: 'Cabeçalho', footer: 'Rodapé' };
const clone = (x) => JSON.parse(JSON.stringify(x));

function Btn({ on, active, label, children, disabled }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active || undefined} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={on}
      className={cx('pt-tb-btn', active && 'is-active')}>{children}</button>
  );
}

/** Imagem colocada no modelo: reduzida no navegador (até 1000 px / 600 KB). */
async function imageToDataUrl(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = b[0] === 0x89 && b[1] === 0x50;
  const jpg = b[0] === 0xff && b[1] === 0xd8;
  const webp = String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  if (!png && !jpg && !webp) throw new Error('Use imagem PNG, JPG ou WEBP.');
  const bmp = await createImageBitmap(file);
  let side = 1000;
  for (let i = 0; i < 6; i += 1) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d');
    if (jpg) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.88);
    if (url.length < 800_000) return url;
    side = Math.round(side * 0.75);
  }
  throw new Error('Imagem grande demais mesmo reduzida.');
}

function Toolbar({ editor, area, toast }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const f = () => force((x) => x + 1);
    editor.on('selectionUpdate', f); editor.on('transaction', f);
    return () => { editor.off('selectionUpdate', f); editor.off('transaction', f); };
  }, [editor]);
  if (!editor) return null;
  const c = () => editor.chain().focus();
  const style = [1, 2, 3, 4].find((l) => editor.isActive('heading', { level: l }));
  const size = editor.getAttributes('textStyle').fontSize || '';
  const inTable = editor.isActive('table');
  const img = editor.isActive('image') ? editor.getAttributes('image') : null;
  const addImage = async (file) => {
    try { const src = await imageToDataUrl(file); c().setImage({ src }).run(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="pt-toolbar" role="toolbar" aria-label={`Formatação — ${AREAS[area]}`}>
      <div className="pt-tb-group">
        <Btn label="Desfazer (Ctrl+Z)" on={() => c().undo().run()} disabled={!editor.can().undo()}><Undo2 className="h-4 w-4" /></Btn>
        <Btn label="Refazer (Ctrl+Y)" on={() => c().redo().run()} disabled={!editor.can().redo()}><Redo2 className="h-4 w-4" /></Btn>
      </div>
      <div className="pt-tb-group">
        <select aria-label="Estilo do parágrafo" className="pt-tb-select" value={style ? `h${style}` : 'p'}
          onChange={(e) => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().toggleHeading({ level: Number(v.slice(1)) }).run(); }}>
          <option value="p">Texto normal</option><option value="h1">Título 1</option><option value="h2">Título 2</option><option value="h3">Título 3</option><option value="h4">Título 4</option>
        </select>
        <select aria-label="Tamanho da fonte" className="pt-tb-select w-[84px]" value={size}
          onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}>
          <option value="">Tamanho</option>{SIZES.map((s) => <option key={s} value={s}>{s.replace('pt', '')}</option>)}
        </select>
      </div>
      <div className="pt-tb-group">
        <Btn label="Negrito (Ctrl+B)" active={editor.isActive('bold')} on={() => c().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
        <Btn label="Itálico (Ctrl+I)" active={editor.isActive('italic')} on={() => c().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
        <Btn label="Sublinhado (Ctrl+U)" active={editor.isActive('underline')} on={() => c().toggleUnderline().run()}><UIcon className="h-4 w-4" /></Btn>
        <Btn label="Tachado" active={editor.isActive('strike')} on={() => c().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
        <label className="pt-tb-btn" title="Cor do texto"><Palette className="h-4 w-4" style={{ color: editor.getAttributes('textStyle').color || undefined }} />
          <input type="color" className="sr-only" aria-label="Cor do texto" onChange={(e) => c().setColor(e.target.value).run()} /></label>
        <label className="pt-tb-btn" title="Realce (marca-texto)"><Highlighter className="h-4 w-4" />
          <input type="color" className="sr-only" aria-label="Cor do realce" defaultValue="#fef08a" onChange={(e) => c().setHighlight({ color: e.target.value }).run()} /></label>
        <Btn label="Limpar formatação" on={() => c().unsetAllMarks().run()}><span className="text-xs font-semibold">Tx</span></Btn>
      </div>
      <div className="pt-tb-group">
        {[['left', AlignLeft, 'Alinhar à esquerda'], ['center', AlignCenter, 'Centralizar'], ['right', AlignRight, 'Alinhar à direita'], ['justify', AlignJustify, 'Justificar']].map(([a, I, l]) => (
          <Btn key={a} label={l} active={editor.isActive({ textAlign: a })} on={() => (img ? c().updateAttributes('image', { align: a === 'justify' ? 'left' : a }).run() : c().setTextAlign(a).run())}><I className="h-4 w-4" /></Btn>
        ))}
        <Btn label="Lista com marcadores" active={editor.isActive('bulletList')} on={() => c().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn label="Lista numerada" active={editor.isActive('orderedList')} on={() => c().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
      </div>
      <div className="pt-tb-group">
        <Btn label="Inserir tabela 3×3" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4" /></Btn>
        <Btn label="Linha horizontal" on={() => c().setHorizontalRule().run()}><Minus className="h-4 w-4" /></Btn>
        {area === 'doc' && <Btn label="Quebra de página" on={() => c().setPageBreak().run()}><SeparatorHorizontal className="h-4 w-4" /></Btn>}
        <FileButton className="pt-tb-btn" accept="image/png,image/jpeg,image/webp" onFile={addImage}><ImagePlus className="h-4 w-4" aria-label="Inserir imagem" /></FileButton>
        <Btn label="Inserir logotipo da corretora" on={() => c().insertContent({ type: 'image', attrs: { src: LOGO_SRC, width: 160, align: 'left' } }).run()}><Building className="h-4 w-4" /></Btn>
      </div>
      {inTable && (
        <div className="pt-tb-group pt-tb-context" aria-label="Tabela">
          <span className="pt-tb-label">Tabela:</span>
          <Btn label="Linha acima" on={() => c().addRowBefore().run()}><Rows3 className="h-4 w-4 rotate-180" /></Btn>
          <Btn label="Linha abaixo" on={() => c().addRowAfter().run()}><Rows3 className="h-4 w-4" /></Btn>
          <Btn label="Excluir linha" on={() => c().deleteRow().run()}><span className="text-xs">−L</span></Btn>
          <Btn label="Coluna à esquerda" on={() => c().addColumnBefore().run()}><Columns3 className="h-4 w-4 rotate-180" /></Btn>
          <Btn label="Coluna à direita" on={() => c().addColumnAfter().run()}><Columns3 className="h-4 w-4" /></Btn>
          <Btn label="Excluir coluna" on={() => c().deleteColumn().run()}><span className="text-xs">−C</span></Btn>
          <Btn label="Mesclar células" on={() => c().mergeCells().run()} disabled={!editor.can().mergeCells()}><Merge className="h-4 w-4" /></Btn>
          <Btn label="Dividir célula" on={() => c().splitCell().run()} disabled={!editor.can().splitCell()}><Split className="h-4 w-4" /></Btn>
          <Btn label="Linha de cabeçalho (repete em cada página)" on={() => c().toggleHeaderRow().run()}><span className="text-xs font-semibold">Cab</span></Btn>
          <Btn label={editor.getAttributes('table').variant === 'plain' ? 'Mostrar bordas' : 'Sem bordas (layout)'} active={editor.getAttributes('table').variant === 'plain'}
            on={() => c().updateAttributes('table', { variant: editor.getAttributes('table').variant === 'plain' ? 'grid' : 'plain' }).run()}><Square className="h-4 w-4" /></Btn>
          <label className="pt-tb-btn" title="Cor de fundo da célula"><span className="h-3.5 w-3.5 rounded-sm border border-line bg-zinc-200" />
            <input type="color" className="sr-only" aria-label="Cor de fundo da célula" defaultValue="#f4f4f5" onChange={(e) => c().setCellAttribute('backgroundColor', e.target.value).run()} /></label>
          <Btn label="Excluir tabela" on={() => c().deleteTable().run()}><Trash2 className="h-4 w-4 text-red-600" /></Btn>
        </div>
      )}
      {img && (
        <div className="pt-tb-group pt-tb-context" aria-label="Imagem">
          <span className="pt-tb-label">Imagem:</span>
          {[['P', 100], ['M', 180], ['G', 300], ['GG', 480]].map(([l, w]) => (
            <Btn key={l} label={`Largura ${w}px`} active={img.width === w} on={() => c().updateAttributes('image', { width: w }).run()}><span className="text-xs font-semibold">{l}</span></Btn>
          ))}
        </div>
      )}
    </div>
  );
}

function AreaEditor({ editor, area, active, onFocus, hint }) {
  return (
    <div className={cx('pt-area', `pt-area-${area}`, active && 'is-active')} onMouseDown={onFocus} onFocusCapture={onFocus}>
      {area !== 'doc' && <div className="pt-area-label">{AREAS[area]} <span>· {hint}</span></div>}
      <EditorContent editor={editor} className="pt-content pt-editor" />
    </div>
  );
}

export default function PrintTemplateEditor() {
  const { can, meta, branchLabel } = useAuth();
  const { toast, confirm } = useUI();
  const [run, busy] = useAction();
  const edit = can('settings');
  const [branch, setBranch] = useState('');
  const [loaded, setLoaded] = useState(null); // { template, version, savedBranches, source }
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [area, setArea] = useState('doc');
  const [mode, setMode] = useState('editar');
  const [dirty, setDirty] = useState(false);
  const [logo, setLogo] = useState(null);
  const [previewId, setPreviewId] = useState('');
  const [previewRaw, setPreviewRaw] = useState(null);
  const [policies, setPolicies] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const markDirty = () => setDirty(true);

  useEffect(() => { api.get('/v1/company/logo').then((r) => setLogo(r.data_url || null)).catch(() => {}); }, []);
  useEffect(() => { setEditorLogo(logo); }, [logo]);
  // pré-visualização com dados de exemplo usa os dados reais da corretora (nome, CNPJ, SUSEP…)
  const [companyRaw, setCompanyRaw] = useState(null);
  useEffect(() => { api.get('/v1/company').then(setCompanyRaw).catch(() => {}); }, []);
  // extensões criadas uma vez: recriar o editor apagaria o que está sendo editado
  const exts = useMemo(() => printExtensions(), []);
  const opts = (content) => ({ extensions: exts, content, editable: edit, onUpdate: markDirty, immediatelyRender: true });
  const body = useEditor(opts(DEFAULT_TEMPLATE.doc), [exts]);
  const header = useEditor(opts(DEFAULT_TEMPLATE.header), [exts]);
  const footer = useEditor(opts(DEFAULT_TEMPLATE.footer), [exts]);
  const editors = { doc: body, header, footer };
  const current = editors[area];

  const fill = (t) => {
    body?.commands.setContent(t.doc, { emitUpdate: false });
    header?.commands.setContent(t.header || { type: 'doc', content: [] }, { emitUpdate: false });
    footer?.commands.setContent(t.footer || { type: 'doc', content: [] }, { emitUpdate: false });
    setPage(t.page || DEFAULT_PAGE);
    setDirty(false);
  };
  const latest = useRef(null);
  const load = async (b = branch) => {
    const r = await api.get(`/v1/print-templates/policy?exact=1&branch=${encodeURIComponent(b || 'padrao')}`);
    let t = r.template;
    let source = t ? 'salvo' : 'fabrica';
    if (!t && b) {
      // ramo sem modelo próprio: começa do padrão da corretora (se houver)
      const d = await api.get('/v1/print-templates/policy?exact=1&branch=padrao');
      if (d.template) { t = d.template; source = 'padrao'; }
    }
    const tpl = t ? { doc: t.doc, header: t.header, footer: t.footer, page: t.page } : clone(DEFAULT_TEMPLATE);
    latest.current = { version: r.template?.version ?? null, saved: r.saved || [], source, updated: r.template };
    setLoaded({ ...latest.current, tpl });
  };
  useEffect(() => { if (body && header && footer) load().catch((e) => toast(e.message, 'error')); }, [branch, !!body, !!header, !!footer]); // eslint-disable-line
  useEffect(() => { if (loaded && body && header && footer) fill(loaded.tpl); }, [loaded, body, header, footer]); // eslint-disable-line

  const current3 = () => {
    const parts = { doc: body.getJSON(), header: header.getJSON(), footer: footer.getJSON() };
    let removed = 0;
    const out = {};
    for (const [k, v] of Object.entries(parts)) { const c = cleanDoc(v); out[k] = c.doc; removed += c.removed; }
    return { tpl: { ...out, page }, removed };
  };
  const save = async () => {
    const { tpl, removed } = current3();
    const r = await run(() => api.put('/v1/print-templates/policy', { branch: branch || null, version: loaded?.version ?? null, ...tpl }),
      branch ? `Modelo de ${branchLabel(branch).toLowerCase()} salvo.` : 'Modelo padrão salvo.');
    if (r === FAIL) return;
    if (removed) toast(`${removed} elemento(s) colado(s) sem suporte foram retirados (ex.: imagem de link externo).`, 'error');
    await load();
  };
  const restore = async () => {
    if (!(await confirm({ title: 'Restaurar o modelo padrão?', message: 'O editor volta ao modelo de fábrica do APOLVEN. Nada muda até você salvar.', confirmText: 'Restaurar', danger: false }))) return;
    fill(clone(DEFAULT_TEMPLATE)); setDirty(true);
  };
  const removeBranch = async () => {
    if (!(await confirm({ title: `Excluir o modelo de ${branchLabel(branch).toLowerCase()}?`, message: 'As apólices deste ramo passam a usar o modelo padrão da corretora.', confirmText: 'Excluir' }))) return;
    const r = await run(() => api.del(`/v1/print-templates/policy?branch=${encodeURIComponent(branch)}`), 'Modelo do ramo excluído.');
    if (r !== FAIL) await load();
  };

  // pré-visualização: dados de exemplo ou uma apólice real
  useEffect(() => { if (mode === 'visualizar' && policies === null) api.get('/v1/policies').then((l) => setPolicies((l || []).slice(0, 200))).catch(() => setPolicies([])); }, [mode]); // eslint-disable-line
  useEffect(() => {
    if (!previewId) { setPreviewRaw(null); return; }
    api.get(`/v1/policies/${previewId}/print-data`).then(setPreviewRaw).catch((e) => { toast(e.message, 'error'); setPreviewId(''); });
  }, [previewId]); // eslint-disable-line
  const openPreview = () => { setSnapshot(current3().tpl); setMode('visualizar'); };
  const data = useMemo(() => {
    if (previewRaw) return buildPrintData(previewRaw, { logo, today: previewRaw.today });
    const sample = companyRaw?.name ? { ...SAMPLE_RAW, company: companyRaw } : SAMPLE_RAW;
    return buildPrintData(sample, { logo });
  }, [previewRaw, logo, companyRaw]);

  const insert = (content) => {
    const ed = editors[area];
    if (!ed) return;
    ed.chain().focus().insertContent(content).run();
  };
  const savedBranches = new Set((loaded?.saved || []).map((s) => s.branch || ''));
  const [sw] = sheetSize(page);
  const m = page.margins;

  if (!loaded) return <Section title="Modelo de impressão da apólice"><Loading /></Section>;
  return (
    <div className="space-y-4">
      <Section title="Modelo de impressão da apólice"
        subtitle="Como a apólice sai na aba “Versão impressa”: edite como num editor de texto e insira campos que são preenchidos com os dados de cada apólice."
        actions={<div className="flex flex-wrap gap-2">
          <button type="button" className={mode === 'editar' ? 'btn-primary' : 'btn-outline'} onClick={() => setMode('editar')}><Pencil className="h-4 w-4" />Editar</button>
          <button type="button" className={mode === 'visualizar' ? 'btn-primary' : 'btn-outline'} onClick={openPreview}><Eye className="h-4 w-4" />Pré-visualizar</button>
        </div>}>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Modelo" value={branch} className="w-full sm:w-72" onChange={async (e) => {
            if (dirty && !(await confirm({ title: 'Trocar de modelo sem salvar?', message: 'As alterações deste modelo serão perdidas.', confirmText: 'Trocar' }))) return;
            setBranch(e.target.value);
          }}>
            <option value="">Padrão (todos os ramos){savedBranches.has('') ? ' · salvo' : ''}</option>
            {Object.entries(meta?.branches || {}).map(([k, v]) => <option key={k} value={k}>{v}{savedBranches.has(k) ? ' · próprio' : ''}</option>)}
          </Select>
          <p className="pb-2 text-xs text-ink-faint">
            {loaded.source === 'fabrica' ? 'Ainda não salvo: começando do modelo de fábrica.' : loaded.source === 'padrao' ? 'Este ramo ainda não tem modelo próprio: começando do padrão da corretora.'
              : `Salvo${loaded.updated?.updated_by_name ? ` por ${loaded.updated.updated_by_name}` : ''} (versão ${loaded.version}).`}
            {dirty && <b className="ml-1 text-amber-700 dark:text-amber-300">Alterações não salvas.</b>}
          </p>
        </div>
      </Section>

      {mode === 'visualizar' ? (
        <Section title="Pré-visualização" subtitle="Folhas como sairão na impressão (cabeçalho, rodapé e quebras de página)."
          actions={<select className="input w-full sm:w-80" aria-label="Dados da pré-visualização" value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
            <option value="">Dados de exemplo</option>
            {(policies || []).map((p) => <option key={p.id} value={p.id}>{p.policy_number || 'sem número'} — {p.client_name}</option>)}
          </select>}>
          <div className="rounded-app-sm bg-zinc-200/70 p-3 dark:bg-zinc-800">
            {snapshot && <PrintSheets template={snapshot} data={data} />}
          </div>
        </Section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-2">
            {!edit && <Notice>Somente leitura: só quem administra a corretora altera o modelo.</Notice>}
            {edit && <div className="pt-toolbar-wrap"><Toolbar editor={current} area={area} toast={toast} /></div>}
            <p className="text-xs text-ink-faint">Editando: <b>{AREAS[area]}</b>. Clique no cabeçalho ou no rodapé da folha para editá-los. Campos aparecem como etiquetas azuis e são trocados pelos dados de cada apólice.</p>
            <div className="pt-desk">
              <div className="pt-sheet pt-sheet-edit" style={{ width: `${sw}mm`, padding: `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm` }}>
                <AreaEditor editor={header} area="header" active={area === 'header'} onFocus={() => setArea('header')} hint="repete no topo de cada página" />
                <AreaEditor editor={body} area="doc" active={area === 'doc'} onFocus={() => setArea('doc')} />
                <AreaEditor editor={footer} area="footer" active={area === 'footer'} onFocus={() => setArea('footer')} hint="repete no pé de cada página" />
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <Section title="Campos" subtitle={`Inserem no ${AREAS[area].toLowerCase()}, na posição do cursor.`} bodyClass="p-2">
              <div className="max-h-[420px] space-y-3 overflow-y-auto p-1">
                {FIELD_GROUPS.map((g) => (
                  <div key={g.group}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{g.group}</div>
                    <div className="flex flex-wrap gap-1">
                      {g.fields.map(([k, l]) => (
                        <button key={k} type="button" disabled={!edit} className="pt-chip pt-chip-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert({ type: 'mergeField', attrs: { key: k } })}>{l}</button>
                      ))}
                      {g.group === 'Corretora' && <button type="button" disabled={!edit} className="pt-chip pt-chip-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert({ type: 'image', attrs: { src: LOGO_SRC, width: 160, align: 'left' } })}>Logotipo</button>}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Página</div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" disabled={!edit} className="pt-chip pt-chip-btn pt-chip-page" onMouseDown={(e) => e.preventDefault()} onClick={() => insert({ type: 'pageNumber', attrs: { kind: 'current' } })}><Hash className="mr-0.5 inline h-3 w-3" />Nº da página</button>
                    <button type="button" disabled={!edit} className="pt-chip pt-chip-btn pt-chip-page" onMouseDown={(e) => e.preventDefault()} onClick={() => insert({ type: 'pageNumber', attrs: { kind: 'total' } })}><Hash className="mr-0.5 inline h-3 w-3" />Total de páginas</button>
                  </div>
                </div>
              </div>
            </Section>
            <Section title="Tabelas que repetem" subtitle="Uma linha por registro da apólice. Escolha as colunas na própria tabela." bodyClass="p-2">
              <div className="flex flex-wrap gap-1 p-1">
                {Object.entries(TABLE_SOURCES).map(([k, s]) => (
                  <button key={k} type="button" disabled={!edit || area !== 'doc'} className="btn-outline h-8 px-2.5 text-xs" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert({ type: 'dataTable', attrs: { source: k, columns: null } })}><TableIcon className="h-3.5 w-3.5" />{s.label}</button>
                ))}
              </div>
              {area !== 'doc' && <p className="px-1 text-xs text-ink-faint">Disponíveis só no corpo do documento.</p>}
            </Section>
            <Section title="Página">
              <div className="grid grid-cols-2 gap-3">
                <Select label="Papel" value={page.paper} disabled={!edit} onChange={(e) => { setPage({ ...page, paper: e.target.value }); markDirty(); }}>
                  <option value="A4">A4</option><option value="Letter">Carta</option>
                </Select>
                <Select label="Orientação" value={page.orientation} disabled={!edit} onChange={(e) => { setPage({ ...page, orientation: e.target.value }); markDirty(); }}>
                  <option value="portrait">Retrato</option><option value="landscape">Paisagem</option>
                </Select>
                {[['top', 'Margem superior'], ['bottom', 'Margem inferior'], ['left', 'Margem esquerda'], ['right', 'Margem direita']].map(([k, l]) => (
                  <label key={k} className="block"><span className="label">{l} (mm)</span>
                    <input type="number" min={5} max={50} className="input" value={page.margins[k]} disabled={!edit}
                      onChange={(e) => { setPage({ ...page, margins: { ...page.margins, [k]: Math.max(5, Math.min(50, Number(e.target.value) || 5)) } }); markDirty(); }} /></label>
                ))}
              </div>
            </Section>
          </aside>
        </div>
      )}

      {edit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto flex items-center gap-1 text-xs text-ink-faint"><Info className="h-3.5 w-3.5" />Dica: “Tabela sem bordas” ajuda a montar o layout (ex.: logotipo ao lado dos dados).</span>
          {branch && savedBranches.has(branch) && <button type="button" className="btn-ghost text-red-600" onClick={removeBranch}><Trash2 className="h-4 w-4" />Excluir modelo do ramo</button>}
          <button type="button" className="btn-outline" onClick={restore}><RotateCcw className="h-4 w-4" />Restaurar modelo padrão</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}Salvar modelo</button>
        </div>
      )}
    </div>
  );
}
