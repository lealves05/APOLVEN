// Catálogo versionado de produtos e planos (6.2). O catálogo informa características conhecidas;
// preço só existe como cotação (retorno válido do fornecedor ou cotação formal anexada).
import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Package, ExternalLink, Info } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import {
  PageHeader, Section, KV, Modal, Input, Textarea, Select, CentsInput, StatusChip, Notice, Empty, Loading, useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { BRANCHES, fmt, fmtDateTime, money } from '../lib/format';

const tone = {
  gray: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300', blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', red: 'bg-red-500/10 text-red-700 dark:text-red-300',
};
const PRODUCT_STATUS = {
  rascunho: { label: 'Rascunho', cls: tone.gray }, validado: { label: 'Validado', cls: tone.blue }, ativo: { label: 'Ativo', cls: tone.green },
  vencido: { label: 'Vencido', cls: tone.orange }, retirado: { label: 'Retirado de comercialização', cls: tone.red }, pendente_revisao: { label: 'Pendente de revisão', cls: tone.amber },
};

const EMPTY = {
  institution_id: '', branch: 'auto', name: '', provider_code: '', official_process: '', valid_from: '', valid_to: '', coverages: [], assistances: [],
  payment_terms: '', eligibility: '', territory: '', required_documents: '', conditions_url: '', source: '',
};
const nul = (s) => (String(s ?? '').trim() || null);

export default function Products() {
  const { can, branchLabel } = useAuth();
  const editor = can('products');
  const [f, setF] = useState({ branch: '', institution_id: '', q: '', status: '' });
  const { data: insts } = useFetch(() => api.get('/v1/catalog/institutions'), []);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/catalog/products?${new URLSearchParams(Object.fromEntries(Object.entries({ branch: f.branch, institution_id: f.institution_id }).filter(([, v]) => v)))}`), [f.branch, f.institution_id]);
  const [open, setOpen] = useState(null); // { mode: 'new'|'edit'|'view', product }
  const rows = useMemo(() => (data || []).filter((p) => (!f.status || p.status === f.status) && (!f.q || `${p.name} ${p.provider_code || ''}`.toLowerCase().includes(f.q.toLowerCase()))), [data, f.status, f.q]);
  const t = useTable(rows, { sort: 'institution_name', get: { version: (p) => parseInt(p.version, 10) || 0 } });
  const insurers = (insts || []).filter((i) => i.kind !== 'parceiro_tecnologico');

  return (
    <>
      <PageHeader title="Produtos e planos" subtitle="Catálogo versionado com coberturas, assistências, condições e origem da informação"
        actions={editor && <button className="btn-primary" onClick={() => setOpen({ mode: 'new', product: null })}><Plus className="h-4 w-4" /> Novo produto</button>} />
      <Notice tone="info" className="mb-4">
        O catálogo informa <b>características conhecidas</b> do produto. <b>Preço não vem do catálogo</b>: só existe como cotação, quando há retorno válido do fornecedor ou cotação formal anexada.
      </Notice>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Buscar" placeholder="Nome ou código" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select label="Ramo" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
          <option value="">Todos</option>
          {Object.keys(BRANCHES).map((b) => <option key={b} value={b}>{branchLabel(b)}</option>)}
        </Select>
        <Select label="Seguradora / operadora" value={f.institution_id} onChange={(e) => setF({ ...f, institution_id: e.target.value })}>
          <option value="">Todas</option>
          {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Todos</option>
          {Object.entries(PRODUCT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </Select>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="card"><Empty icon={Package} title="Nenhum produto no catálogo" text="Cadastre os produtos com que a corretora trabalha, informando a origem de cada dado."
          action={editor && <button className="btn-primary" onClick={() => setOpen({ mode: 'new', product: null })}>Novo produto</button>} /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="name">Produto</SortTh><SortTh t={t} k="institution_name">Seguradora</SortTh><SortTh t={t} k="branch">Ramo</SortTh>
              <SortTh t={t} k="version">Versão</SortTh><th>Vigência</th><SortTh t={t} k="status">Status</SortTh><th>Origem</th><th aria-label="Ações" />
            </tr></thead>
            <tbody>
              {t.rows.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => setOpen({ mode: 'view', product: p })}>
                  <td data-label="Produto"><div className="font-medium">{p.name}</div>{p.provider_code && <div className="text-xs text-ink-faint">Código {p.provider_code}</div>}</td>
                  <td data-label="Seguradora">{p.institution_name}</td>
                  <td data-label="Ramo">{branchLabel(p.branch)}</td>
                  <td data-label="Versão" className="tabular-nums">v{p.version}</td>
                  <td data-label="Vigência" className="whitespace-nowrap text-sm">{p.valid_from || p.valid_to ? `${fmt(p.valid_from)} a ${fmt(p.valid_to)}` : 'Não informada'}</td>
                  <td data-label="Status"><StatusChip map={PRODUCT_STATUS} value={p.status} /></td>
                  <td data-label="Origem" className="max-w-[220px] truncate text-xs text-ink-soft" title={p.source}>{p.source}</td>
                  <td data-label="" onClick={(e) => e.stopPropagation()}>
                    {editor && <button className="btn-ghost btn-icon" aria-label="Editar" onClick={() => setOpen({ mode: 'edit', product: p })}><Pencil className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      {open?.mode === 'view' && <ProductView p={open.product} editor={editor} onClose={() => setOpen(null)} onEdit={() => setOpen({ mode: 'edit', product: open.product })} onChanged={reload} />}
      {(open?.mode === 'new' || open?.mode === 'edit') && (
        <ProductEditor product={open.product} insts={insurers} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />
      )}
    </>
  );
}

function ProductView({ p, editor, onClose, onEdit, onChanged }) {
  const { branchLabel } = useAuth();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [status, setStatus] = useState(p.status);
  const changeStatus = async (s) => {
    if (s === status) return;
    const msg = s === 'ativo' || s === 'validado'
      ? 'Você confirma que conferiu as informações com a documentação oficial do fornecedor? Seu usuário ficará registrado como responsável pela validação.'
      : `O produto passará para "${PRODUCT_STATUS[s].label}".`;
    if (!(await confirm({ title: 'Alterar status do produto?', message: msg, confirmText: 'Alterar status', danger: s === 'retirado' }))) return;
    const r = await run(() => api.post(`/v1/catalog/products/${p.id}/status`, { status: s }), 'Status alterado.');
    if (r !== FAIL) { setStatus(r.status); onChanged(); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={`${p.name} · v${p.version}`} subtitle={`${p.institution_name} · ${branchLabel(p.branch)}`}
      footer={<>
        {editor && (
          <Select label="" value={status} disabled={busy} onChange={(e) => changeStatus(e.target.value)} className="mr-auto min-w-[220px]">
            {Object.entries(PRODUCT_STATUS).map(([k, s]) => <option key={k} value={k}>Status: {s.label}</option>)}
          </Select>
        )}
        <button className="btn-ghost" onClick={onClose}>Fechar</button>
        {editor && <button className="btn-primary" onClick={onEdit}><Pencil className="h-4 w-4" /> Editar</button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><StatusChip map={PRODUCT_STATUS} value={status} />
          {p.validated_at && <span className="text-xs text-ink-faint">Validado em {fmtDateTime(p.validated_at)}</span>}</div>
        <KV cols={3} items={[
          ['Código no fornecedor', p.provider_code], ['Processo oficial', p.official_process],
          ['Vigência', p.valid_from || p.valid_to ? `${fmt(p.valid_from)} a ${fmt(p.valid_to)}` : 'Não informada'],
          ['Território', p.territory], ['Formas de pagamento', p.payment_terms], ['Elegibilidade', p.eligibility],
          ['Documentos necessários', p.required_documents],
          ['Condições gerais', p.conditions_url ? <a key="u" href={p.conditions_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary underline">Abrir <ExternalLink className="h-3 w-3" /></a> : null],
          ['Origem da informação', p.source],
        ]} />
        <Section title="Coberturas" bodyClass="p-0">
          {!p.coverages?.length ? <p className="p-4 text-sm text-ink-faint">Nenhuma cobertura cadastrada.</p> : (
            <table className="table-clean">
              <thead><tr><th>Cobertura</th><th>Tipo</th><th>Limite</th><th>Franquia / participação</th></tr></thead>
              <tbody>{p.coverages.map((c, i) => (
                <tr key={`${c.code}-${i}`}>
                  <td data-label="Cobertura">{c.name}</td>
                  <td data-label="Tipo">{c.basic ? 'Básica' : 'Opcional'}</td>
                  <td data-label="Limite" className="tabular-nums">{money(c.limit_cents, 'não informado')}</td>
                  <td data-label="Franquia / participação">{c.deductible || 'não informada'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Section>
        <Section title="Assistências">
          {p.assistances?.length ? <ul className="flex flex-wrap gap-1.5">{p.assistances.map((a, i) => <li key={i} className="chip bg-muted text-ink-soft">{a.name}</li>)}</ul>
            : <p className="text-sm text-ink-faint">Nenhuma assistência cadastrada.</p>}
        </Section>
        <Notice tone="info">Limites e franquias aqui são as características conhecidas do produto. O valor do seguro e as condições definitivas vêm da cotação e do documento emitido.</Notice>
      </div>
    </Modal>
  );
}

function ProductEditor({ product, insts, onClose, onSaved }) {
  const { meta, branchLabel } = useAuth();
  const [run, busy] = useAction();
  const [v, setV] = useState(() => (product ? {
    ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, product[k] ?? EMPTY[k]])),
    valid_from: product.valid_from ? String(product.valid_from).slice(0, 10) : '', valid_to: product.valid_to ? String(product.valid_to).slice(0, 10) : '',
  } : { ...EMPTY, institution_id: insts[0]?.id || '' }));
  const [assist, setAssist] = useState('');
  const [sugg, setSugg] = useState('');
  useEffect(() => { if (!v.institution_id && insts[0]) setV((x) => ({ ...x, institution_id: insts[0].id })); }, [insts]); // eslint-disable-line
  const versioned = product && ['validado', 'ativo'].includes(product.status);
  const suggestions = (meta?.coverage_catalog?.[v.branch] || []).filter((s) => !v.coverages.some((c) => c.code === s.code));
  const setCov = (i, patch) => setV({ ...v, coverages: v.coverages.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addCov = (c) => setV({ ...v, coverages: [...v.coverages, { code: c.code, name: c.name, basic: false, limit_cents: null, deductible: '' }] });
  const invalid = !v.institution_id || v.name.trim().length < 2 || v.source.trim().length < 3 || v.coverages.some((c) => !c.name.trim())
    || (v.conditions_url && !/^https?:\/\/\S+$/i.test(v.conditions_url)) || (v.valid_from && v.valid_to && v.valid_to < v.valid_from);

  const save = async () => {
    const body = {
      institution_id: v.institution_id, branch: v.branch, name: v.name.trim(), provider_code: nul(v.provider_code), official_process: nul(v.official_process),
      valid_from: v.valid_from || null, valid_to: v.valid_to || null,
      coverages: v.coverages.map((c, i) => ({ code: (c.code || `cob_${i + 1}`).slice(0, 60), name: c.name.trim(), basic: !!c.basic, limit_cents: c.limit_cents ?? null, deductible: nul(c.deductible) })),
      assistances: v.assistances.map((a) => ({ ...(a.code ? { code: a.code } : {}), name: a.name })),
      payment_terms: nul(v.payment_terms), eligibility: nul(v.eligibility), territory: nul(v.territory), required_documents: nul(v.required_documents),
      conditions_url: nul(v.conditions_url), source: v.source.trim(),
    };
    const r = await run(() => (product ? api.put(`/v1/catalog/products/${product.id}`, body) : api.post('/v1/catalog/products', body)),
      versioned ? 'Nova versão criada, pendente de revisão.' : product ? 'Produto atualizado.' : 'Produto cadastrado como rascunho.');
    if (r !== FAIL) onSaved(r);
  };

  return (
    <Modal open onClose={onClose} size="xl" title={product ? `Editar ${product.name} (v${product.version})` : 'Novo produto'}
      subtitle="Informe somente o que consta na documentação do fornecedor; campos vazios ficam como não informados"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || invalid} onClick={save}>{versioned ? 'Salvar como nova versão' : 'Salvar'}</button></>}>
      <div className="space-y-5">
        {versioned && (
          <Notice tone="warn"><b>Este produto está {product.status === 'ativo' ? 'ativo' : 'validado'}.</b> Para preservar o histórico, a alteração não sobrescreve a versão atual:
            será criada a versão {(parseInt(product.version, 10) || 1) + 1} com status “Pendente de revisão”, que precisa ser validada antes de valer.</Notice>
        )}
        {!product && <Notice tone="info">Produtos novos começam como rascunho. Depois de conferir com a documentação oficial, altere o status para validado ou ativo.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Seguradora / operadora *" value={v.institution_id} onChange={(e) => setV({ ...v, institution_id: e.target.value })}>
            {!insts.length && <option value="">Cadastre a empresa em Seguradoras e Integrações</option>}
            {insts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Select label="Ramo *" value={v.branch} onChange={(e) => setV({ ...v, branch: e.target.value })}>
            {Object.keys(BRANCHES).map((b) => <option key={b} value={b}>{branchLabel(b)}</option>)}
          </Select>
          <Input label="Nome comercial *" value={v.name} maxLength={200} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <Input label="Código do produto no fornecedor" value={v.provider_code} maxLength={80} onChange={(e) => setV({ ...v, provider_code: e.target.value })} />
          <Input label="Processo / registro oficial" value={v.official_process} maxLength={80} onChange={(e) => setV({ ...v, official_process: e.target.value })} hint="Quando existente e aplicável." />
          <Input label="Link das condições gerais" type="url" value={v.conditions_url} maxLength={500} onChange={(e) => setV({ ...v, conditions_url: e.target.value })} />
          <Input label="Início da validade" type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} />
          <Input label="Fim da validade" type="date" value={v.valid_to} onChange={(e) => setV({ ...v, valid_to: e.target.value })} />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h3 className="text-sm font-semibold">Coberturas</h3>
            <div className="flex flex-wrap items-end gap-2">
              {suggestions.length > 0 && (
                <Select label="" value={sugg} onChange={(e) => { const s = suggestions.find((x) => x.code === e.target.value); if (s) addCov(s); setSugg(''); }} className="min-w-[220px]">
                  <option value="">Adicionar sugestão do ramo…</option>
                  {suggestions.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </Select>
              )}
              <button type="button" className="btn-outline" onClick={() => addCov({ code: '', name: '' })}><Plus className="h-4 w-4" /> Outra cobertura</button>
            </div>
          </div>
          {!v.coverages.length ? <p className="rounded-app-sm border border-dashed border-line p-4 text-center text-sm text-ink-faint">Nenhuma cobertura adicionada.</p> : (
            <div className="space-y-3">
              {v.coverages.map((c, i) => (
                <div key={i} className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-[2fr_1fr_1.4fr_auto_auto] sm:items-end">
                  <Input label="Cobertura" value={c.name} maxLength={160} onChange={(e) => setCov(i, { name: e.target.value })} />
                  <CentsInput label="Limite" value={c.limit_cents} onChange={(val) => setCov(i, { limit_cents: val })} />
                  <Input label="Franquia / participação" value={c.deductible || ''} maxLength={200} onChange={(e) => setCov(i, { deductible: e.target.value })} />
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={!!c.basic} onChange={(e) => setCov(i, { basic: e.target.checked })} /> Básica</label>
                  <button type="button" className="btn-ghost btn-icon mb-0.5" aria-label="Remover cobertura" onClick={() => setV({ ...v, coverages: v.coverages.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-ink-faint">Limite vazio = não informado (nunca zero).</p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Assistências</h3>
          <div className="flex flex-wrap gap-1.5">
            {v.assistances.map((a, i) => (
              <span key={i} className="chip bg-muted text-ink-soft">{a.name}
                <button type="button" aria-label={`Remover ${a.name}`} onClick={() => setV({ ...v, assistances: v.assistances.filter((_, j) => j !== i) })}>×</button></span>
            ))}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (assist.trim()) { setV({ ...v, assistances: [...v.assistances, { name: assist.trim() }] }); setAssist(''); } }}>
            <Input label="" placeholder="Ex.: guincho, chaveiro, vidros" value={assist} maxLength={160} onChange={(e) => setAssist(e.target.value)} className="flex-1" />
            <button type="submit" className="btn-outline">Adicionar</button>
          </form>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Textarea label="Formas de pagamento e parcelamento" value={v.payment_terms} maxLength={1000} onChange={(e) => setV({ ...v, payment_terms: e.target.value })} />
          <Textarea label="Público elegível / regras de aceitação" value={v.eligibility} maxLength={2000} onChange={(e) => setV({ ...v, eligibility: e.target.value })} />
          <Input label="Território" value={v.territory} maxLength={300} onChange={(e) => setV({ ...v, territory: e.target.value })} />
          <Textarea label="Documentos necessários" value={v.required_documents} maxLength={1000} onChange={(e) => setV({ ...v, required_documents: e.target.value })} />
        </div>
        <Input label="Origem da informação *" value={v.source} maxLength={300} onChange={(e) => setV({ ...v, source: e.target.value })}
          hint="De onde vieram estes dados (ex.: condições gerais versão X, material do fornecedor de 10/2026). Obrigatório." />
        <p className="flex items-center gap-1.5 text-xs text-ink-faint"><Info className="h-3.5 w-3.5" /> O catálogo não registra preço: valores do seguro vêm somente de cotação.</p>
      </div>
    </Modal>
  );
}
