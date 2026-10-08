// Apólices e certificados (10), endossos e cancelamentos (11), renovação (12), parcelas do prêmio (13),
// plano de comissão (14) e vínculo de repasses (15) por contrato.
// Estado contratual, estado documental e situação financeira são exibidos separadamente.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, FileCheck2, Pencil, Download, Link2, MessageCircle, CreditCard, Bell, RefreshCw, Trash2, Upload,
  ExternalLink, Copy, Wand2, AlertTriangle, ShieldCheck, Repeat, Settings2, FileText, ArrowLeft, Info,
} from 'lucide-react';
import { api, qs, download, fileToPayload, appUrl, idemKey } from '../lib/api';
import {
  money, moneyOrNA, pct, fmt, fmtDateTime, ymd, ago, waLink, docNumber, downloadCSV,
  CONTRACT_STATE, DOC_STATE, INSTALLMENT_STATUS, COMMISSION_STATUS, CLAIM_STATUS, PROPOSAL_STATUS, BRANCHES,
} from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { SubmitButton,
  PageHeader, Section, KV, Tabs, Stat, Modal, Input, Textarea, Select, Field, Toggle, CentsInput, FileButton,
  StatusChip, Notice, Empty, Loading, Spinner, cx, useFetch, useAction, FAIL,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';

const PolicyPrintTab = lazy(() => import('../components/PolicyPrintTab'));

// ---------------- Dicionários locais ----------------
const C = {
  gray: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300', blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', red: 'bg-red-500/10 text-red-700 dark:text-red-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
};
const ITEM_KINDS = { veiculo: 'Veículo', imovel: 'Imóvel', vida: 'Vida', bem: 'Bem', local: 'Local' };
const ENDORSEMENT_KINDS = {
  inclusao: 'Inclusão', exclusao: 'Exclusão', alteracao_dados: 'Alteração de dados', alteracao_cobertura: 'Alteração de cobertura',
  alteracao_local: 'Alteração de local', alteracao_capital: 'Alteração de capital', outro: 'Outro',
};
const ENDORSEMENT_STATUS = {
  solicitado: { label: 'Solicitado', cls: C.blue }, em_analise: { label: 'Em análise', cls: C.violet }, aceito: { label: 'Aceito', cls: C.indigo },
  recusado: { label: 'Recusado', cls: C.red }, emitido: { label: 'Emitido', cls: C.green }, cancelado: { label: 'Cancelado', cls: C.gray },
};
const CANCEL_STATUS = {
  solicitado: { label: 'Cancelamento solicitado', cls: C.orange }, efetivado: { label: 'Cancelamento efetivado', cls: C.red },
  desistencia: { label: 'Desistência', cls: C.gray }, recusado: { label: 'Recusado pela seguradora', cls: C.gray },
};
const PAY_SOURCES = {
  informado: { cliente: 'Cliente (comprovante ou declaração)', corretora: 'Corretora (registro interno)' },
  confirmado: { seguradora_api: 'API da seguradora', arquivo_oficial: 'Arquivo oficial da seguradora', seguradora_portal: 'Consulta ao portal da seguradora' },
};
const METHODS = { boleto: 'Boleto', cartao: 'Cartão de crédito', debito: 'Débito em conta', pix: 'Pix', carne: 'Carnê', outro: 'Outro' };
const BASE_DEF = { premio_liquido: 'Prêmio líquido', premio_total: 'Prêmio total', outra: 'Outra (ver notas da regra)' };
const SPLIT_BASE = { comissao_bruta: 'Comissão bruta', comissao_liquida: 'Comissão líquida', recebimento_efetivo: 'Recebimento efetivo' };
const DOC_KINDS = {
  apolice: 'Apólice', certificado: 'Certificado', condicoes_gerais: 'Condições gerais', endosso: 'Endosso', boleto: 'Boleto / cobrança',
  comprovante: 'Comprovante', vistoria: 'Vistoria', contrato: 'Contrato', evidencia: 'Evidência', outro: 'Outro',
};
const SPECIAL_STATUS = { renegociada: 'Renegociada', cancelada: 'Cancelada', em_divergencia: 'Em divergência', restituida: 'Restituída (devolução confirmada)' };
const CONTRACTUAL = ['start_date', 'end_date', 'total_premium_cents', 'premium_net_cents', 'taxes_cents', 'coverages', 'insured_client_id', 'payer_client_id', 'policy_number'];

// ---------------- Utilitários ----------------
export function addMonthsYmd(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
/** Divide o total em N parcelas iguais; resíduo de centavos nas primeiras (ex.: 33,34 + 33,33 + 33,33). */
export function splitEven(total, n) {
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}
const isHttps = (u) => !u || /^https:\/\/[^\s]+$/i.test(u.trim());
const waShare = (phone, text) => waLink(phone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
const fmtVal = (v) => (typeof v === 'number' ? money(v) : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmt(v) : String(v ?? '—'));

function useCopy() {
  const { toast } = useUI();
  return async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch { toast('Não foi possível copiar; selecione o texto manualmente.', 'error'); }
  };
}

/** Busca de cliente (GET /v1/clients?q=). value = { id, name } | null. */
export function ClientPicker({ label, value, onChange, hint, placeholder = 'Buscar por nome ou CPF/CNPJ…' }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return undefined; }
    const t = setTimeout(() => api.get(`/v1/clients${qs({ q: q.trim() })}`).then((r) => setList(r || [])).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <Field label={label} hint={hint}>
        <div className="input flex items-center justify-between gap-2">
          <span className="truncate">{value.name}</span>
          <button type="button" className="text-xs font-medium text-primary" onClick={() => onChange(null)}>Trocar</button>
        </div>
      </Field>
    );
  }
  return (
    <div className="relative">
      <Input label={label} hint={hint} value={q} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && list.length > 0 && (
        <ul className="card absolute left-0 right-0 top-[4.1rem] z-30 max-h-64 overflow-auto py-1" role="listbox">
          {list.slice(0, 12).map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange({ id: c.id, name: c.name, phone: c.phone }); setQ(''); setOpen(false); }}>
                <span className="truncate">{c.name}</span><span className="shrink-0 text-xs text-ink-faint">{c.document_masked || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Editor de coberturas (limites e franquias: vazio = "não informado"). */
function CoverageEditor({ value, onChange, branch, disabled }) {
  const { meta } = useAuth();
  const catalog = meta?.coverage_catalog?.[branch] || [];
  const set = (i, k, v) => onChange(value.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const suggest = () => {
    const have = new Set(value.map((c) => c.code));
    onChange([...value, ...catalog.filter((c) => !have.has(c.code)).map((c) => ({ code: c.code, name: c.name, limit_cents: null, deductible_text: '', deductible_cents: null }))]);
  };
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-sm text-ink-faint">Nenhuma cobertura informada.</p>}
      {value.map((c, i) => (
        <div key={i} className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-12">
          <Input className="sm:col-span-4" label="Cobertura" value={c.name} disabled={disabled} onChange={(e) => set(i, 'name', e.target.value)} />
          <CentsInput className="sm:col-span-2" label="Limite (LMI)" value={c.limit_cents ?? null} disabled={disabled} onChange={(v) => set(i, 'limit_cents', v)} />
          <Input className="sm:col-span-3" label="Franquia (texto)" value={c.deductible_text || ''} placeholder="não informada" disabled={disabled} onChange={(e) => set(i, 'deductible_text', e.target.value)} />
          <CentsInput className="sm:col-span-2" label="Franquia (valor)" value={c.deductible_cents ?? null} disabled={disabled} onChange={(v) => set(i, 'deductible_cents', v)} />
          <div className="flex items-end sm:col-span-1">
            <button type="button" className="btn-ghost btn-icon" aria-label={`Remover ${c.name || 'cobertura'}`} disabled={disabled}
              onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={() => onChange([...value, { code: `cob_${Date.now().toString(36)}`, name: '', limit_cents: null, deductible_text: '', deductible_cents: null }])}>
            <Plus className="h-4 w-4" /> Adicionar cobertura</button>
          {catalog.length > 0 && <button type="button" className="btn-ghost" onClick={suggest}><Wand2 className="h-4 w-4" /> Sugerir do catálogo do ramo</button>}
        </div>
      )}
    </div>
  );
}
const cleanCoverages = (list) => list.filter((c) => (c.name || '').trim()).map((c) => ({
  code: String(c.code || c.name).slice(0, 60), name: c.name.trim(), limit_cents: c.limit_cents ?? null,
  deductible_text: (c.deductible_text || '').trim() || null, deductible_cents: c.deductible_cents ?? null,
}));

/** Editor de parcelas do prêmio com gerador de N parcelas iguais. */
function InstallmentEditor({ value, onChange, totalCents, startNumber = 1 }) {
  const [g, setG] = useState({ count: 1, first_due: ymd(), method: 'boleto', total: totalCents ?? null });
  useEffect(() => { setG((x) => ({ ...x, total: totalCents ?? x.total })); }, [totalCents]);
  const gen = () => {
    const n = Math.max(1, Math.min(120, Number(g.count) || 1));
    if (!g.total) return;
    onChange(splitEven(g.total, n).map((amount, i) => ({ number: startNumber + i, due_date: addMonthsYmd(g.first_due, i), amount_cents: amount, method: g.method, charge_url: '' })));
  };
  const set = (i, k, v) => onChange(value.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const sum = value.reduce((a, x) => a + (Number(x.amount_cents) || 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-app-sm bg-muted p-3 sm:grid-cols-5">
        <Input label="Quantidade" type="number" min={1} max={120} value={g.count} onChange={(e) => setG({ ...g, count: e.target.value })} />
        <Input label="1º vencimento" type="date" value={g.first_due} onChange={(e) => setG({ ...g, first_due: e.target.value })} />
        <Select label="Forma" value={g.method} onChange={(e) => setG({ ...g, method: e.target.value })}>
          {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <CentsInput label="Total a dividir" value={g.total} onChange={(v) => setG({ ...g, total: v })} />
        <div className="flex items-end"><button type="button" className="btn-outline w-full" onClick={gen} disabled={!g.total}><Wand2 className="h-4 w-4" /> Gerar</button></div>
        <p className="text-xs text-ink-faint sm:col-span-5">Gera parcelas iguais com o resíduo de centavos nas primeiras (ex.: R$ 100,00 em 3 = 33,34 + 33,33 + 33,33). Confira com o calendário informado pela seguradora.</p>
      </div>
      {value.map((x, i) => (
        <div key={i} className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-12">
          <Input className="sm:col-span-1" label="Nº" type="number" min={1} value={x.number} onChange={(e) => set(i, 'number', Number(e.target.value))} />
          <Input className="sm:col-span-3" label="Vencimento" type="date" value={x.due_date} onChange={(e) => set(i, 'due_date', e.target.value)} />
          <CentsInput className="sm:col-span-2" label="Valor" value={x.amount_cents} onChange={(v) => set(i, 'amount_cents', v)} />
          <Select className="sm:col-span-2" label="Forma" value={x.method || ''} onChange={(e) => set(i, 'method', e.target.value)}>
            <option value="">—</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input className="sm:col-span-3" label="Link oficial de cobrança (https)" value={x.charge_url || ''} placeholder="https://…" onChange={(e) => set(i, 'charge_url', e.target.value)} />
          <div className="flex items-end sm:col-span-1">
            <button type="button" className="btn-ghost btn-icon" aria-label={`Remover parcela ${x.number}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-ghost" onClick={() => onChange([...value, { number: startNumber + value.length, due_date: ymd(), amount_cents: null, method: 'boleto', charge_url: '' }])}>
          <Plus className="h-4 w-4" /> Parcela manual</button>
        {value.length > 0 && (
          <span className={cx('text-sm tabular-nums', totalCents != null && sum !== totalCents ? 'text-amber-600' : 'text-ink-soft')}>
            Soma das parcelas: {money(sum)}{totalCents != null && sum !== totalCents ? ` — difere do prêmio (${money(totalCents)})` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
const cleanInstallments = (list) => list.map((x) => ({
  number: Number(x.number), due_date: x.due_date, amount_cents: x.amount_cents, method: x.method || null, charge_url: (x.charge_url || '').trim() || null,
}));
const installmentsInvalid = (list) => {
  if (list.some((x) => !x.due_date || !(x.amount_cents > 0) || !(x.number >= 1))) return 'Cada parcela precisa de número, vencimento e valor.';
  if (list.some((x) => !isHttps(x.charge_url))) return 'O link de cobrança deve ser https (origem oficial da seguradora).';
  return null;
};

/** Versões de regra de comissão da seguradora (acordos → versões). */
function useRuleVersions(institutionId, enabled) {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    api.get('/v1/commissions/agreements').then(setList).catch(() => setList([]));
  }, [enabled]);
  return useMemo(() => (list || []).filter((a) => !institutionId || a.institution_id === institutionId)
    .flatMap((a) => (a.versions || []).map((v) => ({ ...v, agreement_name: a.name, agreement_branch: a.branch }))), [list, institutionId]);
}
const ruleLabel = (v) => `${v.agreement_name} · v${v.version} · ${v.kind === 'fixo' ? `fixo ${money(v.fixed_cents)}` : pct(v.rate)} · ${BASE_DEF[v.base_definition] || v.base_definition}`
  + ` · vigência ${fmt(v.valid_from)}${v.valid_to ? ` a ${fmt(v.valid_to)}` : ''}`;

// =====================================================================================
// Lista
// =====================================================================================
export default function Policies() {
  const { can, meta } = useAuth();
  const [params, setParams] = useSearchParams();
  const get = (k) => params.get(k) || '';
  const setP = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const [text, setText] = useState(get('q'));
  useEffect(() => { const t = setTimeout(() => { if (text.trim() !== get('q')) setP('q', text.trim()); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line
  const filters = { state: get('state'), doc_state: get('doc_state'), branch: get('branch'), institution_id: get('institution_id'), ending_within: get('ending_within'), q: get('q') };
  const { data, loading } = useFetch(() => api.get(`/v1/policies${qs(filters)}`), [params.toString()]);
  const { data: insts } = useFetch(() => api.get('/v1/catalog/institutions'), []);
  const branches = meta?.branches || BRANCHES;
  const t = useTable(data || [], { sort: 'end_date', dir: 'desc' });
  const exportCsv = () => downloadCSV('apolices.csv', (data || []).map((p) => ({
    apolice: p.policy_number || '', cliente: p.client_name, seguradora: p.institution_name, ramo: branches[p.branch] || p.branch, inicio: p.start_date, fim: p.end_date,
    estado_contratual: CONTRACT_STATE[p.contract_state]?.label || p.contract_state, estado_documental: DOC_STATE[p.doc_state]?.label || p.doc_state,
    premio_total: (p.total_premium_cents / 100).toFixed(2).replace('.', ','), renovada: p.renewed ? 'sim' : 'não',
  })));
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <div>
      <PageHeader title="Apólices" subtitle="Contratos, certificados e vigências — estado contratual e documental separados"
        actions={<>
          <button className="btn-ghost" onClick={exportCsv} disabled={!data?.length}><Download className="h-4 w-4" /> CSV</button>
          {can('policies_manage') && <Link to="/apolices/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova apólice</Link>}
        </>} />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Input label="Buscar" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nº da apólice, placa/identificador ou cliente" />
          <Search className="pointer-events-none absolute right-3 top-[2.1rem] h-4 w-4 text-ink-faint" />
        </div>
        <Select label="Estado contratual" value={filters.state} onChange={(e) => setP('state', e.target.value)}>
          <option value="">Todos</option>{Object.entries(CONTRACT_STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select label="Estado documental" value={filters.doc_state} onChange={(e) => setP('doc_state', e.target.value)}>
          <option value="">Todos</option>{Object.entries(DOC_STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select label="Ramo" value={filters.branch} onChange={(e) => setP('branch', e.target.value)}>
          <option value="">Todos</option>{Object.entries(branches).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Seguradora" value={filters.institution_id} onChange={(e) => setP('institution_id', e.target.value)}>
          <option value="">Todas</option>{(insts || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Select label="Vence em" value={filters.ending_within} onChange={(e) => setP('ending_within', e.target.value)}>
          <option value="">Qualquer data</option>{[15, 30, 60, 90, 180].map((d) => <option key={d} value={d}>Próximos {d} dias (vigentes)</option>)}
        </Select>
        {anyFilter && <div className="flex items-end"><button className="btn-ghost" onClick={() => { setText(''); setParams({}, { replace: true }); }}>Limpar filtros</button></div>}
      </div>

      {loading && !data ? <Loading /> : !data?.length ? (
        <div className="card"><Empty icon={FileText} title={anyFilter ? 'Nenhuma apólice com estes filtros' : 'Nenhuma apólice cadastrada'}
          text="Apólices entram pela conferência de uma proposta aceita ou por cadastro manual com a origem documentada."
          action={can('policies_manage') && <Link to="/apolices/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova apólice</Link>} /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="policy_number">Apólice</SortTh><SortTh t={t} k="client_name">Cliente</SortTh><SortTh t={t} k="institution_name">Seguradora</SortTh>
              <SortTh t={t} k="branch">Ramo</SortTh><SortTh t={t} k="end_date">Vigência</SortTh><th>Estado contratual</th><th>Estado documental</th>
              <SortTh t={t} k="total_premium_cents" className="text-right">Prêmio total</SortTh>
            </tr></thead>
            <tbody>
              {t.rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/apolices/${p.id}`} className="font-medium text-primary hover:underline">{p.policy_number || '(sem número)'}</Link>
                    {p.certificate_number && <div className="text-xs text-ink-faint">Cert. {p.certificate_number}</div>}
                    {p.renewed && <span className={cx('chip mt-1', C.indigo)}><Repeat className="h-3 w-3" /> Renovada</span>}
                  </td>
                  <td><Link to={`/clientes/${p.client_id}`} className="hover:underline">{p.client_name}</Link></td>
                  <td>{p.institution_name}</td>
                  <td>{branches[p.branch] || p.branch}{p.product_name && <div className="text-xs text-ink-faint">{p.product_name}</div>}</td>
                  <td className="whitespace-nowrap tabular-nums">{fmt(p.start_date)} – {fmt(p.end_date)}</td>
                  <td><StatusChip map={CONTRACT_STATE} value={p.contract_state} /></td>
                  <td><StatusChip map={DOC_STATE} value={p.doc_state} /></td>
                  <td className="text-right tabular-nums">{money(p.total_premium_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
    </div>
  );
}

// =====================================================================================
// Nova apólice (cadastro manual)
// =====================================================================================
export function PolicyNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { can, meta } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const branches = meta?.branches || BRANCHES;
  const { data: insts } = useFetch(() => api.get('/v1/catalog/institutions'), []);
  const [client, setClient] = useState(null);
  const [insured, setInsured] = useState(null);
  const [payer, setPayer] = useState(null);
  const [f, setF] = useState({
    institution_id: '', branch: params.get('branch') || 'auto', product_name: '', product_id: '', policy_number: '', certificate_number: '',
    start_date: ymd(), end_date: addMonthsYmd(ymd(), 12), start_time: '24:00', total_premium_cents: null, premium_net_cents: null, taxes_cents: null,
    payment_summary: '', previous_policy_id: '', source_evidence: '', notes: '',
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [coverages, setCoverages] = useState([]);
  const [items, setItems] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [doc, setDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [commission, setCommission] = useState({ rule_version_id: '', base_cents: null });
  const [clientPolicies, setClientPolicies] = useState([]);
  const [products, setProducts] = useState([]);
  const canCommission = can('commissions_rules');
  const versions = useRuleVersions(f.institution_id, canCommission);
  const selectedRule = versions.find((v) => v.id === commission.rule_version_id);

  // renovação: pré-preenche a partir da apólice anterior
  const renewalId = params.get('renewal');
  useEffect(() => {
    if (!renewalId) return;
    api.get(`/v1/policies/${renewalId}`).then((p) => {
      setClient({ id: p.client_id, name: p.client_name });
      if (p.insured_client_id && p.insured_client_id !== p.client_id) setInsured({ id: p.insured_client_id, name: p.insured_name });
      if (p.payer_client_id && p.payer_client_id !== p.client_id) setPayer({ id: p.payer_client_id, name: p.payer_name });
      setF((x) => ({ ...x, institution_id: p.institution_id, branch: p.branch, product_name: p.product_name || '', previous_policy_id: p.id,
        start_date: p.end_date, end_date: addMonthsYmd(p.end_date, 12) }));
      setCoverages((p.coverages || []).map((c) => ({ ...c, deductible_text: c.deductible_text || '' })));
      setItems((p.items || []).filter((i) => i.active !== false).map((i) => ({ kind: i.kind, description: i.description, identifier: i.identifier || '' })));
    }).catch(() => {});
  }, [renewalId]);
  const clientParam = params.get('client');
  useEffect(() => {
    if (!clientParam || renewalId) return;
    api.get(`/v1/clients/${clientParam}`).then((c) => setClient({ id: c.id, name: c.name })).catch(() => {});
  }, [clientParam, renewalId]);
  useEffect(() => {
    if (!client) { setClientPolicies([]); return; }
    api.get(`/v1/policies${qs({ client_id: client.id })}`).then(setClientPolicies).catch(() => setClientPolicies([]));
  }, [client?.id]); // eslint-disable-line
  useEffect(() => {
    if (!f.institution_id) { setProducts([]); return; }
    api.get(`/v1/catalog/products${qs({ branch: f.branch, institution_id: f.institution_id })}`).then(setProducts).catch(() => setProducts([]));
  }, [f.institution_id, f.branch]);
  useEffect(() => { setCommission((c) => ({ ...c, rule_version_id: '' })); }, [f.institution_id]);

  const pickProduct = (id) => {
    const pr = products.find((x) => x.id === id);
    setF((x) => ({ ...x, product_id: id, product_name: pr ? pr.name : x.product_name }));
    if (pr?.coverages?.length && !coverages.length) {
      setCoverages(pr.coverages.map((c) => ({ code: c.code, name: c.name, limit_cents: c.limit_cents ?? null, deductible_text: c.deductible || '', deductible_cents: null })));
    }
  };

  const upload = async (file) => {
    if (!client) { toast('Escolha o cliente antes de anexar o documento.', 'error'); return; }
    setUploading(true);
    try {
      const payload = await fileToPayload(file);
      const r = await run(() => api.post('/v1/documents', { entity: 'client', entity_id: client.id, client_id: client.id, kind: 'apolice', ...payload }), 'Documento anexado.');
      if (r !== FAIL) setDoc(r);
    } catch (e) { toast(e.message, 'error'); } finally { setUploading(false); }
  };

  const problems = [];
  if (!client) problems.push('cliente (contratante)');
  if (!f.institution_id) problems.push('seguradora');
  if ((f.product_name || '').trim().length < 2) problems.push('produto');
  if (!f.start_date || !f.end_date || f.end_date <= f.start_date) problems.push('vigência válida');
  if (f.total_premium_cents == null) problems.push('prêmio total');
  if ((f.source_evidence || '').trim().length < 3) problems.push('origem da informação');
  if (f.start_time && !/^\d{2}:\d{2}$/.test(f.start_time)) problems.push('hora no formato HH:MM');
  const instErr = installments.length ? installmentsInvalid(installments) : null;
  if (selectedRule?.kind === 'percentual' && commission.base_cents == null) problems.push('base comissionável documentada');

  const submit = async () => {
    const body = {
      client_id: client.id, institution_id: f.institution_id, branch: f.branch, product_name: f.product_name.trim(), product_id: f.product_id || null,
      policy_number: f.policy_number.trim() || null, certificate_number: f.certificate_number.trim() || null, start_date: f.start_date, end_date: f.end_date,
      ...(f.start_time ? { start_time: f.start_time } : {}),
      total_premium_cents: f.total_premium_cents, premium_net_cents: f.premium_net_cents, taxes_cents: f.taxes_cents, payment_summary: f.payment_summary.trim() || null,
      coverages: cleanCoverages(coverages), insured_client_id: insured?.id || null, payer_client_id: payer?.id || null,
      installments: cleanInstallments(installments),
      items: items.filter((i) => i.description.trim()).map((i) => ({ kind: i.kind, description: i.description.trim(), identifier: (i.identifier || '').trim().toUpperCase() || null })),
      document_id: doc?.id || null,
      commission: commission.rule_version_id ? { rule_version_id: commission.rule_version_id, ...(commission.base_cents != null ? { base_cents: commission.base_cents } : {}) } : null,
      previous_policy_id: f.previous_policy_id || null, source_evidence: f.source_evidence.trim(), notes: f.notes.trim() || null,
    };
    const r = await run(() => api.post('/v1/policies', body), 'Apólice cadastrada.');
    if (r !== FAIL) nav(`/apolices/${r.id}`);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/apolices" className="btn-ghost mb-2 -ml-2"><ArrowLeft className="h-4 w-4" /> Apólices</Link>
      <PageHeader title={renewalId ? 'Cadastrar apólice renovada' : 'Nova apólice'}
        subtitle="Cadastro manual a partir do documento da seguradora. Para propostas transmitidas, registre a apólice pela própria proposta (com conferência de divergências)." />
      <div className="space-y-4">
        <Section title="Partes do contrato" subtitle="Contratante, segurado e pagador podem ser pessoas diferentes">
          <div className="grid gap-4 sm:grid-cols-3">
            <ClientPicker label="Contratante (cliente) *" value={client} onChange={setClient} />
            <ClientPicker label="Segurado" value={insured} onChange={setInsured} hint="Vazio = o próprio contratante." />
            <ClientPicker label="Pagador do prêmio" value={payer} onChange={setPayer} hint="Vazio = o próprio contratante." />
          </div>
          <p className="mt-3 text-xs text-ink-faint">Ex.: empresa contrata (contratante), o sócio é o segurado e outra pessoa paga as parcelas. Os lembretes de parcela vão para o contato do cliente.</p>
        </Section>

        <Section title="Contrato">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Seguradora *" value={f.institution_id} onChange={(e) => set('institution_id', e.target.value)}>
              <option value="">Selecione…</option>{(insts || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
            <Select label="Ramo *" value={f.branch} onChange={(e) => set('branch', e.target.value)}>
              {Object.entries(branches).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {products.length > 0 ? (
              <Select label="Produto cadastrado" value={f.product_id} onChange={(e) => pickProduct(e.target.value)}>
                <option value="">Outro (digitar)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
              </Select>
            ) : <div className="hidden lg:block" />}
            <Input label="Nome do produto *" value={f.product_name} onChange={(e) => set('product_name', e.target.value)} />
            <Input label="Nº da apólice" value={f.policy_number} onChange={(e) => set('policy_number', e.target.value)} hint="Pode ficar vazio enquanto o documento não chega." />
            <Input label="Nº do certificado" value={f.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} />
            <Input label="Início de vigência *" type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />
            <Input label="Fim de vigência *" type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} />
            <Input label="Hora de início" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} placeholder="24:00" hint="HH:MM, conforme o documento (padrão 24:00)." />
          </div>
        </Section>

        <Section title="Prêmio" subtitle="Valores do documento. Vazio = não informado (nunca zero).">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CentsInput label="Prêmio total *" value={f.total_premium_cents} onChange={(v) => set('total_premium_cents', v)} />
            <CentsInput label="Prêmio líquido" value={f.premium_net_cents} onChange={(v) => set('premium_net_cents', v)} />
            <CentsInput label="IOF / tributos" value={f.taxes_cents} onChange={(v) => set('taxes_cents', v)} />
            <Input label="Forma de pagamento contratada" value={f.payment_summary} onChange={(e) => set('payment_summary', e.target.value)} placeholder="Ex.: boleto 6x sem juros" />
          </div>
        </Section>

        <Section title="Coberturas, limites e franquias">
          <CoverageEditor value={coverages} onChange={setCoverages} branch={f.branch} />
        </Section>

        <Section title="Itens segurados" subtitle="Veículos, imóveis, vidas, bens ou locais">
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-12">
                <Select className="sm:col-span-3" label="Tipo" value={it.kind} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                  {Object.entries(ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Input className="sm:col-span-5" label="Descrição" value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input className="sm:col-span-3" label="Placa / identificador" value={it.identifier} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, identifier: e.target.value } : x)))} />
                <div className="flex items-end sm:col-span-1"><button type="button" className="btn-ghost btn-icon" aria-label="Remover item" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></div>
              </div>
            ))}
            <button type="button" className="btn-outline" onClick={() => setItems([...items, { kind: f.branch === 'auto' || f.branch === 'frota' ? 'veiculo' : f.branch.startsWith('vida') ? 'vida' : 'imovel', description: '', identifier: '' }])}>
              <Plus className="h-4 w-4" /> Adicionar item</button>
          </div>
        </Section>

        <Section title="Parcelas do prêmio" subtitle="Calendário informado pela seguradora — o prêmio é pago à seguradora, não à corretora">
          <InstallmentEditor value={installments} onChange={setInstallments} totalCents={f.total_premium_cents} />
          {instErr && <Notice tone="warn" className="mt-3">{instErr}</Notice>}
        </Section>

        <Section title="Documento da apólice">
          <div className="flex flex-wrap items-center gap-3">
            <FileButton accept="application/pdf,image/*" onFile={upload} disabled={uploading || !client}>
              {uploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {doc ? 'Substituir arquivo' : 'Anexar apólice (PDF/imagem)'}
            </FileButton>
            {doc && <span className="text-sm"><FileText className="mr-1 inline h-4 w-4 text-ink-faint" />{doc.filename}</span>}
            {!client && <span className="text-xs text-ink-faint">Escolha o cliente primeiro.</span>}
          </div>
          <p className="mt-2 text-xs text-ink-faint">Com documento anexado, a apólice entra como "Recebido — conferir"; sem documento, "Aguardando documento".</p>
        </Section>

        {canCommission && (
          <Section title="Comissão (regra vigente na contratação)" subtitle="Opcional — o plano de comissão também pode ser aplicado depois, na aba Comissão">
            {!f.institution_id ? <p className="text-sm text-ink-faint">Escolha a seguradora para ver as regras.</p> : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Versão da regra" value={commission.rule_version_id} onChange={(e) => setCommission({ ...commission, rule_version_id: e.target.value })}>
                  <option value="">Não aplicar agora</option>{versions.map((v) => <option key={v.id} value={v.id}>{ruleLabel(v)}</option>)}
                </Select>
                <CentsInput label={`Base comissionável documentada${selectedRule?.kind === 'percentual' ? ' *' : ''}`} value={commission.base_cents}
                  onChange={(v) => setCommission({ ...commission, base_cents: v })}
                  hint="Informe a base conforme o documento/acordo. O sistema não presume o prêmio líquido." />
                {selectedRule && <p className="text-xs text-ink-faint sm:col-span-2">Base da regra: {BASE_DEF[selectedRule.base_definition]}{selectedRule.base_notes ? ` — ${selectedRule.base_notes}` : ''}. {selectedRule.schedule === 'parcelada' ? `Parcelada em ${selectedRule.installments}x.` : 'Pagamento único.'}</p>}
                {versions.length === 0 && <p className="text-sm text-ink-faint sm:col-span-2">Nenhuma regra cadastrada para esta seguradora (Comissões → Acordos).</p>}
              </div>
            )}
          </Section>
        )}

        <Section title="Origem e observações">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Renovação de (apólice anterior)" value={f.previous_policy_id} onChange={(e) => set('previous_policy_id', e.target.value)} disabled={!client}>
              <option value="">Não é renovação</option>
              {clientPolicies.map((p) => <option key={p.id} value={p.id}>{p.policy_number || '(sem número)'} · {branches[p.branch] || p.branch} · até {fmt(p.end_date)}</option>)}
            </Select>
            <Input label="Origem da informação *" value={f.source_evidence} onChange={(e) => set('source_evidence', e.target.value)}
              placeholder="Ex.: PDF da apólice enviado pela seguradora em 05/10" hint="Obrigatório: de onde vieram os dados (documento, portal, importação…)." />
            <Textarea className="sm:col-span-2" label="Observações" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </Section>

        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <span className="text-sm text-ink-faint">{problems.length ? `Falta: ${problems.join(', ')}.` : instErr || 'Pronto para cadastrar.'}</span>
          <div className="flex gap-2">
            <Link to="/apolices" className="btn-ghost">Cancelar</Link>
            <SubmitButton busy={busy} problems={[...problems.map((x) => `Falta: ${x}.`), instErr]} onClick={submit}>{busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} Cadastrar apólice</SubmitButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================================
// Detalhe
// =====================================================================================
export function PolicyDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const { data: p, loading, reload } = useFetch(() => api.get(`/v1/policies/${id}`), [id]);
  const tab = params.get('tab') || 'resumo';
  const setTab = (v) => setParams((x) => { const n = new URLSearchParams(x); n.set('tab', v); return n; }, { replace: true });
  const [modal, setModal] = useState(null);

  if (loading && !p) return <Loading />;
  if (!p) return <Empty title="Apólice não encontrada" action={<Link to="/apolices" className="btn-outline">Voltar</Link>} />;

  const tabs = [
    { value: 'resumo', label: 'Resumo' }, { value: 'impressa', label: 'Versão impressa' }, { value: 'itens', label: `Itens (${p.items.length})` }, { value: 'parcelas', label: `Parcelas do seguro (${p.installments.length})` },
    p.commissions !== null && { value: 'comissao', label: 'Comissão' }, p.splits !== null && { value: 'repasses', label: 'Repasses' },
    { value: 'endossos', label: `Endossos (${p.endorsements.length})` }, { value: 'cancelamento', label: 'Cancelamento' },
    { value: 'sinistros', label: `Sinistros (${p.claims.length})` }, { value: 'documentos', label: 'Documentos' }, { value: 'versoes', label: 'Versões' }, { value: 'renovacao', label: 'Renovação' },
  ].filter(Boolean);
  const live = p.installments.filter((i) => !['cancelada', 'restituida'].includes(i.status));
  const fin = {
    overdue: live.filter((i) => i.status === 'vencida').length,
    informed: live.filter((i) => i.status === 'pagamento_informado').length,
    divergent: live.filter((i) => i.status === 'em_divergencia').length,
    balance: live.reduce((a, i) => a + Number(i.balance_cents || 0), 0),
    paid: live.filter((i) => i.status === 'pagamento_confirmado').length,
  };
  const canVerify = can('policies_verify') && ['recebido', 'divergente'].includes(p.doc_state);

  return (
    <div>
      <Link to="/apolices" className="btn-ghost mb-2 -ml-2"><ArrowLeft className="h-4 w-4" /> Apólices</Link>
      <PageHeader title={`Apólice ${p.policy_number || '(sem número)'}`}
        subtitle={<><Link to={`/clientes/${p.client_id}`} className="hover:underline">{p.client_name}</Link> · {p.institution_name} · {p.branch_label}{p.product_name ? ` · ${p.product_name}` : ''}</>}
        actions={<>
          {canVerify && <button className="btn-primary" onClick={() => setModal('verify')}><FileCheck2 className="h-4 w-4" /> Conferir documento</button>}
          {can('policies_manage') && <button className="btn-outline" onClick={() => setModal('edit')}><Pencil className="h-4 w-4" /> Editar</button>}
          {can('policies_manage') && !['cancelada', 'renovada'].includes(p.contract_state) && <button className="btn-ghost" onClick={() => setModal('status')}><Settings2 className="h-4 w-4" /> Estado contratual</button>}
        </>} />

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Estado contratual</div>
          <div className="mt-2 flex flex-wrap items-center gap-2"><StatusChip map={CONTRACT_STATE} value={p.contract_state} />
            {p.status_source === 'manual' && p.status_reason && <span className={cx('chip', C.amber)}>Origem manual</span>}</div>
          <div className="mt-1.5 text-xs text-ink-faint">Vigência {fmt(p.start_date)} – {fmt(p.end_date)}{p.status_reason ? ` · ${p.status_reason}` : ''}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Estado do documento</div>
          <div className="mt-2"><StatusChip map={DOC_STATE} value={p.doc_state} /></div>
          <div className="mt-1.5 text-xs text-ink-faint">{p.verified_at ? `Conferido em ${fmtDateTime(p.verified_at)}` : p.doc_state === 'aguardando_documento' ? 'Anexe o documento emitido pela seguradora.' : 'Conferência pendente.'}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Situação das parcelas (prêmio pago à seguradora)</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {fin.overdue > 0 && <span className={cx('chip', C.red)}>{fin.overdue} vencida(s)</span>}
            {fin.informed > 0 && <span className={cx('chip', C.violet)}>{fin.informed} informada(s), em conferência</span>}
            {fin.divergent > 0 && <span className={cx('chip', C.orange)}>{fin.divergent} em divergência</span>}
            {!fin.overdue && !fin.informed && !fin.divergent && <span className={cx('chip', live.length ? C.green : C.gray)}>{live.length ? 'Sem pendências' : 'Sem parcelas cadastradas'}</span>}
          </div>
          <div className="mt-1.5 text-xs text-ink-faint">{fin.paid}/{live.length} confirmadas · saldo em aberto {money(fin.balance)}</div>
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'resumo' && <SummaryTab p={p} onEndorse={() => setTab('endossos')} />}
      {tab === 'impressa' && <Suspense fallback={<Loading />}><PolicyPrintTab p={p} /></Suspense>}
      {tab === 'itens' && <ItemsTab p={p} reload={reload} />}
      {tab === 'parcelas' && <InstallmentsTab p={p} reload={reload} />}
      {tab === 'comissao' && p.commissions !== null && <CommissionTab p={p} reload={reload} />}
      {tab === 'repasses' && p.splits !== null && <SplitsTab p={p} reload={reload} />}
      {tab === 'endossos' && <EndorsementsTab p={p} reload={reload} />}
      {tab === 'cancelamento' && <CancellationTab p={p} reload={reload} />}
      {tab === 'sinistros' && <ClaimsTab p={p} />}
      {tab === 'documentos' && <DocumentsTab p={p} />}
      {tab === 'versoes' && <VersionsTab p={p} />}
      {tab === 'renovacao' && <RenewalTab p={p} />}

      <VerifyModal open={modal === 'verify'} p={p} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />
      {modal === 'status' && <StatusModal p={p} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'edit' && <EditModal p={p} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} onEndorse={() => { setModal(null); setTab('endossos'); }} />}
    </div>
  );
}

// ---------------- Resumo ----------------
function SummaryTab({ p, onEndorse }) {
  const nameOr = (n, idv) => (idv === p.client_id ? `${n} (o próprio contratante)` : n);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="Dados do contrato">
          <KV items={[
            ['Nº da apólice', p.policy_number || 'não informado'], ['Certificado', p.certificate_number || '—'],
            ['Seguradora', p.institution_name], ['Ramo / produto', `${p.branch_label}${p.product_name ? ` — ${p.product_name}` : ''}`],
            ['Início de vigência', `${fmt(p.start_date)} às ${p.start_time || '24:00'}`], ['Fim de vigência', `${fmt(p.end_date)} às ${p.start_time || '24:00'}`],
            ['Fuso', p.timezone || '—'], ['Prêmio total', money(p.total_premium_cents)], ['Prêmio líquido', moneyOrNA(p.premium_net_cents)],
            ['IOF / tributos', moneyOrNA(p.taxes_cents)], ['Forma de pagamento', p.payment_summary || 'não informada'],
            ['Unidade', p.unit_name || '—'], ['Origem do cadastro', p.source === 'proposta' ? 'Proposta transmitida' : p.source === 'manual' ? 'Cadastro manual' : p.source || '—'],
            ['Versão atual', `v${p.version}`],
          ]} />
          {p.notes && <div className="mt-4 whitespace-pre-line rounded-app-sm bg-muted p-3 text-sm">{p.notes}</div>}
        </Section>
        <Section title="Coberturas, limites e franquias" actions={p.doc_state === 'conferido' && <button className="btn-ghost" onClick={onEndorse}>Alterar por endosso</button>}>
          {!p.coverages?.length ? <p className="text-sm text-ink-faint">Nenhuma cobertura informada.</p> : (
            <div className="-m-4 overflow-x-auto">
              <table className="table-clean">
                <thead><tr><th>Cobertura</th><th className="text-right">Limite</th><th>Franquia</th></tr></thead>
                <tbody>{p.coverages.map((c, i) => (
                  <tr key={c.code || i}><td>{c.name}</td><td className="text-right tabular-nums">{moneyOrNA(c.limit_cents)}</td>
                    <td>{c.deductible_text || (c.deductible_cents != null ? money(c.deductible_cents) : 'não informado')}{c.deductible_text && c.deductible_cents != null ? ` (${money(c.deductible_cents)})` : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Partes">
          <KV cols={1} items={[
            ['Contratante', <Link key="c" to={`/clientes/${p.client_id}`} className="text-primary hover:underline">{p.client_name}</Link>],
            ['Segurado', nameOr(p.insured_name || p.client_name, p.insured_client_id)],
            ['Pagador do prêmio', nameOr(p.payer_name || p.client_name, p.payer_client_id)],
          ]} />
          <p className="mt-3 text-xs text-ink-faint">Contratante, segurado e pagador podem ser pessoas diferentes.</p>
        </Section>
        {p.assistance_phone && <Section title="Assistência da seguradora"><p className="text-sm">{p.assistance_phone}</p><p className="mt-1 text-xs text-ink-faint">Contato oficial cadastrado. O APOLVEN não aciona assistência.</p></Section>}
        <Section title="Proposta de origem">
          {!p.proposal ? <p className="text-sm text-ink-faint">Cadastro sem proposta vinculada.</p> : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Link to={`/propostas/${p.proposal.id}`} className="font-medium text-primary hover:underline">Proposta nº {p.proposal.number}</Link>
                <StatusChip map={PROPOSAL_STATUS} value={p.proposal.status} /></div>
              {p.proposal.authorized_total != null && <div className="text-ink-soft">Prêmio autorizado: {money(Number(p.proposal.authorized_total))}</div>}
              {p.proposal.divergences?.length > 0 ? (
                <div>
                  <div className="mb-1 font-medium text-red-700 dark:text-red-300">Divergências entre autorizado e emitido</div>
                  <ul className="space-y-1">{p.proposal.divergences.map((d, i) => (
                    <li key={i} className="rounded-app-sm bg-red-500/5 px-2 py-1"><b>{d.field}</b>: autorizado {fmtVal(d.authorized)} · emitido {fmtVal(d.issued)}</li>
                  ))}</ul>
                </div>
              ) : <div className="text-ink-faint">Sem divergências registradas.</div>}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function VerifyModal({ open, p, onClose, onDone }) {
  const [run, busy] = useAction();
  const [needRes, setNeedRes] = useState(false);
  const [res, setRes] = useState('');
  useEffect(() => { if (open) { setNeedRes(p.doc_state === 'divergente'); setRes(''); } }, [open, p.doc_state]);
  const go = async () => {
    const r = await run(() => api.post(`/v1/policies/${p.id}/verify`, { resolution: res.trim() || null }), 'Documento conferido.', (e) => {
      if (e.code === 'DIVERGENCE_OPEN') { setNeedRes(true); return true; }
      return false;
    });
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open={open} onClose={onClose} title="Conferir documento emitido" subtitle="Confirma que o documento da seguradora confere com o contratado"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn-primary" disabled={busy || (needRes && res.trim().length < 3)} onClick={go}><FileCheck2 className="h-4 w-4" /> Marcar como conferido</button></>}>
      <div className="space-y-3">
        {needRes ? (
          <Notice tone="danger">Há divergência entre o documento emitido e a versão autorizada{p.proposal?.divergences?.length ? ` (${p.proposal.divergences.length})` : ''}. Registre como foi resolvida (endosso solicitado, aceite do cliente…) para concluir a conferência.</Notice>
        ) : <p className="text-sm text-ink-soft">Depois de conferida, alterações contratuais da apólice passam a exigir endosso.</p>}
        {needRes && <Textarea label="Resolução da divergência *" value={res} onChange={(e) => setRes(e.target.value)} rows={4} />}
      </div>
    </Modal>
  );
}

function StatusModal({ p, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ contract_state: p.contract_state === 'vigente' ? 'suspensa' : 'vigente', reason: '', evidence: '' });
  const ok = f.reason.trim().length >= 5 && f.evidence.trim().length >= 3;
  return (
    <Modal open onClose={onClose} title="Alterar estado contratual" subtitle="Alteração manual — exige justificativa e evidência; a origem manual fica identificada"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} problems={[f.reason.trim().length < 5 && { text: 'Informe a justificativa (mín. 5 caracteres).', field: 'Justificativa' }, f.evidence.trim().length < 3 && { text: 'Informe a evidência.', field: 'Evidência' }]} onClick={async () => { const r = await run(() => api.post(`/v1/policies/${p.id}/status`, f), 'Estado contratual atualizado.'); if (r !== FAIL) onDone(); }}>Salvar</SubmitButton></>}>
      <div className="space-y-3">
        <Notice tone="warn">Atraso isolado de parcela não suspende nem cancela cobertura. Use somente com fundamento contratual e evidência (comunicado da seguradora, consulta ao portal…). Cancelamento tem fluxo próprio.</Notice>
        <div className="text-sm">Atual: <StatusChip map={CONTRACT_STATE} value={p.contract_state} /></div>
        <Select label="Novo estado" value={f.contract_state} onChange={(e) => setF({ ...f, contract_state: e.target.value })}>
          <option value="vigente">Vigente</option><option value="suspensa">Suspensa</option><option value="vencida">Vencida</option>
        </Select>
        <Textarea label="Justificativa * (mín. 5 caracteres)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <Input label="Evidência *" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="Ex.: comunicado da seguradora de 03/10, protocolo 123" />
      </div>
    </Modal>
  );
}

function EditModal({ p, onClose, onDone, onEndorse }) {
  const [run, busy] = useAction();
  const locked = p.doc_state === 'conferido';
  const init = {
    policy_number: p.policy_number || '', certificate_number: p.certificate_number || '', product_name: p.product_name || '', start_date: p.start_date, end_date: p.end_date,
    start_time: p.start_time || '', total_premium_cents: p.total_premium_cents, premium_net_cents: p.premium_net_cents, taxes_cents: p.taxes_cents,
    payment_summary: p.payment_summary || '', notes: p.notes || '',
  };
  const [f, setF] = useState(init);
  const [cov, setCov] = useState((p.coverages || []).map((c) => ({ ...c, deductible_text: c.deductible_text || '' })));
  const [insured, setInsured] = useState(p.insured_client_id ? { id: p.insured_client_id, name: p.insured_name } : null);
  const [payer, setPayer] = useState(p.payer_client_id ? { id: p.payer_client_id, name: p.payer_name } : null);
  const [reason, setReason] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const diff = () => {
    const out = {};
    for (const k of Object.keys(init)) {
      if (locked && CONTRACTUAL.includes(k)) continue;
      if (f[k] !== init[k]) {
        if (['policy_number', 'certificate_number', 'payment_summary', 'notes'].includes(k)) out[k] = f[k].trim() || null;
        else if (k === 'start_time') { if (f[k]) out[k] = f[k]; } else out[k] = f[k];
      }
    }
    if (!locked) {
      const cc = cleanCoverages(cov);
      if (JSON.stringify(cc) !== JSON.stringify(cleanCoverages((p.coverages || []).map((c) => ({ ...c, deductible_text: c.deductible_text || '' }))))) out.coverages = cc;
      if ((insured?.id || null) !== (p.insured_client_id || null) && insured) out.insured_client_id = insured.id;
      if ((payer?.id || null) !== (p.payer_client_id || null) && payer) out.payer_client_id = payer.id;
    }
    return out;
  };
  const changes = diff();
  const n = Object.keys(changes).length;
  const save = async () => {
    if (changes.total_premium_cents === null) delete changes.total_premium_cents;
    const r = await run(() => api.put(`/v1/policies/${p.id}`, { ...changes, reason: reason.trim(), version: p.version }), 'Apólice atualizada (nova versão registrada).');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Editar apólice" subtitle="Toda alteração gera nova versão com motivo"
      footer={<><span className="mr-auto text-xs text-ink-faint">{n} campo(s) alterado(s)</span><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} onClick={save} problems={[!n && 'Nenhuma alteração para salvar.', reason.trim().length < 3 && { text: 'Informe o motivo da alteração.', field: 'Motivo da alteração' }]}>Salvar alterações</SubmitButton></>}>
      <div className="space-y-4">
        {locked && (
          <Notice tone="warn">
            Apólice conferida: dados contratuais (número, vigência, prêmio, coberturas, segurado e pagador) não são sobrescritos — <button className="font-semibold underline" onClick={onEndorse}>use endosso</button>.
            Aqui só é possível ajustar dados cadastrais.
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nº da apólice" value={f.policy_number} disabled={locked} onChange={(e) => set('policy_number', e.target.value)} />
          <Input label="Nº do certificado" value={f.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} />
          <Input label="Produto" value={f.product_name} onChange={(e) => set('product_name', e.target.value)} />
          <Input label="Hora de início (HH:MM)" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} />
          <Input label="Início de vigência" type="date" value={f.start_date} disabled={locked} onChange={(e) => set('start_date', e.target.value)} />
          <Input label="Fim de vigência" type="date" value={f.end_date} disabled={locked} onChange={(e) => set('end_date', e.target.value)} />
          <CentsInput label="Prêmio total" value={f.total_premium_cents} disabled={locked} allowEmpty={false} onChange={(v) => set('total_premium_cents', v)} />
          <CentsInput label="Prêmio líquido" value={f.premium_net_cents} disabled={locked} onChange={(v) => set('premium_net_cents', v)} />
          <CentsInput label="IOF / tributos" value={f.taxes_cents} disabled={locked} onChange={(v) => set('taxes_cents', v)} />
          <Input label="Forma de pagamento" value={f.payment_summary} onChange={(e) => set('payment_summary', e.target.value)} />
          {!locked && <ClientPicker label="Segurado" value={insured} onChange={setInsured} />}
          {!locked && <ClientPicker label="Pagador" value={payer} onChange={setPayer} />}
          <Textarea className="sm:col-span-2" label="Observações" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {!locked && <div><div className="label">Coberturas</div><CoverageEditor value={cov} onChange={setCov} branch={p.branch} /></div>}
        <Textarea label="Motivo da alteração *" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: correção do nº do certificado conforme PDF" />
      </div>
    </Modal>
  );
}

// ---------------- Itens ----------------
function ItemsTab({ p, reload }) {
  const { can } = useAuth();
  const [run, busy] = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'veiculo', description: '', identifier: '', start_date: '', end_date: '' });
  const add = async () => {
    const r = await run(() => api.post(`/v1/policies/${p.id}/items`, { kind: f.kind, description: f.description.trim(), identifier: f.identifier.trim().toUpperCase() || null,
      start_date: f.start_date || null, end_date: f.end_date || null }), 'Item incluído.');
    if (r !== FAIL) { setOpen(false); setF({ kind: f.kind, description: '', identifier: '', start_date: '', end_date: '' }); reload(); }
  };
  return (
    <Section title="Itens segurados" subtitle="Veículos, vidas, imóveis, bens e locais vinculados ao contrato"
      actions={can('policies_manage') && <button className="btn-outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Incluir item</button>} bodyClass="p-0">
      {!p.items.length ? <Empty title="Nenhum item cadastrado" /> : (
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Tipo</th><th>Descrição</th><th>Identificador</th><th>Período</th><th>Situação</th></tr></thead>
            <tbody>{p.items.map((it) => (
              <tr key={it.id}><td>{ITEM_KINDS[it.kind] || it.kind}</td><td>{it.description}</td><td className="font-mono text-xs">{it.identifier || '—'}</td>
                <td className="whitespace-nowrap">{it.start_date || it.end_date ? `${fmt(it.start_date)} – ${fmt(it.end_date)}` : 'Vigência da apólice'}</td>
                <td><span className={cx('chip', it.active === false ? C.gray : C.green)}>{it.active === false ? 'Inativo' : 'Ativo'}</span></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Incluir item"
        subtitle={p.doc_state === 'conferido' ? 'Apólice conferida: inclusões que alteram o risco devem ter endosso correspondente.' : undefined}
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Voltar</button><button className="btn-primary" disabled={busy || f.description.trim().length < 2} onClick={add}>Incluir</button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input label="Placa / identificador" value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} />
          <Input className="sm:col-span-2" label="Descrição *" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Input label="Início (se diferente da apólice)" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
          <Input label="Fim" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </div>
      </Modal>
    </Section>
  );
}

// ---------------- Parcelas do seguro ----------------
export const PREMIUM_BANNER = 'O prêmio é pago pelo cliente diretamente à seguradora: não é receita da corretora. "Pagamento informado" (pelo cliente ou pela equipe) não é "pagamento confirmado" pela seguradora.';

function InstallmentsTab({ p, reload }) {
  const { can, feature } = useAuth();
  const [act, setAct] = useState(null); // { kind, inst }
  const [modal, setModal] = useState(null);
  const close = () => { setAct(null); setModal(null); };
  const done = () => { close(); reload(); };
  const hasBase = p.installments.some((i) => !i.endorsement_id);
  const endorsementNo = (eid) => p.endorsements.find((e) => e.id === eid)?.number;
  return (
    <div className="space-y-4">
      <Notice tone="info"><Info className="mr-1 inline h-4 w-4" />{PREMIUM_BANNER}</Notice>
      <Section title="Parcelas do prêmio" subtitle="Situação conforme a última informação da fonte — veja quando cada parcela foi atualizada" bodyClass="p-0"
        actions={<>
          {can('installments') && feature('portal_cliente') && <button className="btn-ghost" onClick={() => setModal('portal')}><Link2 className="h-4 w-4" /> Link do portal (parcelas)</button>}
          {can('policies_manage') && !hasBase && <button className="btn-outline" onClick={() => setModal('plan')}><Wand2 className="h-4 w-4" /> Gerar plano</button>}
          {can('policies_manage') && <button className="btn-outline" onClick={() => setModal('add')}><Plus className="h-4 w-4" /> Adicionar parcelas</button>}
        </>}>
        {!p.installments.length ? <Empty title="Nenhuma parcela cadastrada" text="Cadastre o calendário informado pela seguradora." /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th className="text-right">Valor</th><th className="text-right">Confirmado</th><th className="text-right">Informado (a conferir)</th>
                <th className="text-right">Saldo</th><th>Situação</th><th>Atualizado</th><th>Cobrança</th><th /></tr></thead>
              <tbody>{p.installments.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap">{i.number}/{i.total_count || '?'}{i.endorsement_id && <div className="text-xs text-ink-faint">Endosso nº {endorsementNo(i.endorsement_id) ?? '—'}</div>}</td>
                  <td className="whitespace-nowrap">{fmt(i.due_date)}{i.method && <div className="text-xs text-ink-faint">{METHODS[i.method] || i.method}</div>}</td>
                  <td className="text-right tabular-nums">{money(i.due_total_cents)}</td>
                  <td className="text-right tabular-nums">{money(i.confirmed_cents)}</td>
                  <td className="text-right tabular-nums">{Number(i.informed_pending_cents) ? money(i.informed_pending_cents) : '—'}</td>
                  <td className="text-right font-medium tabular-nums">{money(i.balance_cents)}</td>
                  <td>
                    <StatusChip map={INSTALLMENT_STATUS} value={i.status} />
                    {i.overdue_days > 0 && <div className="text-xs text-red-600">{i.overdue_days} dia(s) de atraso</div>}
                    {i.status_reason && <div className="max-w-[14rem] text-xs text-ink-faint">{i.status_reason}</div>}
                    {i.reminders_paused && <div className="text-xs text-ink-faint">Lembretes pausados</div>}
                  </td>
                  <td className="whitespace-nowrap text-xs text-ink-faint" title={fmtDateTime(i.last_update_at)}>{ago(i.last_update_at)}{i.source ? ` · ${i.source}` : ''}</td>
                  <td>{i.charge_url ? <a href={i.charge_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Abrir <ExternalLink className="h-3 w-3" /></a>
                    : <span className="text-xs text-ink-faint">{i.charge_ref || 'sem link'}</span>}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {can('installments') && !['cancelada', 'restituida', 'pagamento_confirmado'].includes(i.status) &&
                        <button className="btn-ghost btn-icon" title="Registrar pagamento" aria-label={`Registrar pagamento da parcela ${i.number}`} onClick={() => setAct({ kind: 'pay', inst: i })}><CreditCard className="h-4 w-4" /></button>}
                      {can('installments') && ['aberta', 'proxima_vencimento', 'vencida', 'parcial'].includes(i.status) && !i.reminders_paused &&
                        <button className="btn-ghost btn-icon" title="Lembrete por WhatsApp" aria-label={`Lembrete da parcela ${i.number}`} onClick={() => setAct({ kind: 'remind', inst: i })}><Bell className="h-4 w-4" /></button>}
                      {can('installments') && <button className="btn-ghost btn-icon" title="Atualizar cobrança" aria-label={`Atualizar cobrança da parcela ${i.number}`} onClick={() => setAct({ kind: 'charge', inst: i })}><RefreshCw className="h-4 w-4" /></button>}
                      {can('installments_confirm') && <button className="btn-ghost btn-icon" title="Estado especial" aria-label={`Estado especial da parcela ${i.number}`} onClick={() => setAct({ kind: 'special', inst: i })}><Settings2 className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>
      {act?.kind === 'pay' && <PaymentModal inst={act.inst} clientId={p.client_id} onClose={close} onDone={done} />}
      {act?.kind === 'remind' && <ReminderModal inst={act.inst} onClose={close} />}
      {act?.kind === 'charge' && <ChargeModal inst={act.inst} onClose={close} onDone={done} />}
      {act?.kind === 'special' && <SpecialStatusModal inst={act.inst} onClose={close} onDone={done} />}
      {modal === 'add' && <AddInstallmentsModal p={p} onClose={close} onDone={done} />}
      {modal === 'plan' && <PlanModal p={p} onClose={close} onDone={done} />}
      {modal === 'portal' && <PortalLinkModal p={p} onClose={close} />}
    </div>
  );
}

/** Registro de pagamento: informado (cria conferência) ou confirmado (fonte oficial, permissão própria). */
export function PaymentModal({ inst, clientId, onClose, onDone }) {
  const { can } = useAuth();
  const { toast } = useUI();
  const canConfirm = can('installments_confirm');
  const [run, busy] = useAction();
  const [key] = useState(() => idemKey('pagto'));
  const [f, setF] = useState({ kind: 'informado', amount_cents: inst.balance_cents || null, paid_date: ymd(), source: 'cliente', evidence: '', confirms_payment_id: '' });
  const [doc, setDoc] = useState(null);
  const [up, setUp] = useState(false);
  const [pending, setPending] = useState([]);
  useEffect(() => {
    api.get(`/v1/premium-installments/${inst.id}`).then((d) => {
      const all = (d.payments || []).filter((x) => !x.voided_at);
      const confirmedRefs = new Set(all.filter((x) => x.confirms_payment_id).map((x) => x.confirms_payment_id));
      setPending(all.filter((x) => x.kind === 'informado' && !confirmedRefs.has(x.id)));
    }).catch(() => {});
  }, [inst.id]);
  const setKind = (kind) => setF((x) => ({ ...x, kind, source: Object.keys(PAY_SOURCES[kind])[0], confirms_payment_id: '' }));
  const upload = async (file) => {
    setUp(true);
    try {
      const payload = await fileToPayload(file);
      const r = await run(() => api.post('/v1/documents', { entity: 'premium_installment', entity_id: inst.id, client_id: clientId || inst.client_id || null, kind: 'comprovante', ...payload }), 'Comprovante anexado.');
      if (r !== FAIL) setDoc(r);
    } catch (e) { toast(e.message, 'error'); } finally { setUp(false); }
  };
  const confirmed = f.kind === 'confirmado';
  const ok = f.amount_cents > 0 && f.paid_date && f.paid_date <= ymd() && (!confirmed || f.evidence.trim().length >= 3) && (!confirmed || f.amount_cents <= inst.balance_cents);
  const save = async () => {
    const body = { kind: f.kind, amount_cents: f.amount_cents, paid_date: f.paid_date, source: f.source, evidence: f.evidence.trim() || null, document_id: doc?.id || null,
      confirms_payment_id: confirmed && f.confirms_payment_id ? f.confirms_payment_id : null };
    const r = await run(() => api.post(`/v1/premium-installments/${inst.id}/payments`, body, { 'Idempotency-Key': key }),
      confirmed ? 'Pagamento confirmado registrado.' : 'Pagamento informado registrado — aguardando confirmação da seguradora.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Registrar pagamento — parcela ${inst.number}/${inst.total_count || '?'}`}
      subtitle={`Vencimento ${fmt(inst.due_date)} · saldo ${money(inst.balance_cents)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[!(f.amount_cents > 0) && { text: 'Informe o valor pago.', field: 'Valor pago' }, !f.paid_date && { text: 'Informe a data do pagamento.', field: 'Data do pagamento' }, f.paid_date > ymd() && 'A data do pagamento não pode ser futura.', confirmed && f.evidence.trim().length < 3 && { text: 'Pagamento confirmado exige evidência.', field: 'Evidência' }, confirmed && f.amount_cents > inst.balance_cents && 'O valor confirmado passa do saldo da parcela.']}>Registrar</SubmitButton></>}>
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Tipo de registro" className="grid gap-2 sm:grid-cols-2">
          {[['informado', 'Pagamento informado', 'Cliente ou equipe informou; cria conferência e pausa lembretes.'],
            ['confirmado', 'Pagamento confirmado', canConfirm ? 'Confirmado em fonte oficial da seguradora.' : 'Sem permissão de conferência com a fonte oficial.']].map(([k, l, h]) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} disabled={k === 'confirmado' && !canConfirm} onClick={() => setKind(k)}
              className={cx('rounded-app-sm border p-3 text-left transition disabled:opacity-50', f.kind === k ? 'border-primary bg-primary/10' : 'border-line hover:bg-muted')}>
              <div className="text-sm font-medium">{l}</div><div className="mt-0.5 text-xs text-ink-faint">{h}</div>
            </button>
          ))}
        </div>
        <Notice tone={confirmed ? 'ok' : 'warn'}>{confirmed
          ? 'Somente com evidência da fonte oficial (API, arquivo oficial ou consulta ao portal). O valor não pode passar do saldo; diferenças vão para "em divergência". Parcela quitada não liquida comissão.'
          : 'Pagamento informado NÃO é confirmação da seguradora: a parcela fica em conferência e os lembretes são pausados até a confirmação.'}</Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <CentsInput label="Valor pago *" value={f.amount_cents} onChange={(v) => setF({ ...f, amount_cents: v })} />
          <Input label="Data do pagamento *" type="date" max={ymd()} value={f.paid_date} onChange={(e) => setF({ ...f, paid_date: e.target.value })} />
          <Select className="sm:col-span-2" label="Fonte *" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            {Object.entries(PAY_SOURCES[f.kind]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {confirmed && pending.length > 0 && (
            <Select className="sm:col-span-2" label="Confirma o pagamento informado" value={f.confirms_payment_id} onChange={(e) => setF({ ...f, confirms_payment_id: e.target.value })}>
              <option value="">Nenhum (confirmação independente)</option>
              {pending.map((x) => <option key={x.id} value={x.id}>{money(x.amount_cents)} em {fmt(x.paid_date)} ({PAY_SOURCES.informado[x.source] || x.source})</option>)}
            </Select>
          )}
          <Textarea className="sm:col-span-2" label={confirmed ? 'Evidência da confirmação *' : 'Observação / evidência'} value={f.evidence}
            placeholder={confirmed ? 'Ex.: consulta ao portal em 05/10 às 10h, status "pago"' : 'Ex.: cliente enviou comprovante pelo WhatsApp'} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FileButton accept="application/pdf,image/*" onFile={upload} disabled={up}>{up ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {doc ? 'Trocar comprovante' : 'Anexar comprovante'}</FileButton>
          {doc && <span className="text-sm">{doc.filename}</span>}
        </div>
        {confirmed && f.amount_cents > inst.balance_cents && <Notice tone="danger">Valor acima do saldo da parcela ({money(inst.balance_cents)}).</Notice>}
      </div>
    </Modal>
  );
}

/** Lembrete: o texto é preparado pelo servidor e aberto no WhatsApp do aparelho (nada é enviado sozinho). */
export function ReminderModal({ inst, onClose }) {
  const [run] = useAction();
  const copy = useCopy();
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    run(() => api.post(`/v1/premium-installments/${inst.id}/reminder`)).then((r) => { if (r === FAIL) setErr(true); else setMsg(r); });
  }, [inst.id]); // eslint-disable-line
  const link = msg ? waShare(msg.phone, msg.body) : null;
  return (
    <Modal open onClose={onClose} title={`Lembrete — parcela ${inst.number}/${inst.total_count || '?'}`} subtitle="O texto abre no seu WhatsApp; nada é enviado automaticamente"
      footer={<><button className="btn-ghost" onClick={onClose}>Fechar</button>
        {msg && <button className="btn-outline" onClick={() => copy(msg.body)}><Copy className="h-4 w-4" /> Copiar</button>}
        {link && <a className="btn-primary" href={link} target="_blank" rel="noopener noreferrer" onClick={onClose}><MessageCircle className="h-4 w-4" /> Abrir WhatsApp</a>}</>}>
      {err ? <Notice tone="danger">Não foi possível preparar o lembrete.</Notice> : !msg ? <Loading /> : (
        <div className="space-y-3">
          <Textarea label="Mensagem" rows={6} value={msg.body} readOnly />
          <p className="text-xs text-ink-faint">{msg.phone ? `Destino: ${msg.phone}` : 'Cliente sem telefone cadastrado — escolha o contato no WhatsApp.'}</p>
        </div>
      )}
    </Modal>
  );
}

function ChargeModal({ inst, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ charge_url: inst.charge_url || '', charge_ref: inst.charge_ref || '', method: inst.method || '', due_date: inst.due_date, reason: '' });
  const dueChanged = f.due_date !== inst.due_date;
  const ok = isHttps(f.charge_url) && (!dueChanged || f.reason.trim().length >= 3);
  const save = async () => {
    const body = { charge_url: f.charge_url.trim() || null, charge_ref: f.charge_ref.trim() || null, method: f.method || null, ...(dueChanged ? { due_date: f.due_date } : {}), ...(f.reason.trim() ? { reason: f.reason.trim() } : {}) };
    const r = await run(() => api.put(`/v1/premium-installments/${inst.id}`, body), 'Cobrança atualizada.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Atualizar cobrança — parcela ${inst.number}`} subtitle="Somente cobrança oficial emitida pela seguradora (a corretora não emite boleto de prêmio)"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[!isHttps(f.charge_url) && { text: 'Informe o link oficial de cobrança começando com https://.', field: 'Link oficial de cobrança' }, dueChanged && f.reason.trim().length < 3 && { text: 'Mudou o vencimento: informe o motivo.', field: 'Motivo' }]}>Salvar</SubmitButton></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Link oficial de cobrança (https)" value={f.charge_url} placeholder="https://…" onChange={(e) => setF({ ...f, charge_url: e.target.value })} />
        {!isHttps(f.charge_url) && <Notice tone="danger" className="sm:col-span-2">Use apenas link https de origem oficial.</Notice>}
        <Input label="Código / linha digitável" value={f.charge_ref} onChange={(e) => setF({ ...f, charge_ref: e.target.value })} />
        <Select label="Forma" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
          <option value="">—</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input label="Vencimento" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        <Input label={`Motivo${dueChanged ? ' *' : ''}`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex.: 2ª via emitida pela seguradora" />
      </div>
    </Modal>
  );
}

function SpecialStatusModal({ inst, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ status: inst.status_override || 'em_divergencia', reason: '' });
  const [refund, setRefund] = useState({ amount_cents: null, confirmed_date: ymd(), recipient: '', evidence: '' });
  const restit = f.status === 'restituida';
  const ok = f.reason.trim().length >= 3 && (!restit || (refund.amount_cents > 0 && refund.confirmed_date && refund.evidence.trim().length >= 3));
  const save = async () => {
    const body = { status: f.status || null, reason: f.reason.trim(), ...(restit ? { refund: { amount_cents: refund.amount_cents, confirmed_date: refund.confirmed_date, evidence: refund.evidence.trim(), ...(refund.recipient.trim() ? { recipient: refund.recipient.trim() } : {}) } } : {}) };
    const r = await run(() => api.post(`/v1/premium-installments/${inst.id}/status`, body), 'Estado da parcela atualizado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Estado especial — parcela ${inst.number}`} subtitle="Estados que dependem de informação formal da seguradora"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[f.reason.trim().length < 3 && { text: 'Informe o motivo / fundamento.', field: 'Motivo / fundamento' }, restit && !(refund.amount_cents > 0) && { text: 'Informe o valor devolvido.', field: 'Valor devolvido' }, restit && !refund.confirmed_date && 'Informe a data da devolução.', restit && refund.evidence.trim().length < 3 && { text: 'Informe a evidência da devolução.', field: 'Evidência' }]}>Salvar</SubmitButton></>}>
      <div className="space-y-3">
        <div className="text-sm">Atual: <StatusChip map={INSTALLMENT_STATUS} value={inst.status} /></div>
        <Select label="Novo estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {Object.entries(SPECIAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="">Voltar ao estado calculado pelos pagamentos</option>
        </Select>
        <Textarea label="Motivo / fundamento *" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        {restit && (
          <div className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-2">
            <p className="text-xs text-ink-faint sm:col-span-2">Restituída exige a devolução confirmada. O histórico de pagamentos é preservado.</p>
            <CentsInput label="Valor devolvido *" value={refund.amount_cents} onChange={(v) => setRefund({ ...refund, amount_cents: v })} />
            <Input label="Data da confirmação *" type="date" value={refund.confirmed_date} onChange={(e) => setRefund({ ...refund, confirmed_date: e.target.value })} />
            <Input label="Destinatário" value={refund.recipient} onChange={(e) => setRefund({ ...refund, recipient: e.target.value })} />
            <Input label="Evidência *" value={refund.evidence} onChange={(e) => setRefund({ ...refund, evidence: e.target.value })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function AddInstallmentsModal({ p, onClose, onDone }) {
  const [run, busy] = useAction();
  const [list, setList] = useState([]);
  const [eid, setEid] = useState('');
  const emitted = p.endorsements.filter((e) => e.status === 'emitido');
  const err = list.length ? installmentsInvalid(list) : 'Inclua ao menos uma parcela.';
  const save = async () => {
    const r = await run(() => api.post(`/v1/policies/${p.id}/installments`, { installments: cleanInstallments(list), endorsement_id: eid || null }), 'Parcelas incluídas.');
    if (r !== FAIL) onDone();
  };
  const nextNo = (p.installments.filter((i) => (eid ? i.endorsement_id === eid : !i.endorsement_id)).reduce((a, i) => Math.max(a, i.number), 0)) + 1;
  return (
    <Modal open onClose={onClose} size="xl" title="Adicionar parcelas" subtitle="Calendário real retornado pela seguradora"
      footer={<><span className="mr-auto text-xs text-ink-faint">{list.length ? err || '' : ''}</span><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} onClick={save} problems={[err]}>Incluir parcelas</SubmitButton></>}>
      <div className="space-y-3">
        {emitted.length > 0 && (
          <Select label="Referente a" value={eid} onChange={(e) => setEid(e.target.value)}>
            <option value="">Apólice (plano original)</option>{emitted.map((e) => <option key={e.id} value={e.id}>Endosso nº {e.number} — {ENDORSEMENT_KINDS[e.kind] || e.kind}</option>)}
          </Select>
        )}
        <InstallmentEditor value={list} onChange={setList} totalCents={eid ? null : p.total_premium_cents} startNumber={nextNo} />
      </div>
    </Modal>
  );
}

function PlanModal({ p, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ count: 1, first_due: p.start_date, total_cents: p.total_premium_cents, method: 'boleto' });
  const n = Math.max(1, Math.min(24, Number(f.count) || 1));
  const preview = f.total_cents ? splitEven(f.total_cents, n) : [];
  const save = async () => {
    const r = await run(() => api.post(`/v1/policies/${p.id}/installments/plan`, { count: n, first_due: f.first_due, total_cents: f.total_cents, method: f.method }), 'Plano de parcelas gerado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Gerar plano de parcelas" subtitle="Parcelas iguais, resíduo de centavos nas primeiras"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[!f.total_cents && 'Informe o valor total.', !f.first_due && 'Informe o 1º vencimento.']}>Gerar</SubmitButton></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Quantidade (1 a 24)" type="number" min={1} max={24} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />
        <Input label="1º vencimento" type="date" value={f.first_due} onChange={(e) => setF({ ...f, first_due: e.target.value })} />
        <CentsInput label="Total" value={f.total_cents} onChange={(v) => setF({ ...f, total_cents: v })} />
        <Select label="Forma" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        {preview.length > 0 && <p className="text-xs text-ink-faint sm:col-span-2">Prévia: {preview.map((v, i) => `${i + 1}ª ${money(v)} (${fmt(addMonthsYmd(f.first_due, i))})`).join(' · ')}</p>}
      </div>
    </Modal>
  );
}

function ShareLinkResult({ url, text }) {
  const copy = useCopy();
  return (
    <div className="space-y-3">
      <Input label="Endereço" value={url} readOnly onFocus={(e) => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-outline" onClick={() => copy(url)}><Copy className="h-4 w-4" /> Copiar</button>
        <a className="btn-primary" href={waShare(null, `${text}\n${url}`)} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /> Enviar por WhatsApp</a>
      </div>
    </div>
  );
}

function PortalLinkModal({ p, onClose }) {
  const [run, busy] = useAction();
  const [days, setDays] = useState(15);
  const [res, setRes] = useState(null);
  const gen = async () => {
    const r = await run(() => api.post('/v1/portal-links', { policy_id: p.id, days: Math.max(1, Math.min(60, Number(days) || 15)) }), 'Link gerado.');
    if (r !== FAIL) setRes(r);
  };
  return (
    <Modal open onClose={onClose} title="Link do portal (parcelas)" subtitle="O cliente vê as parcelas e os links oficiais de cobrança — sem comissão nem dados internos"
      footer={<button className="btn-ghost" onClick={onClose}>Fechar</button>}>
      {res ? <ShareLinkResult url={appUrl(res.path)} text={`Olá! Aqui estão as parcelas do seu seguro (apólice ${p.policy_number || ''}):`} /> : (
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Validade (dias, 1 a 60)" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
          <button className="btn-primary" disabled={busy} onClick={gen}><Link2 className="h-4 w-4" /> Gerar link</button>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Comissão ----------------
function CommissionTab({ p, reload }) {
  const { can } = useAuth();
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const s = p.commission_snapshot;
  const canRules = can('commissions_rules');
  const versions = useRuleVersions(p.institution_id, canRules);
  const [f, setF] = useState({ rule_version_id: '', base_cents: s?.base_cents ?? null });
  const rule = versions.find((v) => v.id === f.rule_version_id);
  const usable = versions.filter((v) => v.valid_from <= p.start_date && (!v.valid_to || v.valid_to >= p.start_date));
  const apply = async () => {
    if (!(await confirm({ title: 'Aplicar plano de comissão?', message: 'As comissões previstas ainda não confirmadas desta apólice serão recalculadas pela regra escolhida (snapshot). Valores já confirmados não mudam.', confirmText: 'Aplicar', danger: false }))) return;
    const r = await run(() => api.post(`/v1/policies/${p.id}/commission`, { rule_version_id: f.rule_version_id, ...(f.base_cents != null ? { base_cents: f.base_cents } : {}) }), 'Plano de comissão aplicado.');
    if (r !== FAIL) reload();
  };
  const tot = p.commissions.reduce((a, r) => ({ exp: a.exp + Number(r.expected_cents || 0), conf: a.conf + Number(r.confirmed_cents || 0), alloc: a.alloc + Number(r.allocated_cents || 0) }), { exp: 0, conf: 0, alloc: 0 });
  return (
    <div className="space-y-4">
      <Notice tone="info">Comissão é receita da corretora, paga pela seguradora — separada do prêmio pago pelo cliente. Prevista, confirmada e liquidada são valores distintos. <Link to="/comissoes" className="font-semibold underline">Abrir Comissões</Link></Notice>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Prevista (pela regra)" value={money(tot.exp)} hint="Estimativa — não é valor devido" />
        <Stat label="Confirmada pela seguradora" value={money(tot.conf)} hint="Extrato / informação oficial" />
        <Stat label="Liquidada (recebida)" value={money(tot.alloc)} hint="Alocada em liquidações" />
      </div>
      <Section title="Regra vigente na contratação" subtitle="Snapshot gravado na apólice: mudanças futuras no acordo não recalculam este contrato">
        {!s ? <p className="text-sm text-ink-faint">Nenhum plano de comissão aplicado.</p> : (
          <KV cols={3} items={[
            ['Acordo', s.agreement], ['Versão da regra', `v${s.version}`], ['Tipo', s.kind === 'fixo' ? 'Valor fixo' : 'Percentual'],
            [s.kind === 'fixo' ? 'Valor fixo' : 'Percentual', s.kind === 'fixo' ? money(s.fixed_cents) : pct(s.rate)],
            ['Definição da base', BASE_DEF[s.base_definition] || s.base_definition || '—'], ['Base comissionável documentada', moneyOrNA(s.base_cents)],
            ['Calendário', s.schedule === 'parcelada' ? `Parcelada em ${s.installments}x` : 'Pagamento único'], ['Evento que gera o direito', s.right_event || '—'],
            s.base_notes && ['Notas da base', s.base_notes],
          ]} />
        )}
      </Section>
      <Section title="Comissões a receber desta apólice" bodyClass="p-0">
        {!p.commissions.length ? <Empty title="Nenhuma comissão prevista" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th className="text-right">Prevista</th><th className="text-right">Confirmada</th><th className="text-right">Liquidada</th><th className="text-right">Saldo</th><th>Situação</th></tr></thead>
              <tbody>{p.commissions.map((r) => (
                <tr key={r.id}>
                  <td>{r.installment_no}/{r.installments_total || 1}{r.endorsement_id && <div className="text-xs text-ink-faint">Endosso</div>}</td>
                  <td>{fmt(r.due_date)}</td>
                  <td className="text-right tabular-nums">{money(r.expected_cents)}</td>
                  <td className="text-right tabular-nums">{r.confirmed_cents == null ? <span className="text-ink-faint">não confirmada</span> : money(r.confirmed_cents)}</td>
                  <td className="text-right tabular-nums">{money(r.allocated_cents)}</td>
                  <td className="text-right tabular-nums">{r.balance_cents == null ? '—' : money(r.balance_cents)}</td>
                  <td><StatusChip map={COMMISSION_STATUS} value={r.status} />{r.adjusted && <div className="text-xs text-ink-faint">com ajustes</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>
      {canRules && (
        <Section title="Aplicar plano de comissão" subtitle="Escolha a versão da regra vigente no início da apólice">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Versão da regra" value={f.rule_version_id} onChange={(e) => setF({ ...f, rule_version_id: e.target.value })}>
              <option value="">Selecione…</option>{usable.map((v) => <option key={v.id} value={v.id}>{ruleLabel(v)}</option>)}
            </Select>
            <CentsInput label={`Base comissionável documentada${rule?.kind === 'percentual' ? ' *' : ''}`} value={f.base_cents} onChange={(v) => setF({ ...f, base_cents: v })}
              hint="Conforme documento/acordo — o sistema não presume o prêmio líquido." />
            {versions.length > 0 && !usable.length && <p className="text-sm text-amber-600 sm:col-span-2">Nenhuma versão de regra estava vigente em {fmt(p.start_date)}.</p>}
            {!versions.length && <p className="text-sm text-ink-faint sm:col-span-2">Nenhum acordo de comissão com esta seguradora.</p>}
          </div>
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={busy || !f.rule_version_id || (rule?.kind === 'percentual' && f.base_cents == null)} onClick={apply}>Aplicar plano</button>
          </div>
        </Section>
      )}
    </div>
  );
}

// ---------------- Repasses ----------------
function SplitsTab({ p, reload }) {
  const { can } = useAuth();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const canManage = can('splits_manage');
  const { data: rules } = useFetch(() => (canManage ? api.get('/v1/splits/rules') : Promise.resolve([])), [canManage]);
  const [f, setF] = useState({ rule_version_id: '', extraordinary_reason: '' });
  const [budget, setBudget] = useState(null);
  const eligible = (rules || []).filter((r) => r.active && (!r.institution_id || r.institution_id === p.institution_id) && (!r.branch || r.branch === p.branch));
  const names = useMemo(() => {
    const m = {};
    (rules || []).forEach((r) => { m[r.partner_id] = r.partner_name; });
    p.splits.forEach((s) => { m[s.partner_id] = s.partner_name; });
    return m;
  }, [rules, p.splits]);
  const link = async () => {
    const r = await run(() => api.post(`/v1/policies/${p.id}/splits`, { rule_version_id: f.rule_version_id, extraordinary_reason: f.extraordinary_reason.trim() || null }), 'Repasse vinculado.',
      (e) => { if (e.code === 'SPLIT_BUDGET') { setBudget({ message: e.message, simulation: e.data?.simulation || [] }); return true; } return false; });
    if (r !== FAIL) { setF({ rule_version_id: '', extraordinary_reason: '' }); setBudget(null); reload(); }
  };
  const remove = async (s) => {
    if (!(await confirm({ title: 'Remover vínculo de repasse?', message: `${s.partner_name} deixa de participar desta apólice. Só é possível sem liberações já feitas.`, confirmText: 'Remover' }))) return;
    const r = await run(() => api.del(`/v1/policies/${p.id}/splits/${s.id}`), 'Vínculo removido.');
    if (r !== FAIL) reload();
  };
  return (
    <div className="space-y-4">
      <Notice tone="info">Repasse é a parte da comissão destinada a produtores/parceiros — liberado conforme a regra, sobre a comissão recebida. Não se confunde com o prêmio nem com a comissão. <Link to="/repasses" className="font-semibold underline">Abrir Repasses</Link></Notice>
      <Section title="Participantes desta apólice" bodyClass="p-0">
        {!p.splits.length ? <Empty title="Nenhum repasse vinculado" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Parceiro</th><th>Regra (snapshot)</th><th>Participação</th><th>Base</th><th>Liberação</th><th className="text-right">Liberado até agora</th><th /></tr></thead>
              <tbody>{p.splits.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.partner_name}{s.extraordinary && <div><span className={cx('chip', C.orange)}>Extraordinário</span></div>}
                    {s.extraordinary_reason && <div className="text-xs text-ink-faint">{s.extraordinary_reason}</div>}</td>
                  <td>{s.snapshot?.name} v{s.snapshot?.version}</td>
                  <td className="tabular-nums">{s.snapshot?.kind === 'fixo' ? money(s.snapshot?.fixed_cents) : pct(s.snapshot?.rate)}</td>
                  <td>{SPLIT_BASE[s.snapshot?.base] || s.snapshot?.base} · etapa {s.snapshot?.stage}{s.snapshot?.sequential ? ' (sequencial)' : ''}</td>
                  <td>{s.snapshot?.release === 'antecipado' ? 'Antecipado (aprovado)' : 'No recebimento'}</td>
                  <td className="text-right tabular-nums">{money(s.accrued_cents)}</td>
                  <td>{canManage && Number(s.accrued_cents) === 0 && <button className="btn-ghost btn-icon" aria-label={`Remover ${s.partner_name}`} title="Remover" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>
      {canManage && (
        <Section title="Vincular regra de repasse" subtitle="O orçamento de distribuição é validado pelo efeito em dinheiro sobre a comissão da apólice">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Regra" value={f.rule_version_id} onChange={(e) => { setF({ ...f, rule_version_id: e.target.value }); setBudget(null); }}>
              <option value="">Selecione…</option>
              {eligible.map((r) => <option key={r.id} value={r.id}>{r.partner_name} — {r.name} v{r.version} · {r.kind === 'fixo' ? money(r.fixed_cents) : pct(r.rate)} da {SPLIT_BASE[r.base]?.toLowerCase()}</option>)}
            </Select>
            {budget && <Textarea label="Justificativa da operação extraordinária *" value={f.extraordinary_reason} onChange={(e) => setF({ ...f, extraordinary_reason: e.target.value })}
              hint={can('splits_approve') ? 'Fica registrada com sua aprovação.' : 'Exige perfil que aprova repasses.'} />}
          </div>
          {budget && (
            <div className="mt-4 space-y-3">
              <Notice tone="danger"><AlertTriangle className="mr-1 inline h-4 w-4" />{budget.message}</Notice>
              {budget.simulation.length > 0 && (
                <div className="overflow-x-auto rounded-app-sm border border-line">
                  <table className="table-clean">
                    <thead><tr><th>Participante</th><th className="text-right">Base</th><th className="text-right">Restante antes</th><th className="text-right">Valor simulado</th></tr></thead>
                    <tbody>{budget.simulation.map((x, i) => (
                      <tr key={i}><td>{names[x.partner_id] || 'Participante'}{x.policy_split_id === 'novo' && <span className={cx('chip ml-1', C.blue)}>novo</span>}</td>
                        <td className="text-right tabular-nums">{money(x.base_cents)}</td><td className="text-right tabular-nums">{money(x.remaining_before_cents)}</td>
                        <td className="text-right tabular-nums">{money(x.amount_cents)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={busy || !f.rule_version_id || (budget && f.extraordinary_reason.trim().length < 3)} onClick={link}>
              {budget ? 'Vincular como extraordinário' : 'Vincular'}</button>
          </div>
        </Section>
      )}
    </div>
  );
}

// ---------------- Endossos ----------------
function EndorsementsTab({ p, reload }) {
  const { can } = useAuth();
  const settings = useSettings();
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState(null);
  const canE = can('endorsements');
  const canCreate = canE && ['vigente', 'cancelamento_solicitado'].includes(p.contract_state);
  return (
    <div className="space-y-4">
      <Notice tone="info">O endosso altera o contrato sem apagar a versão original. Diferenças de prêmio, parcelas e comissão só impactam os totais quando o endosso é <b>emitido</b> (com data de efeito e documento ou protocolo).</Notice>
      <Section title="Endossos" bodyClass="p-0" actions={canCreate && <button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" /> Solicitar endosso</button>}>
        {!p.endorsements.length ? <Empty title="Nenhum endosso" text={canCreate ? undefined : 'Endosso só para apólice vigente.'} /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Número</th><th>Tipo</th><th>Motivo / alterações</th><th>Data pretendida</th><th>Situação</th><th>Protocolo</th><th>Efeito</th><th className="text-right">Dif. prêmio</th><th /></tr></thead>
              <tbody>{p.endorsements.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-medium">{docNumber(settings, 'endorsement', e.number)}</td>
                  <td>{ENDORSEMENT_KINDS[e.kind] || e.kind}</td>
                  <td><div>{e.reason}</div><div className="max-w-xs whitespace-pre-line text-xs text-ink-faint">{e.changes}</div></td>
                  <td>{fmt(e.requested_date)}</td>
                  <td><StatusChip map={ENDORSEMENT_STATUS} value={e.status} /></td>
                  <td>{e.protocol || '—'}</td>
                  <td>{fmt(e.effective_date)}</td>
                  <td className="text-right tabular-nums">{e.premium_diff_cents == null ? '—' : money(e.premium_diff_cents)}</td>
                  <td>{canE && !['emitido', 'cancelado', 'recusado'].includes(e.status) && <button className="btn-outline" onClick={() => setEdit(e)}>Atualizar</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>
      {create && <EndorsementCreateModal p={p} onClose={() => setCreate(false)} onDone={() => { setCreate(false); reload(); }} />}
      {edit && <EndorsementUpdateModal p={p} e={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function EndorsementCreateModal({ p, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ kind: 'alteracao_dados', reason: '', requested_date: ymd(), changes: '' });
  const ok = f.reason.trim().length >= 3 && f.changes.trim().length >= 3 && f.requested_date;
  return (
    <Modal open onClose={onClose} title="Solicitar endosso" subtitle={`Apólice ${p.policy_number || ''}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} problems={[!f.requested_date && { text: 'Informe a data pretendida.', field: 'Data pretendida' }, f.reason.trim().length < 3 && { text: 'Informe o motivo.', field: 'Motivo' }, f.changes.trim().length < 3 && { text: 'Descreva as alterações solicitadas.', field: 'Alterações solicitadas' }]} onClick={async () => { const r = await run(() => api.post(`/v1/policies/${p.id}/endorsements`, { ...f, reason: f.reason.trim(), changes: f.changes.trim() }), 'Endosso solicitado.'); if (r !== FAIL) onDone(); }}>Solicitar</SubmitButton></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(ENDORSEMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input label="Data pretendida *" type="date" value={f.requested_date} onChange={(e) => setF({ ...f, requested_date: e.target.value })} />
        <Input className="sm:col-span-2" label="Motivo *" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <Textarea className="sm:col-span-2" rows={5} label="Alterações solicitadas *" value={f.changes} onChange={(e) => setF({ ...f, changes: e.target.value })} placeholder="Descreva o que muda (bens, vidas, local, capitais, coberturas…)" />
      </div>
    </Modal>
  );
}

function EndorsementUpdateModal({ p, e, onClose, onDone }) {
  const { can } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState({ status: e.status === 'solicitado' ? 'em_analise' : e.status, protocol: e.protocol || '', effective_date: e.effective_date || '', premium_diff_cents: e.premium_diff_cents ?? null, commission_diff_cents: e.commission_diff_cents ?? null });
  const [doc, setDoc] = useState(null);
  const [up, setUp] = useState(false);
  const [inst, setInst] = useState([]);
  const [replaceCov, setReplaceCov] = useState(false);
  const [cov, setCov] = useState((p.coverages || []).map((c) => ({ ...c, deductible_text: c.deductible_text || '' })));
  const emit = f.status === 'emitido';
  const upload = async (file) => {
    setUp(true);
    try {
      const payload = await fileToPayload(file);
      const r = await run(() => api.post('/v1/documents', { entity: 'endorsement', entity_id: e.id, client_id: p.client_id, kind: 'endosso', ...payload }), 'Documento anexado.');
      if (r !== FAIL) setDoc(r);
    } catch (er) { toast(er.message, 'error'); } finally { setUp(false); }
  };
  const instErr = emit && inst.length ? installmentsInvalid(inst) : null;
  const missing = emit && (!f.effective_date || !(doc || e.document_id || f.protocol.trim()));
  const save = async () => {
    const body = { status: f.status, protocol: f.protocol.trim() || null, effective_date: f.effective_date || null, premium_diff_cents: f.premium_diff_cents,
      document_id: doc?.id || null, ...(can('commissions_view') ? { commission_diff_cents: f.commission_diff_cents } : {}),
      ...(emit && inst.length ? { installments: cleanInstallments(inst) } : {}), ...(emit && replaceCov ? { coverages: cleanCoverages(cov) } : {}) };
    const r = await run(() => api.put(`/v1/policies/endorsements/${e.id}`, body), emit ? 'Endosso emitido — nova versão do contrato registrada.' : 'Endosso atualizado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="xl" title={`Atualizar endosso nº ${e.number}`} subtitle={`${ENDORSEMENT_KINDS[e.kind] || e.kind} — ${e.reason}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[missing && 'Para emitir: informe a data de efeito e anexe o documento ou o protocolo.', instErr]}>Salvar</SubmitButton></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Situação" value={f.status} onChange={(ev) => setF({ ...f, status: ev.target.value })}>
            {['em_analise', 'aceito', 'recusado', 'emitido', 'cancelado'].map((k) => <option key={k} value={k}>{ENDORSEMENT_STATUS[k].label}</option>)}
          </Select>
          <Input label="Protocolo da seguradora" value={f.protocol} onChange={(ev) => setF({ ...f, protocol: ev.target.value })} />
          <Input label={`Data de efeito${emit ? ' *' : ''}`} type="date" value={f.effective_date} onChange={(ev) => setF({ ...f, effective_date: ev.target.value })} />
          <div className="space-y-2">
            <CentsInput label="Diferença de prêmio (informada)" value={f.premium_diff_cents == null ? null : Math.abs(f.premium_diff_cents)}
              onChange={(v) => setF({ ...f, premium_diff_cents: v == null ? null : (f.premium_diff_cents < 0 ? -v : v) })} />
            <label className="flex items-center gap-1.5 text-xs text-ink-soft"><input type="checkbox" checked={f.premium_diff_cents < 0}
              onChange={(ev) => setF({ ...f, premium_diff_cents: f.premium_diff_cents == null ? null : (ev.target.checked ? -Math.abs(f.premium_diff_cents) : Math.abs(f.premium_diff_cents)) })} /> É restituição (diferença negativa)</label>
          </div>
          {can('commissions_view') && <CentsInput label="Diferença de comissão (informada)" value={f.commission_diff_cents} onChange={(v) => setF({ ...f, commission_diff_cents: v })} />}
          <div className="flex items-end gap-2">
            <FileButton accept="application/pdf,image/*" onFile={upload} disabled={up}>{up ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {doc || e.document_id ? 'Trocar documento' : 'Anexar documento'}</FileButton>
          </div>
        </div>
        {doc && <p className="text-sm">Documento: {doc.filename}</p>}
        {emit ? (
          <>
            <Notice tone="warn">Ao emitir: o prêmio total recebe a diferença informada, as parcelas abaixo são incluídas e a comissão do endosso entra como prevista. Exige data de efeito e documento ou protocolo.</Notice>
            <div><div className="label">Parcelas do endosso (opcional)</div><InstallmentEditor value={inst} onChange={setInst} totalCents={f.premium_diff_cents > 0 ? f.premium_diff_cents : null} /></div>
            {instErr && <Notice tone="danger">{instErr}</Notice>}
            <Toggle checked={replaceCov} onChange={setReplaceCov} label="Substituir coberturas pela versão endossada" hint="A versão anterior continua no histórico." />
            {replaceCov && <CoverageEditor value={cov} onChange={setCov} branch={p.branch} />}
          </>
        ) : <p className="text-xs text-ink-faint">Enquanto não emitido, o endosso não altera totais, parcelas nem comissão.</p>}
        {missing && <p className="text-sm text-amber-600">Para emitir, informe a data de efeito e o documento ou o protocolo.</p>}
      </div>
    </Modal>
  );
}

// ---------------- Cancelamento ----------------
function CancellationTab({ p, reload }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const canE = can('endorsements');
  return (
    <div className="space-y-4">
      <Notice tone="info">"Cancelamento solicitado" não é "efetivado". Restituição de prêmio (pela seguradora), estorno de comissão e ajuste de repasse são operações distintas — o estorno de comissão é lançado em <Link to="/comissoes" className="font-semibold underline">Comissões</Link>.</Notice>
      <Section title="Cancelamentos" bodyClass="p-0" actions={canE && p.contract_state === 'vigente' && <button className="btn-danger" onClick={() => setOpen(true)}>Solicitar cancelamento</button>}>
        {!p.cancellations.length ? <Empty title="Nenhum cancelamento registrado" /> : (
          <div className="divide-y divide-line">
            {p.cancellations.map((c) => (
              <div key={c.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><StatusChip map={CANCEL_STATUS} value={c.status} /><span className="text-sm text-ink-faint">solicitado em {fmt(c.requested_date)}</span></div>
                  {canE && c.status === 'solicitado' && <button className="btn-outline" onClick={() => setEdit(c)}>Registrar resposta da seguradora</button>}
                </div>
                <div className="mt-3"><KV cols={3} items={[
                  ['Solicitante', c.requested_by_name], ['Poderes', c.powers || '—'], ['Motivo', c.reason],
                  ['Restituição estimada (provisória)', c.refund_estimate_cents == null ? '—' : `${money(c.refund_estimate_cents)} — estimativa interna`],
                  ['Restituição informada pela seguradora', moneyOrNA(c.refund_cents)], ['Data de efeito', fmt(c.effective_date)],
                  ['Destinatário da restituição', c.refund_recipient || '—'], ['Responsável pelo pagamento', c.refund_payer || '—'], ['Protocolo', c.protocol || '—'],
                  c.evidence && ['Evidência', c.evidence],
                ]} /></div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {open && <CancelCreateModal p={p} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
      {edit && <CancelUpdateModal c={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function CancelCreateModal({ p, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ requested_by_name: p.client_name || '', powers: '', reason: '', requested_date: ymd(), refund_estimate_cents: null });
  const ok = f.requested_by_name.trim().length >= 2 && f.reason.trim().length >= 3 && f.requested_date;
  const save = async () => {
    const r = await run(() => api.post(`/v1/policies/${p.id}/cancellations`, { requested_by_name: f.requested_by_name.trim(), powers: f.powers.trim() || null, reason: f.reason.trim(),
      requested_date: f.requested_date, refund_estimate_cents: f.refund_estimate_cents }), 'Cancelamento solicitado (ainda não efetivado).');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Solicitar cancelamento" subtitle="A apólice passa a “cancelamento solicitado” até a resposta da seguradora"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-danger" disabled={!ok || busy} onClick={save}>Registrar solicitação</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Solicitante *" value={f.requested_by_name} onChange={(e) => setF({ ...f, requested_by_name: e.target.value })} />
        <Input label="Poderes / representação" value={f.powers} onChange={(e) => setF({ ...f, powers: e.target.value })} placeholder="Ex.: titular; procurador com procuração de…" />
        <Input label="Data requerida *" type="date" value={f.requested_date} onChange={(e) => setF({ ...f, requested_date: e.target.value })} />
        <CentsInput label="Restituição estimada (provisória)" value={f.refund_estimate_cents} onChange={(v) => setF({ ...f, refund_estimate_cents: v })} hint="Estimativa interna — o valor oficial vem da seguradora." />
        <Textarea className="sm:col-span-2" label="Motivo *" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
    </Modal>
  );
}

function CancelUpdateModal({ c, onClose, onDone }) {
  const [run, busy] = useAction();
  const { toast } = useUI();
  const [f, setF] = useState({ status: 'efetivado', effective_date: ymd(), evidence: '', protocol: '', refund_cents: null, refund_recipient: '', refund_payer: '' });
  const ok = f.evidence.trim().length >= 3 && (f.status !== 'efetivado' || f.effective_date);
  const save = async () => {
    const body = { status: f.status, effective_date: f.status === 'efetivado' ? f.effective_date : (f.effective_date || null), evidence: f.evidence.trim(), protocol: f.protocol.trim() || null,
      refund_cents: f.refund_cents, refund_recipient: f.refund_recipient.trim() || null, refund_payer: f.refund_payer.trim() || null };
    const r = await run(() => api.put(`/v1/policies/cancellations/${c.id}`, body), 'Cancelamento atualizado.');
    if (r !== FAIL) { if (r?.note) toast(r.note); onDone(); }
  };
  return (
    <Modal open onClose={onClose} title="Resposta da seguradora ao cancelamento"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className={f.status === 'efetivado' ? 'btn-danger' : 'btn-primary'} disabled={!ok || busy} onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Resultado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="efetivado">Cancelamento efetivado</option><option value="desistencia">Desistência do cliente</option><option value="recusado">Recusado pela seguradora</option>
        </Select>
        <Input label={`Data de efeito${f.status === 'efetivado' ? ' *' : ''}`} type="date" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} />
        <Input label="Protocolo" value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })} />
        <CentsInput label="Restituição informada pela seguradora" value={f.refund_cents} onChange={(v) => setF({ ...f, refund_cents: v })} />
        <Input label="Destinatário da restituição" value={f.refund_recipient} onChange={(e) => setF({ ...f, refund_recipient: e.target.value })} />
        <Input label="Responsável pelo pagamento" value={f.refund_payer} onChange={(e) => setF({ ...f, refund_payer: e.target.value })} placeholder="Ex.: seguradora" />
        <Textarea className="sm:col-span-2" label="Evidência *" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="Ex.: endosso de cancelamento nº…, e-mail da seguradora de…" />
        {f.status === 'efetivado' && <Notice tone="warn" className="sm:col-span-2">Parcelas futuras sem pagamento serão marcadas como canceladas. O estorno de comissão, se houver, é uma operação separada em Comissões.</Notice>}
      </div>
    </Modal>
  );
}

// ---------------- Sinistros ----------------
function ClaimsTab({ p }) {
  const { can } = useAuth();
  const settings = useSettings();
  return (
    <Section title="Sinistros desta apólice" bodyClass="p-0"
      actions={can('claims') && <Link to={`/sinistros?nova=1&policy=${p.id}`} className="btn-primary"><Plus className="h-4 w-4" /> Abrir sinistro</Link>}>
      {!p.claims.length ? <Empty title="Nenhum sinistro registrado" /> : (
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Número</th><th>Ocorrência</th><th>Situação (trabalho da corretora)</th></tr></thead>
            <tbody>{p.claims.map((c) => (
              <tr key={c.id}><td>{can('claims') ? <Link to={`/sinistros/${c.id}`} className="font-medium text-primary hover:underline">{docNumber(settings, 'claim', c.number)}</Link> : docNumber(settings, 'claim', c.number)}</td>
                <td>{fmtDateTime(c.occurred_at)}</td><td><StatusChip map={CLAIM_STATUS} value={c.work_status} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------- Documentos ----------------
function DocumentsTab({ p }) {
  const { can, feature } = useAuth();
  const { toast } = useUI();
  const [run] = useAction();
  const { data, loading, reload } = useFetch(() => api.get(`/v1/documents${qs({ entity: 'policy', entity_id: p.id })}`), [p.id]);
  const [kind, setKind] = useState('apolice');
  const [restricted, setRestricted] = useState(false);
  const [up, setUp] = useState(false);
  const [linkDoc, setLinkDoc] = useState(null);
  const upload = async (file) => {
    setUp(true);
    try {
      const payload = await fileToPayload(file);
      const r = await run(() => api.post('/v1/documents', { entity: 'policy', entity_id: p.id, client_id: p.client_id, kind, access_level: restricted ? 'restrito' : 'normal', ...payload }), 'Documento enviado.');
      if (r !== FAIL) reload();
    } catch (e) { toast(e.message, 'error'); } finally { setUp(false); }
  };
  const dl = async (d) => { try { await download(`/v1/documents/${d.id}/download`, d.filename); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Section title="Documentos da apólice" subtitle="Apólice, condições, endossos, boletos e vistorias com versão e origem" bodyClass="p-0"
      actions={<div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" aria-label="Tipo do documento" value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(DOC_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {can('documents_restricted') && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restrito</label>}
        <FileButton className="btn-primary" accept="application/pdf,image/*,text/csv,application/xml" onFile={upload} disabled={up}>{up ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} Enviar</FileButton>
      </div>}>
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nenhum documento" text="O documento da apólice muda o estado documental para “Recebido — conferir” quando anexado no cadastro." /> : (
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Arquivo</th><th>Tipo</th><th>Versão</th><th>Acesso</th><th>Enviado em</th><th /></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.id}>
                <td className="max-w-xs truncate font-medium">{d.filename}</td><td>{DOC_KINDS[d.kind] || d.kind}</td><td>v{d.version}</td>
                <td><span className={cx('chip', d.access_level === 'restrito' ? C.red : C.gray)}>{d.access_level === 'restrito' ? 'Restrito' : 'Normal'}</span></td>
                <td>{fmtDateTime(d.created_at)}</td>
                <td><div className="flex justify-end gap-1">
                  <button className="btn-ghost btn-icon" title="Baixar" aria-label={`Baixar ${d.filename}`} onClick={() => dl(d)}><Download className="h-4 w-4" /></button>
                  {d.access_level !== 'restrito' && feature('portal_cliente') && <button className="btn-ghost btn-icon" title="Link temporário" aria-label={`Link temporário de ${d.filename}`} onClick={() => setLinkDoc(d)}><Link2 className="h-4 w-4" /></button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {linkDoc && <DocLinkModal doc={linkDoc} onClose={() => setLinkDoc(null)} />}
    </Section>
  );
}

function DocLinkModal({ doc, onClose }) {
  const [run, busy] = useAction();
  const [hours, setHours] = useState(48);
  const [res, setRes] = useState(null);
  const gen = async () => {
    const r = await run(() => api.post(`/v1/documents/${doc.id}/link`, { hours: Math.max(1, Math.min(168, Number(hours) || 48)) }), 'Link gerado.');
    if (r !== FAIL) setRes(r);
  };
  return (
    <Modal open onClose={onClose} title="Link temporário" subtitle={`${doc.filename} — revogável em Documentos; cada acesso fica registrado`} footer={<button className="btn-ghost" onClick={onClose}>Fechar</button>}>
      {res ? <ShareLinkResult url={appUrl(res.path)} text={`Segue o documento ${doc.filename} (link válido por ${hours} h):`} /> : (
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Validade (horas, 1 a 168)" type="number" min={1} max={168} value={hours} onChange={(e) => setHours(e.target.value)} />
          <button className="btn-primary" disabled={busy} onClick={gen}><Link2 className="h-4 w-4" /> Gerar link</button>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Versões ----------------
function VersionsTab({ p }) {
  return (
    <Section title="Histórico de versões" subtitle="Somente leitura — a versão original é preservada; endossos e ajustes geram novas versões" bodyClass="p-0">
      {!p.versions.length ? <Empty title="Sem versões registradas" /> : (
        <ol className="divide-y divide-line">
          {p.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <span className="chip bg-muted text-ink-soft">v{v.version}</span>
              <div className="min-w-0 flex-1"><div className="text-sm">{v.reason || '—'}</div><div className="text-xs text-ink-faint">{v.created_by_name || 'Sistema'} · {fmtDateTime(v.created_at)}</div></div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// ---------------- Renovação ----------------
function RenewalTab({ p }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const start = async () => {
    const r = await run(() => api.post(`/v1/renewals/${p.id}/opportunity`), 'Renovação iniciada.');
    if (r !== FAIL) nav(`/cotacoes/nova${qs({ client: p.client_id, branch: p.branch, renewal: p.id })}`);
  };
  const daysLeft = Math.round((new Date(`${p.end_date}T12:00:00`) - new Date(`${ymd()}T12:00:00`)) / 86400000);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Renovação desta apólice">
        {p.renewal ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className={cx('chip', C.indigo)}><Repeat className="h-3 w-3" /> Renovada</span></div>
            <p>Renovada pela apólice <Link to={`/apolices/${p.renewal.id}`} className="font-medium text-primary hover:underline">{p.renewal.policy_number || '(sem número)'}</Link>, com início em {fmt(p.renewal.start_date)}.</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Vencimento em {fmt(p.end_date)} — {daysLeft >= 0 ? `faltam ${daysLeft} dia(s)` : `vencida há ${-daysLeft} dia(s)`}.</p>
            <p className="text-xs text-ink-faint">A renovação começa pela revisão do risco e das coberturas: declarações antigas não são retransmitidas sem revisão, e não há renovação automática presumida.</p>
            <div className="flex flex-wrap gap-2">
              {can('renewals') && ['vigente', 'vencida'].includes(p.contract_state) && <button className="btn-primary" disabled={busy} onClick={start}><Repeat className="h-4 w-4" /> Iniciar renovação</button>}
              {can('policies_manage') && <Link to={`/apolices/nova?renewal=${p.id}`} className="btn-outline">Cadastrar apólice renovada</Link>}
            </div>
          </div>
        )}
      </Section>
      <Section title="Cadeia de renovações anteriores">
        {!p.previous.length ? <p className="text-sm text-ink-faint">Esta é a primeira apólice da cadeia.</p> : (
          <ol className="space-y-2">
            {p.previous.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 rounded-app-sm border border-line px-3 py-2 text-sm">
                <Link to={`/apolices/${x.id}`} className="font-medium text-primary hover:underline">{x.policy_number || '(sem número)'}</Link>
                <span className="text-ink-faint">{fmt(x.start_date)} – {fmt(x.end_date)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
