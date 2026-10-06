// Clientes (5.1): carteira, cadastro com prevenção de duplicidade, união revisada e ficha completa do cliente.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Users, Plus, Search, Download, GitMerge, ArrowLeft, Calculator, Target, Trash2, MessageCircle, Phone, Mail, FileText, Upload,
  ShieldCheck, Link2, AlertTriangle, X, Building2, User,
} from 'lucide-react';
import { api, download, fileToPayload, qs } from '../lib/api';
import {
  fmt, fmtDateTime, money, maskDoc, maskPhone, maskCep, lookupCep, waLink, onlyDigits, STAGES, CONTRACT_STATE, DOC_STATE, CLAIM_STATUS, REQUEST_STATUS,
} from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { SubmitButton,
  PageHeader, Section, KV, Tabs, Modal, PromptModal, Input, Textarea, Select, Toggle, FileButton, StatusChip, Notice, Empty, Loading, Spinner,
  useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';

// ---------------- Dicionários locais ----------------
export const RELATION_LABEL = {
  dependente: 'Dependente', conjuge: 'Cônjuge', socio: 'Sócio(a)', empresa_do_grupo: 'Empresa do grupo', representante_legal: 'Representante legal',
  pagador: 'Pagador', estipulante: 'Estipulante', beneficiario: 'Beneficiário', segurado: 'Segurado', contato_autorizado: 'Contato autorizado',
};
const relationLabel = (r) => {
  if (!r) return '—';
  const inverse = r.endsWith(' (de)');
  const k = inverse ? r.slice(0, -5) : r;
  return `${RELATION_LABEL[k] || k}${inverse ? ' (vínculo informado no outro cadastro)' : ''}`;
};
const ACTIVITY_KIND = {
  nota: 'Nota', ligacao: 'Ligação', email: 'E-mail', whatsapp: 'WhatsApp', reuniao: 'Reunião', reclamacao: 'Reclamação', compromisso: 'Compromisso',
};
const ROLE_CHIP = {
  contratante: { label: 'Contratante', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  segurado: { label: 'Segurado', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  pagador: { label: 'Pagador', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
};
const CONSENT_STATE = {
  ativa: { label: 'Ativa', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  revogada: { label: 'Revogada', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
};
export const DOC_KIND_LABEL = {
  apolice: 'Apólice', certificado: 'Certificado', proposta_formal: 'Proposta formal', cotacao_formal: 'Cotação formal', condicoes_gerais: 'Condições gerais',
  endosso: 'Endosso', boleto: 'Boleto', comprovante: 'Comprovante', documento_pessoal: 'Documento pessoal', vistoria: 'Vistoria', sinistro: 'Sinistro',
  contrato: 'Contrato', certidao: 'Certidão', evidencia: 'Evidência', questionario_restrito: 'Questionário restrito (saúde)', extrato_comissao: 'Extrato de comissão', outro: 'Outro',
};
const CHANNELS = { whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', presencial: 'Presencial' };
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const fmtSize = (b) => (b == null ? '—' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

// ---------------- Seletor de cliente (busca na carteira) ----------------
/** value: { id, name } | null. onChange recebe o cliente escolhido (ou null). */
export function ClientPicker({ label = 'Cliente', value, onChange, required, exclude, hint }) {
  const [term, setTerm] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return undefined;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get(`/v1/clients${qs({ q: term.trim(), limit: 20 })}`);
        if (my === seq.current) setList(r.filter((c) => c.id !== exclude));
      } catch { if (my === seq.current) setList([]); } finally { if (my === seq.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [term, open, exclude]);

  if (value?.id) {
    return (
      <div>
        <span className="label">{label}{required && ' *'}</span>
        <div className="input flex items-center justify-between gap-2">
          <span className="truncate">{value.name || 'Cliente selecionado'}</span>
          <button type="button" className="text-ink-faint hover:text-ink" aria-label="Trocar cliente" onClick={() => { onChange(null); setTerm(''); setOpen(true); }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
      </div>
    );
  }
  return (
    <div className="relative">
      <label className="block">
        <span className="label">{label}{required && ' *'}</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" value={term} placeholder="Buscar por nome, e-mail ou CPF/CNPJ" role="combobox" aria-expanded={open}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </label>
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
      {open && (
        <div className="card absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto p-1" role="listbox">
          {loading && <div className="flex items-center gap-2 px-3 py-2 text-sm text-ink-faint"><Spinner className="h-4 w-4" /> Buscando…</div>}
          {!loading && !list.length && <div className="px-3 py-2 text-sm text-ink-faint">Nenhum cliente encontrado.</div>}
          {!loading && list.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected="false"
              className="flex w-full items-center justify-between gap-3 rounded-app-sm px-3 py-2 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ id: c.id, name: c.name, phone: c.phone, email: c.email }); setOpen(false); }}>
              <span className="truncate font-medium">{c.name}</span>
              <span className="shrink-0 text-xs text-ink-faint">{c.document_masked || (c.kind === 'pj' ? 'PJ' : 'PF')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Formulário de cliente (cadastro e edição) ----------------
const emptyClient = () => ({
  kind: 'pf', name: '', trade_name: '', document: '', birth_date: '', email: '', phone: '',
  address: { cep: '', street: '', number: '', complement: '', district: '', city: '', uf: '' },
  owner_user_id: '', origin: '', preferred_channel: '', marketing_opt_out: false, notes: '', tags: '',
});

function ClientForm({ v, set, users, showDocument = true, documentMasked, canOwner = true }) {
  const [cepBusy, setCepBusy] = useState(false);
  const up = (k) => (e) => set({ ...v, [k]: e.target.value });
  const upA = (k, val) => set({ ...v, address: { ...v.address, [k]: val } });
  const onCep = async (val) => {
    const m = maskCep(val);
    upA('cep', m);
    if (onlyDigits(m).length === 8) {
      setCepBusy(true);
      const a = await lookupCep(m);
      setCepBusy(false);
      if (a) set((cur) => ({ ...cur, address: { ...cur.address, cep: m, street: a.street || cur.address.street, district: a.district || cur.address.district, city: a.city || cur.address.city, uf: a.uf || cur.address.uf } }));
    }
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Tipo de pessoa" value={v.kind} onChange={(e) => set({ ...v, kind: e.target.value, document: '' })}>
          <option value="pf">Pessoa física</option>
          <option value="pj">Pessoa jurídica</option>
        </Select>
        {showDocument ? (
          <Input label={v.kind === 'pj' ? 'CNPJ' : 'CPF'} inputMode="numeric" value={v.document} placeholder={v.kind === 'pj' ? '00.000.000/0000-00' : '000.000.000-00'}
            onChange={(e) => set({ ...v, document: maskDoc(e.target.value) })} hint="Usado para evitar cadastro duplicado." />
        ) : (
          <div><span className="label">{v.kind === 'pj' ? 'CNPJ' : 'CPF'}</span><div className="input bg-muted text-ink-soft">{documentMasked || 'não informado'}</div>
            <span className="mt-1 block text-xs text-ink-faint">Documento completo visível apenas com permissão de dados sensíveis.</span></div>
        )}
        <Input label={v.kind === 'pj' ? 'Razão social *' : 'Nome completo *'} value={v.name} onChange={up('name')} className="sm:col-span-2" />
        {v.kind === 'pj'
          ? <Input label="Nome fantasia" value={v.trade_name} onChange={up('trade_name')} />
          : <Input label="Data de nascimento" type="date" value={v.birth_date} onChange={up('birth_date')} />}
        <Input label="E-mail" type="email" value={v.email} onChange={up('email')} />
        <Input label="Telefone / WhatsApp" inputMode="tel" value={v.phone} onChange={(e) => set({ ...v, phone: maskPhone(e.target.value) })} placeholder="(00) 00000-0000" />
        <Select label="Canal preferido" value={v.preferred_channel} onChange={up('preferred_channel')}>
          <option value="">Não informado</option>
          {Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Endereço</legend>
        <div className="grid gap-4 sm:grid-cols-6">
          <label className="block sm:col-span-2">
            <span className="label">CEP</span>
            <div className="relative">
              <input className="input" inputMode="numeric" value={v.address.cep || ''} onChange={(e) => onCep(e.target.value)} placeholder="00000-000" />
              {cepBusy && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />}
            </div>
          </label>
          <Input label="Logradouro" value={v.address.street} onChange={(e) => upA('street', e.target.value)} className="sm:col-span-4" />
          <Input label="Número" value={v.address.number} onChange={(e) => upA('number', e.target.value)} className="sm:col-span-2" />
          <Input label="Complemento" value={v.address.complement} onChange={(e) => upA('complement', e.target.value)} className="sm:col-span-4" />
          <Input label="Bairro" value={v.address.district} onChange={(e) => upA('district', e.target.value)} className="sm:col-span-2" />
          <Input label="Cidade" value={v.address.city} onChange={(e) => upA('city', e.target.value)} className="sm:col-span-3" />
          <Select label="UF" value={v.address.uf || ''} onChange={(e) => upA('uf', e.target.value)} className="sm:col-span-1">
            <option value="">—</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {canOwner && (
          <Select label="Responsável (carteira)" value={v.owner_user_id || ''} onChange={up('owner_user_id')}>
            <option value="">Eu mesmo</option>
            {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        <Input label="Origem" value={v.origin} onChange={up('origin')} placeholder="indicação, site, carteira…" />
        <Input label="Etiquetas" value={v.tags} onChange={up('tags')} placeholder="separadas por vírgula" className={canOwner ? 'sm:col-span-2' : ''} />
        <Textarea label="Observações" value={v.notes} onChange={up('notes')} className="sm:col-span-2" />
      </div>
      <Toggle checked={!!v.marketing_opt_out} onChange={(x) => set({ ...v, marketing_opt_out: x })}
        label="Não deseja receber marketing" hint="Bloqueia mensagens de marketing mesmo que exista autorização registrada." />
    </div>
  );
}

const toPayload = (v) => {
  const addr = Object.fromEntries(Object.entries(v.address || {}).map(([k, x]) => [k, x ? String(x).trim() : null]));
  return {
    kind: v.kind, name: v.name.trim(), trade_name: v.kind === 'pj' ? (v.trade_name || '').trim() || null : null,
    document: onlyDigits(v.document) || null, birth_date: v.kind === 'pf' ? v.birth_date || null : null,
    email: (v.email || '').trim() || null, phone: (v.phone || '').trim() || null, address: addr,
    owner_user_id: v.owner_user_id || null, origin: (v.origin || '').trim() || null, preferred_channel: v.preferred_channel || null,
    marketing_opt_out: !!v.marketing_opt_out, notes: (v.notes || '').trim() || null,
    tags: String(v.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20),
  };
};

function useUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => { api.get('/v1/company/users').then((r) => setUsers((r || []).filter((u) => u.active !== false))).catch(() => setUsers([])); }, []);
  return users;
}

function NewClientModal({ open, onClose, onCreated }) {
  const { scope } = useAuth();
  const users = useUsers();
  const [v, setV] = useState(emptyClient);
  const [dup, setDup] = useState(null);
  const [similar, setSimilar] = useState(null);
  const [created, setCreated] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (open) { setV(emptyClient()); setDup(null); setSimilar(null); setCreated(null); } }, [open]);
  const docDigits = onlyDigits(v.document);
  const docOk = !docDigits || (v.kind === 'pf' ? docDigits.length === 11 : docDigits.length === 14);
  const save = async () => {
    setDup(null);
    const r = await run(() => api.post('/v1/clients', toPayload(v)), 'Cliente cadastrado.', (e) => {
      if (e.code === 'DUPLICATE_CLIENT') { setDup({ message: e.message, id: e.data?.client_id }); return true; }
      return false;
    });
    if (r === FAIL) return;
    if (r.similar?.length) { setCreated(r); setSimilar(r.similar); return; }
    onCreated(r);
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Novo cliente" subtitle="Campos com * são obrigatórios. CPF/CNPJ evita cadastros duplicados."
      footer={similar ? (
        <button className="btn-primary" onClick={() => onCreated(created)}>Abrir cadastro criado</button>
      ) : (
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <SubmitButton busy={busy} onClick={save} problems={[v.name.trim().length < 2 && { text: v.kind === 'pj' ? 'Informe a razão social.' : 'Informe o nome completo.', field: v.kind === 'pj' ? 'Razão social' : 'Nome completo' }, !docOk && { text: `${v.kind === 'pj' ? 'CNPJ' : 'CPF'} incompleto: confira os dígitos (ou deixe em branco).`, field: v.kind === 'pj' ? 'CNPJ' : 'CPF' }]}>{busy ? 'Salvando…' : 'Cadastrar cliente'}</SubmitButton>
        </>
      )}>
      {similar ? (
        <div className="space-y-3">
          <Notice tone="warn">
            <p className="font-medium">Possíveis homônimos — revisar</p>
            <p className="mt-1">O cliente foi cadastrado, mas já existem cadastros com o mesmo nome. Verifique se não é a mesma pessoa. Nada foi unido automaticamente; se for duplicidade, use “Possíveis duplicidades” na lista de clientes.</p>
          </Notice>
          <ul className="divide-y divide-line rounded-app-sm border border-line">
            {similar.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{s.name}</span>
                <Link className="text-primary hover:underline" to={`/clientes/${s.id}`} onClick={onClose}>Ver cadastro</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {dup && (
            <Notice tone="danger" className="mb-4">
              {dup.message}{' '}
              {dup.id && <Link to={`/clientes/${dup.id}`} className="font-medium underline" onClick={onClose}>Abrir cadastro existente</Link>}
            </Notice>
          )}
          {!docOk && <Notice tone="warn" className="mb-4">{v.kind === 'pf' ? 'CPF deve ter 11 dígitos.' : 'CNPJ deve ter 14 dígitos.'}</Notice>}
          <ClientForm v={v} set={setV} users={users} canOwner={scope('clients_view') === 'all'} />
        </>
      )}
    </Modal>
  );
}

// ---------------- Duplicidades e união revisada ----------------
function DuplicatesModal({ open, onClose, onMerged }) {
  const { data, loading, reload } = useFetch(() => (open ? api.get('/v1/clients/duplicates') : Promise.resolve(null)), [open]);
  const [pair, setPair] = useState(null);
  const [keep, setKeep] = useState('a');
  const [typed, setTyped] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { setKeep('a'); setTyped(''); }, [pair]);
  const keepId = pair && (keep === 'a' ? pair.a_id : pair.b_id);
  const mergeId = pair && (keep === 'a' ? pair.b_id : pair.a_id);
  const keepName = pair && (keep === 'a' ? pair.a_name : pair.b_name);
  const mergeName = pair && (keep === 'a' ? pair.b_name : pair.a_name);
  const doMerge = async () => {
    const r = await run(() => api.post(`/v1/clients/${keepId}/merge`, { merge_id: mergeId, confirm: true }), 'Cadastros unidos.');
    if (r === FAIL) return;
    setPair(null);
    reload();
    onMerged?.();
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Possíveis duplicidades"
      subtitle="Sugestões por mesmo nome, e-mail ou telefone. Nenhuma união é automática: revise cada caso.">
      {pair ? (
        <div className="space-y-4">
          <button className="btn-ghost -ml-2" onClick={() => setPair(null)}><ArrowLeft className="h-4 w-4" /> Voltar à lista</button>
          <p className="text-sm">Motivo da sugestão: <strong>{pair.reason}</strong>. Abra os dois cadastros e confira documento, endereço e contratos antes de unir.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[['a', pair.a_id, pair.a_name], ['b', pair.b_id, pair.b_name]].map(([k, id, name]) => (
              <label key={k} className={cx('card flex cursor-pointer items-start gap-3 p-3', keep === k && 'ring-2 ring-primary')}>
                <input type="radio" name="keep" className="mt-1" checked={keep === k} onChange={() => setKeep(k)} />
                <span className="min-w-0">
                  <span className="block font-medium">{name}</span>
                  <span className="block text-xs text-ink-faint">{keep === k ? 'Cadastro principal (permanece)' : 'Será unido ao principal'}</span>
                  <Link to={`/clientes/${id}`} target="_blank" className="mt-1 inline-block text-xs text-primary hover:underline">Abrir em nova aba</Link>
                </span>
              </label>
            ))}
          </div>
          <Notice tone="danger">
            <p className="font-medium">Ação irreversível pela interface</p>
            <p className="mt-1">Oportunidades, cotações, propostas, apólices (como contratante, segurado ou pagador), sinistros, documentos, autorizações, contatos e histórico de <strong>{mergeName}</strong> passarão para <strong>{keepName}</strong>. O cadastro secundário fica marcado como unido (não é apagado). Se os documentos forem diferentes, a união é recusada.</p>
          </Notice>
          <Input label='Para confirmar, digite UNIR' value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setPair(null)}>Cancelar</button>
            <button className="btn-danger" disabled={busy || typed.trim().toUpperCase() !== 'UNIR'} onClick={doMerge}>
              <GitMerge className="h-4 w-4" /> {busy ? 'Unindo…' : `Unir em “${keepName}”`}
            </button>
          </div>
        </div>
      ) : loading ? <Loading /> : !data?.length ? (
        <Empty icon={ShieldCheck} title="Nenhuma duplicidade sugerida" text="Não encontramos cadastros com mesmo nome, e-mail ou telefone." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Cadastro A</th><th>Cadastro B</th><th>Motivo</th><th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={`${p.a_id}-${p.b_id}`}>
                  <td>{p.a_name}</td><td>{p.b_name}</td><td><span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">{p.reason}</span></td>
                  <td className="text-right"><button className="btn-outline" onClick={() => setPair(p)}>Revisar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Lista ----------------
export default function Clients() {
  const { can } = useAuth();
  const { toast } = useUI();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dupOpen, setDupOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/clients${qs({ q: debounced, limit: 300 })}`), [debounced]);
  const newOpen = sp.get('novo') === '1';
  const closeNew = () => { const n = new URLSearchParams(sp); n.delete('novo'); setSp(n, { replace: true }); };
  const t = useTable(data, { sort: 'name', get: { owner: (r) => r.owner_name } });

  const doExport = async () => {
    setExporting(true);
    try { await download('/v1/clients/export', 'clientes.csv'); } catch (e) { toast(e.message, 'error'); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Clientes" subtitle="Carteira de pessoas físicas e jurídicas, com vínculos, autorizações e histórico."
        actions={<>
          {can('clients_edit') && <button className="btn-outline" onClick={() => setDupOpen(true)}><GitMerge className="h-4 w-4" /> Possíveis duplicidades</button>}
          {can('clients_export') && <button className="btn-outline" disabled={exporting} onClick={doExport}><Download className="h-4 w-4" /> {exporting ? 'Exportando…' : 'Exportar CSV'}</button>}
          {can('clients_edit') && <button className="btn-primary" onClick={() => setSp({ novo: '1' })}><Plus className="h-4 w-4" /> Novo cliente</button>}
        </>} />

      <div className="mb-4 max-w-md">
        <label className="relative block">
          <span className="sr-only">Buscar clientes</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nome, e-mail ou CPF/CNPJ" />
        </label>
      </div>

      {loading && !data ? <Loading /> : !data ? (
        <Section><Empty icon={AlertTriangle} title="Não foi possível carregar os clientes" action={<button className="btn-outline" onClick={reload}>Tentar de novo</button>} /></Section>
      ) : !data.length ? (
        <Section>
          <Empty icon={Users} title={debounced ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            text={debounced ? 'Revise o termo de busca.' : 'Cadastre o primeiro cliente para começar a cotar.'}
            action={can('clients_edit') && !debounced && <button className="btn-primary" onClick={() => setSp({ novo: '1' })}><Plus className="h-4 w-4" /> Novo cliente</button>} />
        </Section>
      ) : (
        <div className={cx('card overflow-x-auto', loading && 'opacity-60')}>
          <table className="table-clean">
            <thead>
              <tr>
                <SortTh t={t} k="name">Nome</SortTh>
                <th>CPF/CNPJ</th>
                <th>Contato</th>
                <SortTh t={t} k="owner">Responsável</SortTh>
                <SortTh t={t} k="active_policies">Apólices vigentes</SortTh>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => nav(`/clientes/${c.id}`)}>
                  <td>
                    <Link to={`/clientes/${c.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                    <div className="text-xs text-ink-faint">{c.kind === 'pj' ? 'Pessoa jurídica' : 'Pessoa física'}{c.trade_name ? ` · ${c.trade_name}` : ''}</div>
                  </td>
                  <td className="tabular-nums">{c.document ? maskDoc(c.document) : c.document_masked || '—'}</td>
                  <td><div>{c.phone || '—'}</div><div className="text-xs text-ink-faint">{c.email || ''}</div></td>
                  <td>{c.owner_name || '—'}</td>
                  <td className="tabular-nums">{c.active_policies}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}

      <NewClientModal open={newOpen} onClose={closeNew} onCreated={(c) => { closeNew(); nav(`/clientes/${c.id}`); }} />
      <DuplicatesModal open={dupOpen} onClose={() => setDupOpen(false)} onMerged={reload} />
    </>
  );
}

// ---------------- Ficha do cliente ----------------
const fromClient = (c) => ({
  kind: c.kind || 'pf', name: c.name || '', trade_name: c.trade_name || '', document: c.document ? maskDoc(c.document) : '', birth_date: c.birth_date ? String(c.birth_date).slice(0, 10) : '',
  email: c.email || '', phone: c.phone || '',
  address: { cep: '', street: '', number: '', complement: '', district: '', city: '', uf: '', ...(c.address || {}) },
  owner_user_id: c.owner_user_id || '', origin: c.origin || '', preferred_channel: c.preferred_channel || '', marketing_opt_out: !!c.marketing_opt_out,
  notes: c.notes || '', tags: (c.tags || []).join(', '),
});

function DataTab({ c, reload }) {
  const { can, scope } = useAuth();
  const users = useUsers();
  const sensitive = can('clients_sensitive') || (c.document == null && !c.document_masked);
  const [v, setV] = useState(() => fromClient(c));
  const [conflict, setConflict] = useState(false);
  const [run, busy] = useAction();
  useEffect(() => { setV(fromClient(c)); setConflict(false); }, [c]);
  const editable = can('clients_edit') && !c.merged_into;
  const save = async () => {
    const next = toPayload(v);
    const base = toPayload(fromClient(c));
    const body = { version: c.version };
    Object.keys(next).forEach((k) => { if (JSON.stringify(next[k]) !== JSON.stringify(base[k])) body[k] = next[k]; });
    if (!sensitive) delete body.document; // sem permissão o documento chega mascarado: nunca enviar
    if (Object.keys(body).length === 1) return;
    const r = await run(() => api.put(`/v1/clients/${c.id}`, body), 'Cadastro atualizado.', (e) => {
      if (e.code === 'VERSION_CONFLICT') { setConflict(true); return true; }
      return false;
    });
    if (r !== FAIL) reload();
  };
  return (
    <Section title="Dados cadastrais" subtitle={`Versão ${c.version} · atualizado ${fmtDateTime(c.updated_at)}`}
      actions={editable && <button className="btn-primary" disabled={busy || v.name.trim().length < 2} onClick={save}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>}>
      {conflict && (
        <Notice tone="danger" className="mb-4">
          Este cadastro foi alterado por outra pessoa enquanto você editava. Nada foi sobrescrito.{' '}
          <button className="font-medium underline" onClick={reload}>Recarregar dados</button> e refaça suas alterações.
        </Notice>
      )}
      {!editable && <Notice className="mb-4">{c.merged_into ? 'Cadastro unido a outro cliente — edite o cadastro principal.' : 'Você não tem permissão para editar este cadastro.'}</Notice>}
      <fieldset disabled={!editable}>
        <ClientForm v={v} set={setV} users={users} showDocument={sensitive} documentMasked={c.document_masked} canOwner={scope('clients_view') === 'all'} />
      </fieldset>
      <p className="mt-4 text-xs text-ink-faint">Alterações ficam registradas no histórico do cliente. Dados usados em cotações anteriores não são modificados nelas.</p>
    </Section>
  );
}

function ContactsTab({ c, reload }) {
  const { can } = useAuth();
  const { confirm } = useUI();
  const [v, setV] = useState({ name: '', role: '', email: '', phone: '', authorized: false });
  const [run, busy] = useAction();
  const add = async () => {
    const r = await run(() => api.post(`/v1/clients/${c.id}/contacts`, { ...v, role: v.role || null, email: v.email || null, phone: v.phone || null }), 'Contato adicionado.');
    if (r !== FAIL) { setV({ name: '', role: '', email: '', phone: '', authorized: false }); reload(); }
  };
  const del = async (x) => {
    if (!(await confirm({ title: 'Remover contato?', message: `${x.name} deixará de constar como contato deste cliente.`, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/v1/clients/${c.id}/contacts/${x.id}`), 'Contato removido.')) !== FAIL) reload();
  };
  return (
    <div className="space-y-4">
      <Section title="Contatos" subtitle="Pessoas de contato (ex.: financeiro de empresa, cônjuge que acompanha o seguro).">
        {!c.contacts.length ? <Empty title="Nenhum contato adicional" /> : (
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Nome</th><th>Função</th><th>Telefone</th><th>E-mail</th><th>Autorizado</th><th /></tr></thead>
              <tbody>
                {c.contacts.map((x) => (
                  <tr key={x.id}>
                    <td className="font-medium">{x.name}</td><td>{x.role || '—'}</td><td>{x.phone || '—'}</td><td>{x.email || '—'}</td>
                    <td>{x.authorized ? <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Pode tratar do seguro</span> : <span className="chip bg-muted text-ink-soft">Só contato</span>}</td>
                    <td className="text-right">{can('clients_edit') && <button className="btn-ghost btn-icon" aria-label={`Remover ${x.name}`} onClick={() => del(x)}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {can('clients_edit') && (
        <Section title="Adicionar contato">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome *" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            <Input label="Função / relação" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} placeholder="financeiro, cônjuge…" />
            <Input label="Telefone" value={v.phone} onChange={(e) => setV({ ...v, phone: maskPhone(e.target.value) })} />
            <Input label="E-mail" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </div>
          <Toggle checked={v.authorized} onChange={(x) => setV({ ...v, authorized: x })} label="Autorizado a tratar do seguro" hint="Marque somente se o cliente autorizou expressamente." />
          <div className="mt-3 flex justify-end"><button className="btn-primary" disabled={busy || v.name.trim().length < 2} onClick={add}><Plus className="h-4 w-4" /> Adicionar</button></div>
        </Section>
      )}
    </div>
  );
}

function RelationsTab({ c, reload }) {
  const { can, meta } = useAuth();
  const { confirm } = useUI();
  const [rel, setRel] = useState({ client: null, relation: 'conjuge', notes: '' });
  const [run, busy] = useAction();
  const relations = meta?.relations || Object.keys(RELATION_LABEL);
  const add = async () => {
    const r = await run(() => api.post(`/v1/clients/${c.id}/relationships`, { related_client_id: rel.client.id, relation: rel.relation, notes: rel.notes || null }), 'Vínculo registrado.');
    if (r !== FAIL) { setRel({ client: null, relation: 'conjuge', notes: '' }); reload(); }
  };
  const del = async (x) => {
    if (!(await confirm({ title: 'Remover vínculo?', message: `O vínculo “${relationLabel(x.relation)}” com ${x.related_name} será removido. Contratos não são alterados.`, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/v1/clients/${c.id}/relationships/${x.id}`), 'Vínculo removido.')) !== FAIL) reload();
  };
  return (
    <div className="space-y-4">
      <Notice>
        Em um seguro, <strong>contratante</strong> (quem contrata e assina), <strong>segurado</strong> (pessoa ou bem protegido) e <strong>pagador</strong> (quem paga o prêmio) podem ser pessoas diferentes.
        Registre aqui os vínculos entre cadastros; o papel em cada apólice aparece na aba “Apólices e mais”.
      </Notice>
      <Section title="Vínculos com outros cadastros">
        {!c.relationships.length ? <Empty icon={Link2} title="Nenhum vínculo registrado" /> : (
          <ul className="divide-y divide-line">
            {c.relationships.map((x) => (
              <li key={`${x.id}-${x.relation}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link to={`/clientes/${x.related_client_id}`} className="font-medium hover:text-primary">{x.related_name}</Link>
                  <div className="text-xs text-ink-faint">{relationLabel(x.relation)}{x.notes ? ` · ${x.notes}` : ''}</div>
                </div>
                {can('clients_edit') && <button className="btn-ghost btn-icon" aria-label={`Remover vínculo com ${x.related_name}`} onClick={() => del(x)}><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {can('clients_edit') && (
        <Section title="Novo vínculo">
          <div className="grid gap-4 sm:grid-cols-2">
            <ClientPicker label="Cadastro relacionado" required value={rel.client} exclude={c.id} onChange={(x) => setRel({ ...rel, client: x })} />
            <Select label={`Relação (o outro cadastro é… de ${c.name.split(' ')[0]})`} value={rel.relation} onChange={(e) => setRel({ ...rel, relation: e.target.value })}>
              {relations.map((r) => <option key={r} value={r}>{RELATION_LABEL[r] || r}</option>)}
            </Select>
            <Input label="Observação" value={rel.notes} onChange={(e) => setRel({ ...rel, notes: e.target.value })} className="sm:col-span-2" />
          </div>
          <div className="mt-3 flex justify-end"><button className="btn-primary" disabled={busy || !rel.client} onClick={add}><Plus className="h-4 w-4" /> Registrar vínculo</button></div>
        </Section>
      )}
    </div>
  );
}

function ConsentsTab({ c, reload }) {
  const { can, meta } = useAuth();
  const purposes = Object.entries(meta?.purposes || {}).filter(([k]) => k !== 'open_insurance');
  const [v, setV] = useState({ purpose: 'cotacao', legal_basis: '', recipients: '', evidence: '' });
  const [revoke, setRevoke] = useState(null);
  const [run, busy] = useAction();
  const add = async () => {
    const r = await run(() => api.post(`/v1/clients/${c.id}/consents`, { purpose: v.purpose, legal_basis: v.legal_basis || null, recipients: v.recipients || null, evidence: v.evidence.trim() }), 'Autorização registrada.');
    if (r !== FAIL) { setV({ purpose: 'cotacao', legal_basis: '', recipients: '', evidence: '' }); reload(); }
  };
  const label = (p) => meta?.purposes?.[p] || p;
  return (
    <div className="space-y-4">
      <Notice>
        Cada finalidade tem autorização própria e pode ser revogada a qualquer momento. Autorização para cotação não vale para marketing.
        Consentimentos de Open Insurance seguem o fluxo do participante habilitado e não são registrados aqui.
      </Notice>
      <Section title="Autorizações registradas">
        {!c.consents.length ? <Empty icon={ShieldCheck} title="Nenhuma autorização registrada" /> : (
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Finalidade</th><th>Situação</th><th>Base legal / destinatários</th><th>Evidência</th><th>Registro</th><th /></tr></thead>
              <tbody>
                {c.consents.map((x) => (
                  <tr key={x.id}>
                    <td className="font-medium">{label(x.purpose)}</td>
                    <td><StatusChip map={CONSENT_STATE} value={x.revoked_at ? 'revogada' : 'ativa'} />
                      {x.revoked_at && <div className="mt-1 text-xs text-ink-faint">em {fmtDateTime(x.revoked_at)}{x.revoked_reason ? ` — ${x.revoked_reason}` : ''}</div>}</td>
                    <td><div>{x.legal_basis || '—'}</div><div className="text-xs text-ink-faint">{x.recipients || ''}</div></td>
                    <td className="max-w-xs text-sm">{x.evidence}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(x.granted_at)}</td>
                    <td className="text-right">{!x.revoked_at && can('clients_edit') && <button className="btn-outline" onClick={() => setRevoke(x)}>Revogar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {can('clients_edit') && (
        <Section title="Registrar autorização">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Finalidade" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>
              {purposes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Input label="Base legal" value={v.legal_basis} onChange={(e) => setV({ ...v, legal_basis: e.target.value })} placeholder="consentimento, execução de contrato…" />
            <Input label="Destinatários" value={v.recipients} onChange={(e) => setV({ ...v, recipients: e.target.value })} placeholder="seguradoras consultadas, parceiros…" className="sm:col-span-2" />
            <Textarea label="Evidência * (como e quando foi obtida)" value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })}
              placeholder="Ex.: autorização por WhatsApp em 05/10/2026, print anexado em Documentos" className="sm:col-span-2" />
          </div>
          <div className="mt-3 flex justify-end"><button className="btn-primary" disabled={busy || v.evidence.trim().length < 3} onClick={add}><ShieldCheck className="h-4 w-4" /> Registrar</button></div>
        </Section>
      )}
      <PromptModal open={!!revoke} danger confirmText="Revogar autorização" title="Revogar autorização"
        subtitle={revoke ? `${label(revoke.purpose)} — a revogação é registrada na auditoria e vale a partir de agora.` : ''}
        fields={[{ key: 'reason', label: 'Motivo / como o cliente pediu', required: true, textarea: true }]}
        onClose={() => setRevoke(null)}
        onSubmit={async ({ reason }) => {
          const r = await run(() => api.post(`/v1/clients/${c.id}/consents/${revoke.id}/revoke`, { reason }), 'Autorização revogada.');
          if (r !== FAIL) { setRevoke(null); reload(); }
        }} />
    </div>
  );
}

function ServiceTab({ c, reload }) {
  const [v, setV] = useState({ kind: 'nota', summary: '' });
  const [wa, setWa] = useState('');
  const [run, busy] = useAction();
  const add = async () => {
    const r = await run(() => api.post(`/v1/clients/${c.id}/activities`, { kind: v.kind, summary: v.summary.trim() }), 'Registro adicionado.');
    if (r !== FAIL) { setV({ ...v, summary: '' }); reload(); }
  };
  const link = c.phone ? waLink(c.phone, wa || `Olá ${c.name.split(' ')[0]}!`) : null;
  const logWa = () => {
    if (!wa.trim()) return;
    api.post(`/v1/clients/${c.id}/activities`, { kind: 'whatsapp', summary: `Mensagem aberta no WhatsApp do aparelho: ${wa.trim().slice(0, 3900)}` }).then(reload).catch(() => {});
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Section title="Histórico de atendimento" subtitle="Ligações, mensagens, reuniões, reclamações e alterações de cadastro.">
        {!c.timeline.length ? <Empty title="Sem registros" /> : (
          <ol className="relative space-y-4 border-l border-line pl-5">
            {c.timeline.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span className="chip bg-muted text-ink-soft">{ACTIVITY_KIND[a.kind] || a.kind || 'Registro'}</span>
                  <span>{fmtDateTime(a.created_at)}</span><span>· {a.created_by_name || 'Sistema'}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{a.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <div className="space-y-4">
        <Section title="Novo registro">
          <div className="space-y-3">
            <Select label="Tipo" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              {Object.entries(ACTIVITY_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Textarea label="Resumo" rows={4} value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />
            <div className="flex justify-end"><button className="btn-primary" disabled={busy || v.summary.trim().length < 2} onClick={add}>Registrar</button></div>
          </div>
        </Section>
        <Section title="WhatsApp" subtitle="Abre o WhatsApp do seu aparelho com o texto. Nada é enviado pelo sistema.">
          {!c.phone ? <Notice tone="warn">Cliente sem telefone cadastrado.</Notice> : (
            <div className="space-y-3">
              <Textarea label="Mensagem" rows={4} value={wa} onChange={(e) => setWa(e.target.value)} placeholder={`Olá ${c.name.split(' ')[0]}!`} />
              {c.marketing_opt_out && <p className="text-xs text-ink-faint">Cliente não deseja marketing: use apenas para relacionamento e serviço.</p>}
              <a className="btn-primary w-full justify-center" href={link} target="_blank" rel="noopener noreferrer" onClick={logWa}>
                <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
              </a>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function LinksTab({ c, branchLabel }) {
  return (
    <div className="space-y-4">
      <Section title="Apólices" subtitle="Papel do cliente em cada contrato: contratante, segurado ou pagador.">
        {!c.policies.length ? <Empty title="Nenhuma apólice" /> : (
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Apólice</th><th>Papel</th><th>Ramo / seguradora</th><th>Vigência</th><th>Situação</th><th>Prêmio total</th></tr></thead>
              <tbody>
                {c.policies.map((p) => (
                  <tr key={`${p.id}-${p.role}`}>
                    <td><Link to={`/apolices/${p.id}`} className="font-medium hover:text-primary">{p.policy_number || 'Sem número'}</Link></td>
                    <td><StatusChip map={ROLE_CHIP} value={p.role} /></td>
                    <td><div>{branchLabel(p.branch)}</div><div className="text-xs text-ink-faint">{p.institution_name}</div></td>
                    <td className="whitespace-nowrap">{fmt(p.start_date)} a {fmt(p.end_date)}</td>
                    <td><StatusChip map={CONTRACT_STATE} value={p.contract_state} /> <StatusChip map={DOC_STATE} value={p.doc_state} /></td>
                    <td className="tabular-nums">{money(p.total_premium_cents, 'não informado')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="Oportunidades">
        {!c.opportunities.length ? <Empty title="Nenhuma oportunidade" /> : (
          <ul className="divide-y divide-line">
            {c.opportunities.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div><Link to={`/oportunidades?abrir=${o.id}`} className="font-medium hover:text-primary">{o.title}</Link>
                  <div className="text-xs text-ink-faint">{branchLabel(o.branch)} · próxima ação: {o.next_action_at ? fmtDateTime(o.next_action_at) : 'sem próxima ação'}</div></div>
                <StatusChip map={STAGES} value={o.stage} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Sinistros">
          {!c.claims.length ? <Empty title="Nenhum sinistro" /> : (
            <ul className="divide-y divide-line">
              {c.claims.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div><Link to={`/sinistros/${x.id}`} className="font-medium hover:text-primary">Sinistro nº {x.number}</Link>
                    <div className="text-xs text-ink-faint">{fmt(x.occurred_at)} · {x.description}</div></div>
                  <StatusChip map={CLAIM_STATUS} value={x.work_status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Solicitações de serviço">
          {!c.service_requests.length ? <Empty title="Nenhuma solicitação" /> : (
            <ul className="divide-y divide-line">
              {c.service_requests.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div><Link to="/sinistros?tab=solicitacoes" className="font-medium hover:text-primary">Solicitação nº {x.number}</Link>
                    <div className="text-xs text-ink-faint">{x.kind} · {fmt(x.created_at)}</div></div>
                  <StatusChip map={REQUEST_STATUS} value={x.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function DocumentsTab({ c }) {
  const { can } = useAuth();
  const { toast } = useUI();
  const { data, loading, reload } = useFetch(() => api.get(`/v1/documents${qs({ client_id: c.id })}`), [c.id]);
  const [kind, setKind] = useState('documento_pessoal');
  const [run, busy] = useAction();
  const upload = async (file) => {
    let payload;
    try { payload = await fileToPayload(file); } catch (e) { toast(e.message, 'error'); return; }
    const r = await run(() => api.post('/v1/documents', { entity: 'client', entity_id: c.id, client_id: c.id, kind, ...payload }), 'Documento enviado.');
    if (r !== FAIL) reload();
  };
  const get = async (d) => { try { await download(`/v1/documents/${d.id}/download`, d.filename); } catch (e) { toast(e.message, 'error'); } };
  const kinds = Object.entries(DOC_KIND_LABEL).filter(([k]) => k !== 'questionario_restrito' || can('documents_restricted'));
  return (
    <Section title="Documentos do cliente" subtitle="Arquivos privados (PDF, imagens, planilhas) com versão e registro de acesso."
      actions={(
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="sr-only">Tipo do documento</span>
            <select className="input h-9 py-1" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo do documento">
              {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <FileButton className="btn-primary" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xml,.xlsx" onFile={upload}>
            <Upload className="h-4 w-4" /> {busy ? 'Enviando…' : 'Enviar arquivo'}
          </FileButton>
        </div>
      )}>
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={FileText} title="Nenhum documento" text="Envie documentos pessoais, comprovantes e evidências (até 8 MB)." /> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Arquivo</th><th>Tipo</th><th>Vínculo</th><th>Tamanho</th><th>Enviado em</th><th /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.filename}{d.version > 1 && <span className="ml-1 text-xs text-ink-faint">v{d.version}</span>}
                    {d.access_level === 'restrito' && <span className="chip ml-2 bg-red-500/10 text-red-700 dark:text-red-300">Restrito</span>}</td>
                  <td>{DOC_KIND_LABEL[d.kind] || d.kind}</td>
                  <td className="text-xs">{{ client: 'Cadastro', policy: 'Apólice', proposal: 'Proposta', claim: 'Sinistro', quote_request: 'Cotação' }[d.entity] || d.entity}</td>
                  <td className="tabular-nums">{fmtSize(d.size)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(d.created_at)}</td>
                  <td className="text-right"><button className="btn-ghost" onClick={() => get(d)}><Download className="h-4 w-4" /> Baixar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, branchLabel } = useAuth();
  const { data: c, loading, reload } = useFetch(() => api.get(`/v1/clients/${id}`), [id]);
  const [tab, setTab] = useState('dados');
  useEffect(() => { setTab('dados'); }, [id]);
  const activeConsents = useMemo(() => (c?.consents || []).filter((x) => !x.revoked_at).length, [c]);

  if (loading && !c) return <Loading />;
  if (!c) {
    return (
      <Section>
        <Empty icon={AlertTriangle} title="Cliente não encontrado" text="O cadastro não existe ou você não tem acesso a ele."
          action={<Link to="/clientes" className="btn-outline"><ArrowLeft className="h-4 w-4" /> Voltar para clientes</Link>} />
      </Section>
    );
  }
  const tabs = [
    { value: 'dados', label: 'Dados' },
    { value: 'contatos', label: `Contatos (${c.contacts.length})` },
    { value: 'vinculos', label: `Vínculos (${c.relationships.length})` },
    { value: 'autorizacoes', label: `Autorizações (${activeConsents})` },
    { value: 'atendimento', label: 'Atendimento' },
    { value: 'contratos', label: `Apólices e mais (${c.policies.length})` },
    { value: 'documentos', label: 'Documentos' },
  ];
  const KindIcon = c.kind === 'pj' ? Building2 : User;
  return (
    <>
      <Link to="/clientes" className="btn-ghost -ml-2 mb-2"><ArrowLeft className="h-4 w-4" /> Clientes</Link>
      <PageHeader title={c.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <KindIcon className="h-4 w-4" aria-hidden />{c.kind === 'pj' ? 'Pessoa jurídica' : 'Pessoa física'}
          <span>· {c.document ? maskDoc(c.document) : c.document_masked || 'sem documento'}</span>
          {c.owner_name && <span>· Responsável: {c.owner_name}</span>}
          {c.marketing_opt_out && <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">Não deseja marketing</span>}
        </span>}
        actions={<>
          {c.phone && <a className="btn-outline" href={`tel:${onlyDigits(c.phone)}`}><Phone className="h-4 w-4" /> Ligar</a>}
          {c.email && <a className="btn-outline" href={`mailto:${c.email}`}><Mail className="h-4 w-4" /> E-mail</a>}
          {can('opportunities') && <button className="btn-outline" onClick={() => nav(`/oportunidades?novo=1&client=${c.id}`)}><Target className="h-4 w-4" /> Nova oportunidade</button>}
          {can('quotes_manage') && <button className="btn-primary" onClick={() => nav(`/cotacoes/nova?client=${c.id}`)}><Calculator className="h-4 w-4" /> Nova cotação</button>}
        </>} />
      {c.merged_into && (
        <Notice tone="warn" className="mb-4">Este cadastro foi unido a <Link className="font-medium underline" to={`/clientes/${c.merged_into}`}>{c.merged_into_name || 'outro cliente'}</Link>.</Notice>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'dados' && <DataTab c={c} reload={reload} />}
      {tab === 'contatos' && <ContactsTab c={c} reload={reload} />}
      {tab === 'vinculos' && <RelationsTab c={c} reload={reload} />}
      {tab === 'autorizacoes' && <ConsentsTab c={c} reload={reload} />}
      {tab === 'atendimento' && <ServiceTab c={c} reload={reload} />}
      {tab === 'contratos' && <LinksTab c={c} branchLabel={branchLabel} />}
      {tab === 'documentos' && <DocumentsTab c={c} />}
      <div className="mt-6"><KV cols={4} items={[['Cadastrado em', fmtDateTime(c.created_at)], ['Origem', c.origin], ['Canal preferido', CHANNELS[c.preferred_channel] || c.preferred_channel], ['Etiquetas', (c.tags || []).join(', ') || '—']]} /></div>
    </>
  );
}
