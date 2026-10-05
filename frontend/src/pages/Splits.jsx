// Repasses a produtores, assessorias e parceiros (15). Liberação pela regra congelada na apólice; lote aprovado
// fica travado; "pago" só com evidência bancária conciliada; estorno após pagamento vira valor recuperável separado.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Users, Pencil, KeyRound, Ban, Layers, CheckCircle2, Banknote, XCircle, ShieldCheck, Wallet, RotateCcw, Clock, Info } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, fmtDateTime, pct, ymd, docNumber, maskDoc, maskPhone, ACCRUAL_STATUS, ACCRUAL_KIND, BATCH_STATUS, BRANCHES } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import {
  PageHeader, Section, KV, Tabs, Stat, Modal, PromptModal, Input, Textarea, Select, Toggle, CentsInput, StatusChip, Notice, Empty, Loading, useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';

const TABS = [
  { value: 'parceiros', label: 'Parceiros' },
  { value: 'regras', label: 'Regras' },
  { value: 'liberacoes', label: 'Liberações' },
  { value: 'lotes', label: 'Lotes de pagamento' },
];
const PARTNER_KIND = { produtor: 'Produtor', assessoria: 'Assessoria', parceiro: 'Parceiro', filial: 'Filial' };
const BASE = {
  comissao_bruta: { label: 'Comissão bruta', help: 'Valor bruto liquidado pela seguradora, antes de retenções e deduções.' },
  comissao_liquida: { label: 'Comissão líquida', help: 'Líquido recebido (bruto − retenções − deduções), conforme definição contratual.' },
  recebimento_efetivo: { label: 'Recebimento efetivo', help: 'O que efetivamente entrou na corretora por esta comissão (líquido proporcional).' },
};
const RELEASE = { no_recebimento: 'No recebimento da comissão', antecipado: 'Antecipado (antes do recebimento)' };
const REVERSAL = { proporcional: 'Proporcional ao estorno', nenhuma: 'Sem reversão' };

const Num = ({ v, className }) => <span className={cx('tabular-nums', Number(v) < 0 && 'text-red-600 dark:text-red-400', className)}>{money(v)}</span>;
const smallBtn = 'btn-ghost h-8 px-2 text-xs';

export default function Splits() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'parceiros';
  return (
    <div>
      <PageHeader title="Repasses" subtitle="Valores devidos a produtores, assessorias e parceiros sobre a comissão recebida. Não se confundem com a comissão da corretora nem com o prêmio do cliente." />
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'parceiros' && <Partners />}
      {tab === 'regras' && <Rules />}
      {tab === 'liberacoes' && <Accruals />}
      {tab === 'lotes' && <Batches />}
    </div>
  );
}

const usePartners = () => useFetch(() => api.get('/v1/partners'), []);

// =====================================================================================
// Parceiros
// =====================================================================================
const emptyBank = { holder: '', holder_document: '', bank: '', agency: '', account: '', pix_key: '' };
const cleanBank = (b) => Object.fromEntries(Object.entries(b).filter(([, v]) => String(v || '').trim() !== '').map(([k, v]) => [k, String(v).trim()]));
const bankOk = (b) => String(b.holder || '').trim().length >= 2 && String(b.holder_document || '').trim() && (String(b.account || '').trim() || String(b.pix_key || '').trim());

function BankFields({ v, onChange }) {
  const set = (k) => (e) => onChange({ ...v, [k]: k === 'holder_document' ? maskDoc(e.target.value) : e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Titular" value={v.holder} onChange={set('holder')} />
      <Input label="CPF/CNPJ do titular" value={v.holder_document} onChange={set('holder_document')} />
      <Input label="Banco" value={v.bank} onChange={set('bank')} />
      <Input label="Agência" value={v.agency} onChange={set('agency')} />
      <Input label="Conta" value={v.account} onChange={set('account')} />
      <Input label="Chave PIX" value={v.pix_key} onChange={set('pix_key')} />
    </div>
  );
}

function Payee({ b }) {
  if (!b) return <span className="text-xs text-ink-faint">não cadastrado / sem acesso</span>;
  return (
    <div className="text-xs leading-5">
      <div className="text-sm text-ink">{b.holder}</div>
      <div className="text-ink-faint">{[b.bank, b.agency && `ag. ${b.agency}`, b.account && `c/c ${b.account}`].filter(Boolean).join(' · ')}{b.pix_key ? ` · PIX ${b.pix_key}` : ''}</div>
    </div>
  );
}

function Partners() {
  const { can, user } = useAuth();
  const { data, loading, reload } = usePartners();
  const t = useTable(data || [], { sort: 'name' });
  const [form, setForm] = useState(null); // { mode:'new'|'edit', id?, v }
  const [bank, setBank] = useState(null); // partner
  const [run, busy] = useAction();
  const totals = useMemo(() => (data || []).reduce((a, p) => ({ payable: a.payable + Number(p.payable_cents), recoverable: a.recoverable + Number(p.recoverable_cents),
    in_batch: a.in_batch + Number(p.in_batch_cents), paid: a.paid + Number(p.paid_cents) }), { payable: 0, recoverable: 0, in_batch: 0, paid: 0 }), [data]);

  const save = async () => {
    const v = form.v;
    if (form.mode === 'new') {
      const body = { kind: v.kind, name: v.name, document: v.document || null, email: v.email || null, phone: v.phone || null, bank_info: v.withBank ? cleanBank(v.bank) : null };
      const r = await run(() => api.post('/v1/partners', body), 'Parceiro cadastrado.');
      if (r !== FAIL) { setForm(null); reload(); }
    } else {
      const r = await run(() => api.put(`/v1/partners/${form.id}`, { name: v.name, email: v.email || null, phone: v.phone || null, active: v.active }), 'Parceiro atualizado.');
      if (r !== FAIL) { setForm(null); reload(); }
    }
  };
  const fv = form?.v;
  const okForm = fv && String(fv.name || '').trim().length >= 2 && (!fv.withBank || bankOk(fv.bank));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Liberado a pagar" value={money(totals.payable)} hint="Liberações menos reduções, ainda fora de lote." icon={Wallet} />
        <Stat label="Em lote" value={money(totals.in_batch)} hint="Em lote de pagamento, aguardando aprovação/pagamento." icon={Layers} />
        <Stat label="Pago (conciliado)" value={money(totals.paid)} hint="Só conta como pago com débito bancário conciliado." icon={CheckCircle2} tone="text-emerald-600" />
        <Stat label="Recuperável" value={money(totals.recoverable)} hint="Repasse já pago de comissão estornada. Compensação só com autorização." icon={RotateCcw} tone={totals.recoverable ? 'text-orange-600' : undefined} />
      </div>
      <div className="flex justify-end">
        {can('splits_manage') && <button className="btn-primary" onClick={() => setForm({ mode: 'new', v: { kind: 'produtor', name: '', document: '', email: '', phone: '', withBank: false, bank: { ...emptyBank } } })}><Plus className="h-4 w-4" /> Novo parceiro</button>}
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={Users} title="Nenhum parceiro cadastrado" text="Cadastre produtores, assessorias, parceiros e filiais que recebem repasse." /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="name">Parceiro</SortTh><th>Contato</th><th>Favorecido</th>
              <th className="text-right">A pagar</th><th className="text-right">Em lote</th><th className="text-right">Pago</th><th className="text-right">Recuperável</th><th><span className="sr-only">Ações</span></th>
            </tr></thead>
            <tbody>
              {t.rows.map((p) => (
                <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                  <td><span className="font-medium">{p.name}</span><div className="text-xs text-ink-faint">{PARTNER_KIND[p.kind] || p.kind}{p.document ? ` · ${maskDoc(p.document)}` : ''}{!p.active ? ' · inativo' : ''}</div></td>
                  <td className="text-xs">{p.email || '—'}{p.phone && <div className="text-ink-faint">{maskPhone(p.phone)}</div>}</td>
                  <td><Payee b={p.bank_info} />{p.bank_info_changed_at && p.bank_info && <div className="text-[11px] text-ink-faint">alterado {fmt(p.bank_info_changed_at)}</div>}</td>
                  <td className="text-right font-medium"><Num v={p.payable_cents} /></td>
                  <td className="text-right"><Num v={p.in_batch_cents} /></td>
                  <td className="text-right"><Num v={p.paid_cents} /></td>
                  <td className="text-right">{Number(p.recoverable_cents) ? <Num v={-Number(p.recoverable_cents)} /> : <span className="text-ink-faint">—</span>}</td>
                  <td>
                    {can('splits_manage') && (
                      <div className="flex justify-end gap-1">
                        <button className={smallBtn} onClick={() => setForm({ mode: 'edit', id: p.id, v: { name: p.name, email: p.email || '', phone: p.phone || '', active: p.active } })}><Pencil className="h-3.5 w-3.5" /> Editar</button>
                        <button className={smallBtn} onClick={() => setBank(p)}><KeyRound className="h-3.5 w-3.5" /> Favorecido</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title={form?.mode === 'new' ? 'Novo parceiro' : 'Editar parceiro'}
        footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Voltar</button><button className="btn-primary" disabled={!okForm || busy} onClick={save}>Salvar</button></>}>
        {fv && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {form.mode === 'new' && (
                <Select label="Tipo" value={fv.kind} onChange={(e) => setForm({ ...form, v: { ...fv, kind: e.target.value } })}>
                  {Object.entries(PARTNER_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              )}
              <Input label="Nome" value={fv.name} onChange={(e) => setForm({ ...form, v: { ...fv, name: e.target.value } })} />
              {form.mode === 'new' && <Input label="CPF/CNPJ" value={fv.document} onChange={(e) => setForm({ ...form, v: { ...fv, document: maskDoc(e.target.value) } })} />}
              <Input label="E-mail" type="email" value={fv.email} onChange={(e) => setForm({ ...form, v: { ...fv, email: e.target.value } })} />
              <Input label="Telefone" value={fv.phone} onChange={(e) => setForm({ ...form, v: { ...fv, phone: maskPhone(e.target.value) } })} />
            </div>
            {form.mode === 'edit' && <Toggle checked={fv.active} onChange={(x) => setForm({ ...form, v: { ...fv, active: x } })} label="Ativo" hint="Parceiro inativo não entra em novos lotes." />}
            {form.mode === 'new' && (
              <>
                <Toggle checked={fv.withBank} onChange={(x) => setForm({ ...form, v: { ...fv, withBank: x } })} label="Cadastrar favorecido agora" hint="Sem favorecido o parceiro não entra em lote de pagamento. Alterações posteriores exigem reautenticação." />
                {fv.withBank && <BankFields v={fv.bank} onChange={(b) => setForm({ ...form, v: { ...fv, bank: b } })} />}
              </>
            )}
            {form.mode === 'edit' && <p className="text-xs text-ink-faint">O favorecido (dados bancários) é alterado pelo botão "Favorecido", com reautenticação e registro em auditoria.</p>}
          </div>
        )}
      </Modal>
      {bank && <BankChange partner={bank} mfa={!!user?.mfa_enabled} onClose={() => setBank(null)} onDone={() => { setBank(null); reload(); }} />}
    </div>
  );
}

function BankChange({ partner, mfa, onClose, onDone }) {
  const [b, setB] = useState({ ...emptyBank });
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState('');
  const [reauthMsg, setReauthMsg] = useState('');
  const [run, busy] = useAction();
  const submit = async () => {
    setReauthMsg('');
    const r = await run(() => api.put(`/v1/partners/${partner.id}/bank`, { bank_info: cleanBank(b), reason, ...(mfa ? { mfa_code: secret } : { password: secret }) }), 'Favorecido alterado.',
      (e) => { if (e.code === 'REAUTH_REQUIRED') { setReauthMsg(e.message); setSecret(''); return true; } return false; });
    if (r !== FAIL) onDone();
  };
  const ok = bankOk(b) && reason.trim().length >= 3 && (mfa ? /^\d{6}$/.test(secret) : secret.length > 0);
  return (
    <Modal open onClose={onClose} size="lg" title="Alterar favorecido" subtitle={partner.name}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={!ok || busy} onClick={submit}><ShieldCheck className="h-4 w-4" /> Confirmar alteração</button></>}>
      <div className="space-y-4">
        <Notice tone="warn">Troca de favorecido é operação sensível: exige reautenticação e fica na auditoria. Lotes já aprovados mantêm o favorecido congelado no momento da aprovação.</Notice>
        {partner.bank_info && <div className="rounded-app-sm bg-muted p-3"><div className="mb-1 text-xs text-ink-faint">Favorecido atual</div><Payee b={partner.bank_info} /></div>}
        <BankFields v={b} onChange={setB} />
        <Input label="Motivo da alteração" value={reason} onChange={(e) => setReason(e.target.value)} />
        {mfa
          ? <Input label="Código do autenticador (6 dígitos)" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={secret} onChange={(e) => setSecret(e.target.value.replace(/\D/g, ''))} />
          : <Input label="Confirme sua senha" type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} />}
        {reauthMsg && <Notice tone="danger">{reauthMsg}</Notice>}
      </div>
    </Modal>
  );
}

// =====================================================================================
// Regras
// =====================================================================================
function Rules() {
  const { can, meta } = useAuth();
  const branches = meta?.branches || BRANCHES;
  const { data, loading, reload } = useFetch(() => api.get('/v1/splits/rules'), []);
  const partners = usePartners();
  const { data: institutions } = useFetch(() => api.get('/v1/catalog/institutions'), []);
  const [form, setForm] = useState(null);
  const [deact, setDeact] = useState(null);
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const rate = form?.rate === '' || form?.rate == null ? null : Number(String(form.rate).replace(',', '.'));
  const ok = form && form.partner_id && String(form.name).trim().length >= 2 && (form.kind === 'percentual' ? rate != null && rate >= 0 && rate <= 100 : form.fixed_cents > 0);
  const save = async () => {
    const body = { partner_id: form.partner_id, name: form.name, institution_id: form.institution_id || null, branch: form.branch || null, kind: form.kind,
      rate: form.kind === 'percentual' ? rate : null, fixed_cents: form.kind === 'fixo' ? form.fixed_cents : null, base: form.base, stage: Number(form.stage) || 1,
      sequential: form.sequential, release: form.release, reversal: form.reversal, valid_from: form.valid_from || undefined };
    const r = await run(() => api.post('/v1/splits/rules', body), 'Regra de repasse registrada.');
    if (r !== FAIL) { setForm(null); reload(); }
  };
  const deactivate = async (r) => {
    if (!(await confirm({ title: 'Desativar regra', message: `A regra "${r.name}" v${r.version} deixa de ser aplicada a novos contratos. Apólices que já têm o snapshot dela não mudam.`, confirmText: 'Desativar' }))) return;
    const x = await run(() => api.post(`/v1/splits/rules/${r.id}/deactivate`), 'Regra desativada.');
    if (x !== FAIL) reload();
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <Notice>
          <p><b>Base explícita:</b> {Object.values(BASE).map((b) => `${b.label} — ${b.help}`).join(' ')}</p>
          <p className="mt-1"><b>Etapas:</b> regras da mesma etapa incidem sobre a base cheia; uma etapa <b>sequencial</b> aplica sobre o <b>restante</b> após as etapas anteriores da mesma base (ex.: assessoria 10% na etapa 1 e produtor 30% sequencial na etapa 2 → produtor recebe 30% de 90%). Percentuais da mesma base e etapa não passam de 100%.</p>
          <p className="mt-1">Cada apólice congela a regra vigente (snapshot): editar ou desativar não recalcula o passado.</p>
        </Notice>
        {can('splits_manage') && <div><button className="btn-primary" onClick={() => setForm({ partner_id: '', name: '', institution_id: '', branch: '', kind: 'percentual', rate: '', fixed_cents: null, base: 'comissao_bruta', stage: 1, sequential: false, release: 'no_recebimento', reversal: 'proporcional', valid_from: ymd() })}><Plus className="h-4 w-4" /> Nova regra</button></div>}
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty title="Nenhuma regra de repasse" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Parceiro</th><th>Regra</th><th>Escopo</th><th>Valor</th><th>Base</th><th>Etapa</th><th>Liberação</th><th>Estorno</th><th>Vigência</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={cx(!r.active && 'opacity-60')}>
                  <td className="font-medium">{r.partner_name}</td>
                  <td>{r.name} <span className="text-xs text-ink-faint">v{r.version}</span></td>
                  <td className="text-xs">{r.institution_name || 'Todas as seguradoras'}<div className="text-ink-faint">{r.branch ? branches[r.branch] || r.branch : 'Todos os ramos'}</div></td>
                  <td className="tabular-nums">{r.kind === 'fixo' ? `Fixo ${money(r.fixed_cents)}` : pct(r.rate)}</td>
                  <td>{BASE[r.base]?.label || r.base}</td>
                  <td>{r.stage}{r.sequential ? <span className="chip ml-1 bg-violet-500/10 text-violet-700 dark:text-violet-300">sequencial</span> : ''}</td>
                  <td className="text-xs">{RELEASE[r.release] || r.release}</td>
                  <td className="text-xs">{REVERSAL[r.reversal] || r.reversal}</td>
                  <td className="tabular-nums text-xs">{fmt(r.valid_from)}{r.valid_to ? ` → ${fmt(r.valid_to)}` : ''}</td>
                  <td>{r.active ? <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Ativa</span> : <span className="chip bg-muted text-ink-soft">Inativa</span>}</td>
                  <td className="text-right">{can('splits_manage') && r.active && <button className={smallBtn} disabled={busy} onClick={() => deactivate(r)}><Ban className="h-3.5 w-3.5" /> Desativar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title="Nova regra de repasse" subtitle="Uma nova versão é criada quando o nome da regra já existe para o parceiro."
        footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Voltar</button><button className="btn-primary" disabled={!ok || busy} onClick={save}>Registrar regra</button></>}>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Parceiro" value={form.partner_id} onChange={(e) => set('partner_id', e.target.value)}>
                <option value="">Selecione…</option>
                {(partners.data || []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} ({PARTNER_KIND[p.kind]})</option>)}
              </Select>
              <Input label="Nome da regra" placeholder="Ex.: Produção própria" value={form.name} onChange={(e) => set('name', e.target.value)} />
              <Select label="Seguradora" value={form.institution_id} onChange={(e) => set('institution_id', e.target.value)}>
                <option value="">Todas</option>
                {(institutions || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
              <Select label="Ramo" value={form.branch} onChange={(e) => set('branch', e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(branches).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <Select label="Tipo" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="percentual">Percentual</option>
                <option value="fixo">Valor fixo</option>
              </Select>
              {form.kind === 'percentual'
                ? <Input label="Percentual (%)" inputMode="decimal" value={form.rate} onChange={(e) => set('rate', e.target.value.replace(/[^\d.,]/g, ''))} />
                : <CentsInput label="Valor fixo (total por contrato)" value={form.fixed_cents} onChange={(c) => set('fixed_cents', c)} hint="Liberado proporcionalmente a cada recebimento, sem ultrapassar o total." />}
              <Select label="Base" value={form.base} onChange={(e) => set('base', e.target.value)} hint={BASE[form.base]?.help}>
                {Object.entries(BASE).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
              </Select>
              <Select label="Etapa" value={form.stage} onChange={(e) => set('stage', e.target.value)}>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
              <Select label="Liberação" value={form.release} onChange={(e) => set('release', e.target.value)}
                hint={form.release === 'antecipado' ? (can('splits_approve') ? 'Repasse antes do recebimento: você está aprovando esta exceção.' : 'Exige permissão de aprovação de repasses.') : undefined}>
                <option value="no_recebimento">{RELEASE.no_recebimento}</option>
                <option value="antecipado" disabled={!can('splits_approve')}>{RELEASE.antecipado}{!can('splits_approve') ? ' — exige aprovação' : ''}</option>
              </Select>
              <Select label="Em caso de estorno" value={form.reversal} onChange={(e) => set('reversal', e.target.value)}>
                {Object.entries(REVERSAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <Input label="Vigência a partir de" type="date" value={form.valid_from} onChange={(e) => set('valid_from', e.target.value)} />
            </div>
            <Toggle checked={form.sequential} onChange={(x) => set('sequential', x)} label="Sequencial (aplica sobre o restante)" hint="Calcula sobre o que sobrou da mesma base depois das etapas anteriores." />
            {form.kind === 'percentual' && rate != null && (
              <p className="rounded-app-sm bg-muted p-3 text-xs text-ink-soft">
                Exemplo: sobre um recebimento de {money(10000)} {form.sequential && Number(form.stage) > 1 ? '(restante antes desta etapa)' : ''} na base "{BASE[form.base].label}", o repasse seria {money(Math.round(10000 * rate / 100))}.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// =====================================================================================
// Liberações
// =====================================================================================
function Accruals() {
  const { can } = useAuth();
  const partners = usePartners();
  const [partner, setPartner] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, reload } = useFetch(() => api.get(`/v1/splits/accruals${qs({ partner_id: partner, status })}`), [partner, status]);
  const t = useTable(data || [], { sort: 'created_at', dir: 'desc' });
  const [resolve, setResolve] = useState(null); // { row, action }
  const [run] = useAction();
  const sums = useMemo(() => {
    const s = { released: 0, reduced: 0, recoverable: 0, in_batch: 0, paid: 0 };
    for (const a of data || []) {
      const v = Number(a.amount_cents);
      if (a.status === 'liberada' && (a.kind === 'liberacao' || a.kind === 'antecipacao')) s.released += v;
      if (a.status === 'liberada' && a.kind === 'reducao') s.reduced += v;
      if (a.status === 'liberada' && a.kind === 'recuperacao') s.recoverable += v;
      if (a.status === 'em_lote') s.in_batch += v;
      if (a.status === 'paga') s.paid += v;
    }
    return s;
  }, [data]);
  const submit = async ({ note }) => {
    const r = await run(() => api.post(`/v1/splits/accruals/${resolve.row.id}/resolve`, { action: resolve.action, note }), resolve.action === 'contestar' ? 'Recuperação contestada.' : 'Registrado como compensado fora do sistema.');
    if (r !== FAIL) { setResolve(null); reload(); }
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Liberado (não pago)" value={money(sums.released)} hint="Fora de lote." icon={Wallet} />
        <Stat label="Reduções (não pago)" value={<Num v={sums.reduced} />} hint="Estornos que reduzem o saldo ainda não pago." />
        <Stat label="Recuperável (já pago)" value={<Num v={sums.recoverable} />} hint="Não entra em lote sem compensação autorizada." tone="text-orange-600" icon={RotateCcw} />
        <Stat label="Em lote" value={money(sums.in_batch)} icon={Layers} />
        <Stat label="Pago (conciliado)" value={money(sums.paid)} icon={CheckCircle2} tone="text-emerald-600" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Parceiro" value={partner} onChange={(e) => setPartner(e.target.value)} className="w-64">
          <option value="">Todos</option>
          {(partners.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">Todas</option>
          {Object.entries(ACCRUAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty title="Nenhuma liberação" text="Repasses são liberados quando a seguradora liquida a comissão da apólice com rateio." /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="created_at">Data</SortTh><SortTh t={t} k="partner_name">Parceiro</SortTh><th>Apólice / cliente</th><SortTh t={t} k="kind">Tipo</SortTh>
              <th className="text-right">Base</th><SortTh t={t} k="amount_cents" className="text-right">Valor</SortTh><SortTh t={t} k="status">Situação</SortTh><th>Cálculo / observação</th><th><span className="sr-only">Ações</span></th>
            </tr></thead>
            <tbody>
              {t.rows.map((a) => (
                <tr key={a.id}>
                  <td className="tabular-nums">{fmt(a.created_at)}</td>
                  <td>{a.partner_name}</td>
                  <td><Link to={`/apolices/${a.policy_id}`} className="text-primary hover:underline">{a.policy_number}</Link><div className="text-xs text-ink-faint">{a.client_name}</div></td>
                  <td className={cx(a.kind === 'recuperacao' && 'text-orange-700 dark:text-orange-300', a.kind === 'reducao' && 'text-ink-soft')}>{ACCRUAL_KIND[a.kind] || a.kind}</td>
                  <td className="text-right"><Num v={a.base_cents} /></td>
                  <td className="text-right font-medium"><Num v={a.amount_cents} /></td>
                  <td><StatusChip map={ACCRUAL_STATUS} value={a.status} /></td>
                  <td className="max-w-xs text-xs text-ink-soft">{a.note}</td>
                  <td>
                    {a.kind === 'recuperacao' && a.status === 'liberada' && can('splits_approve') && (
                      <div className="flex justify-end gap-1">
                        <button className={smallBtn} onClick={() => setResolve({ row: a, action: 'compensado_fora' })}>Compensado fora</button>
                        <button className={smallBtn} onClick={() => setResolve({ row: a, action: 'contestar' })}>Contestar</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      <PromptModal open={!!resolve} onClose={() => setResolve(null)} onSubmit={submit}
        title={resolve?.action === 'contestar' ? 'Contestar valor recuperável' : 'Registrar compensação fora do sistema'}
        subtitle={resolve && `${resolve.row.partner_name} · ${money(-Number(resolve.row.amount_cents))}. ${resolve.action === 'contestar' ? 'A divergência fica aberta para revisão.' : 'Use quando o parceiro devolveu ou foi compensado por acordo documentado. Nada é debitado automaticamente.'}`}
        fields={[{ key: 'note', label: 'Fundamento / evidência', required: true, textarea: true }]} confirmText="Registrar" />
      <p className="text-xs text-ink-faint"><Info className="mr-1 inline h-3.5 w-3.5" />Valores negativos: redução (estorno sobre repasse ainda não pago) e recuperável (estorno sobre repasse já pago). O pagamento original nunca é alterado.</p>
    </div>
  );
}

// =====================================================================================
// Lotes
// =====================================================================================
function Batches() {
  const { can, company } = useAuth();
  const { data, loading, reload } = useFetch(() => api.get('/v1/splits/batches'), []);
  const [detail, setDetail] = useState(null);
  const [create, setCreate] = useState(false);
  const t = useTable(data || [], { sort: 'created_at', dir: 'desc' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Notice className="max-w-3xl">Fluxo: <b>preparar</b> (congela os valores liberados) → <b>aprovar</b> por outra pessoa (congela favorecidos) → <b>pagar</b> vinculando o débito do extrato bancário. Um lote só é "pago" com evidência bancária conciliada; agendamento não é pagamento.</Notice>
        {can('splits_manage') && <button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" /> Preparar lote</button>}
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={Layers} title="Nenhum lote de repasse" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><SortTh t={t} k="number">Lote</SortTh><SortTh t={t} k="created_at">Preparado em</SortTh><th className="text-right">Parceiros</th><SortTh t={t} k="total_cents" className="text-right">Total</SortTh><th>Aprovação</th><th>Pagamento</th><SortTh t={t} k="status">Situação</SortTh></tr></thead>
            <tbody>
              {t.rows.map((b) => (
                <tr key={b.id} className="cursor-pointer" onClick={() => setDetail(b.id)}>
                  <td><button className="font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDetail(b.id); }}>{docNumber(company?.settings, 'batch', b.number)}</button></td>
                  <td className="tabular-nums">{fmtDateTime(b.created_at)}</td>
                  <td className="text-right tabular-nums">{b.items}</td>
                  <td className="text-right font-medium"><Num v={b.total_cents} /></td>
                  <td className="text-xs">{b.approved_at ? <>{b.approved_by_name}<div className="text-ink-faint">{fmtDateTime(b.approved_at)}</div></> : '—'}</td>
                  <td className="text-xs">{b.paid_at ? <>{fmtDateTime(b.paid_at)}<div className="text-ink-faint">{b.payment_evidence}</div></> : '—'}</td>
                  <td><StatusChip map={BATCH_STATUS} value={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      {create && <CreateBatch onClose={() => setCreate(false)} onCreated={(id) => { setCreate(false); reload(); setDetail(id); }} />}
      <BatchDetail id={detail} onClose={() => setDetail(null)} onChanged={reload} />
    </div>
  );
}

function CreateBatch({ onClose, onCreated }) {
  const { can } = useAuth();
  const { data: partners, loading } = usePartners();
  const [sel, setSel] = useState([]);
  const [comp, setComp] = useState(false);
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const eligible = (partners || []).filter((p) => p.active);
  useEffect(() => { if (partners && !sel.length) setSel(eligible.filter((p) => Number(p.payable_cents) > 0 && p.bank_info).map((p) => p.id)); }, [partners]); // eslint-disable-line
  const est = eligible.filter((p) => sel.includes(p.id)).reduce((a, p) => a + Number(p.payable_cents) - (comp ? Number(p.recoverable_cents) : 0), 0);
  const name = (id) => eligible.find((p) => p.id === id)?.name || id;
  const submit = async () => {
    const r = await run(() => api.post('/v1/splits/batches', { partner_ids: sel, compensate_recoverable: comp }), 'Lote preparado.',
      (e) => { if (e.data?.skipped) { setResult({ error: e.message, skipped: e.data.skipped }); return false; } return false; });
    if (r !== FAIL) setResult(r);
  };
  if (result?.batch) {
    return (
      <Modal open onClose={() => onCreated(result.batch.id)} title="Lote preparado" footer={<button className="btn-primary" onClick={() => onCreated(result.batch.id)}>Abrir lote</button>}>
        <div className="space-y-3">
          <KV items={[['Total do lote', money(result.batch.total_cents)], ['Situação', 'Rascunho — aguardando aprovação de outra pessoa']]} />
          {result.skipped?.length > 0 && <Notice tone="warn"><b>Parceiros não incluídos:</b><ul className="mt-1 list-disc pl-5">{result.skipped.map((s) => <li key={s.partner_id}>{name(s.partner_id)}: {s.reason}</li>)}</ul></Notice>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Preparar lote de repasse" subtitle="Inclui os valores liberados (já descontadas as reduções) de cada parceiro selecionado."
      footer={<><span className="mr-auto text-sm tabular-nums text-ink-soft">Estimativa: {money(est)}</span><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={!sel.length || busy} onClick={submit}>Preparar lote</button></>}>
      {loading ? <Loading /> : (
        <div className="space-y-4">
          {result?.skipped && <Notice tone="danger">{result.error}<ul className="mt-1 list-disc pl-5">{result.skipped.map((s) => <li key={s.partner_id}>{name(s.partner_id)}: {s.reason}</li>)}</ul></Notice>}
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th><span className="sr-only">Selecionar</span></th><th>Parceiro</th><th>Favorecido</th><th className="text-right">A pagar</th><th className="text-right">Recuperável</th></tr></thead>
              <tbody>
                {eligible.map((p) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" className="h-4 w-4" checked={sel.includes(p.id)} aria-label={`Incluir ${p.name}`} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /></td>
                    <td className="font-medium">{p.name}</td>
                    <td>{p.bank_info ? <Payee b={p.bank_info} /> : <span className="text-xs text-orange-600">sem favorecido — será ignorado</span>}</td>
                    <td className="text-right"><Num v={p.payable_cents} /></td>
                    <td className="text-right">{Number(p.recoverable_cents) ? <Num v={-Number(p.recoverable_cents)} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('splits_approve')
            ? <Toggle checked={comp} onChange={setComp} label="Compensar valores recuperáveis neste lote" hint="Desconta do pagamento os valores já pagos de comissões estornadas. Exige autorização (registrada em auditoria)." />
            : <p className="text-xs text-ink-faint">Valores recuperáveis só são compensados em lote por quem aprova repasses.</p>}
        </div>
      )}
    </Modal>
  );
}

function BatchDetail({ id, onClose, onChanged }) {
  const { can, company, user } = useAuth();
  const { data: b, loading, reload } = useFetch(() => (id ? api.get(`/v1/splits/batches/${id}`) : Promise.resolve(null)), [id]);
  const [run, busy] = useAction();
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const { confirm } = useUI();
  const after = () => { reload(); onChanged(); };
  const approve = async () => {
    if (!(await confirm({ title: 'Aprovar lote', message: `Confira os favorecidos e valores. Após a aprovação, itens e favorecidos ficam congelados (total ${money(b.total_cents)}).`, confirmText: 'Aprovar', danger: false }))) return;
    const r = await run(() => api.post(`/v1/splits/batches/${b.id}/approve`), 'Lote aprovado.');
    if (r !== FAIL) after();
  };
  const doCancel = async ({ reason }) => {
    const r = await run(() => api.post(`/v1/splits/batches/${b.id}/cancel`, { reason }), 'Lote cancelado. Os valores voltaram a "liberada".');
    if (r !== FAIL) { setCancel(false); after(); }
  };
  const ownBatch = b && b.created_by === user?.id && user?.role !== 'owner';
  return (
    <Modal open={!!id} onClose={onClose} size="xl" title={b ? `Lote ${docNumber(company?.settings, 'batch', b.number)}` : 'Lote'}
      subtitle={b && <span className="inline-flex items-center gap-2"><StatusChip map={BATCH_STATUS} value={b.status} /> preparado em {fmtDateTime(b.created_at)}</span>}
      footer={b && <>
        {['rascunho', 'aprovado'].includes(b.status) && can('splits_manage') && <button className="btn-ghost mr-auto text-red-600" onClick={() => setCancel(true)}><XCircle className="h-4 w-4" /> Cancelar lote</button>}
        {b.status === 'rascunho' && can('splits_approve') && <button className="btn-primary" disabled={busy || ownBatch} title={ownBatch ? 'Quem preparou não aprova o próprio lote' : undefined} onClick={approve}><ShieldCheck className="h-4 w-4" /> Aprovar</button>}
        {b.status === 'aprovado' && can('splits_pay') && <button className="btn-primary" onClick={() => setPay(true)}><Banknote className="h-4 w-4" /> Registrar pagamento</button>}
      </>}>
      {loading || !b ? <Loading /> : (
        <div className="space-y-4">
          {b.status === 'rascunho' && ownBatch && <Notice tone="warn">Você preparou este lote: a aprovação deve ser feita por outra pessoa com alçada.</Notice>}
          {b.status === 'aprovado' && <Notice>Aprovado: itens e favorecidos congelados. Para marcar como pago, vincule o débito correspondente do extrato bancário.</Notice>}
          {b.status === 'cancelado' && b.cancelled_reason && <Notice tone="danger">Cancelado: {b.cancelled_reason}</Notice>}
          <KV cols={4} items={[
            ['Total', <b key="t">{money(b.total_cents)}</b>], ['Aprovado em', b.approved_at ? fmtDateTime(b.approved_at) : '—'],
            ['Pago em', b.paid_at ? fmtDateTime(b.paid_at) : '—'], ['Evidência bancária', b.payment_evidence],
          ]} />
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Parceiro</th><th>Favorecido (congelado)</th><th className="text-right">Lançamentos</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {b.items.map((i) => (
                  <tr key={i.id}><td className="font-medium">{i.partner_name}</td><td><Payee b={i.payee} /></td><td className="text-right tabular-nums">{i.accrual_ids?.length || '—'}</td><td className="text-right font-medium"><Num v={i.amount_cents} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {pay && b && <PayBatch batch={b} onClose={() => setPay(false)} onDone={() => { setPay(false); after(); }} />}
      <PromptModal open={cancel} onClose={() => setCancel(false)} onSubmit={doCancel} danger confirmText="Cancelar lote" title="Cancelar lote"
        subtitle="Os valores voltam para 'liberada' e podem entrar em outro lote. Lote pago não pode ser cancelado." />
    </Modal>
  );
}

function PayBatch({ batch, onClose, onDone }) {
  const { can } = useAuth();
  const [txs, setTxs] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState('');
  const [run, busy] = useAction();
  useEffect(() => {
    api.get('/v1/finance/bank/transactions?status=pendente').then((r) => setTxs(r.filter((t) => Number(t.amount_cents) < 0))).catch((e) => { setErr(e.message); setTxs([]); });
  }, []);
  const submit = async () => {
    const r = await run(() => api.post(`/v1/splits/batches/${batch.id}/pay`, { bank_transaction_id: sel }), 'Pagamento conciliado. Lote marcado como pago.');
    if (r !== FAIL) onDone();
  };
  const avail = (t) => -Number(t.amount_cents) - Number(t.matched_cents || 0);
  return (
    <Modal open onClose={onClose} size="lg" title="Registrar pagamento do lote" subtitle={`Total do lote: ${money(batch.total_cents)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={!sel || busy} onClick={submit}><CheckCircle2 className="h-4 w-4" /> Vincular e marcar como pago</button></>}>
      <div className="space-y-3">
        <Notice>O lote só é pago com <b>evidência bancária conciliada</b>: escolha a saída (débito) do extrato que corresponde à transferência. O débito precisa cobrir o total do lote.</Notice>
        {txs === null ? <Loading /> : err ? <Notice tone="danger">{err}{!can('finance') && ' — é preciso acesso ao Financeiro para ver o extrato bancário.'}</Notice> : !txs.length ? (
          <Empty icon={Clock} title="Nenhum débito pendente no extrato" text="Importe o extrato bancário em Financeiro › Contas e extratos depois de efetuar a transferência." action={<Link className="btn-outline" to="/financeiro?tab=contas">Ir ao Financeiro</Link>} />
        ) : (
          <div className="card max-h-[50vh] overflow-auto">
            <table className="table-clean">
              <thead><tr><th><span className="sr-only">Escolher</span></th><th>Data</th><th>Conta</th><th>Descrição</th><th className="text-right">Valor</th><th className="text-right">Disponível</th></tr></thead>
              <tbody>
                {txs.map((t) => {
                  const enough = avail(t) >= Number(batch.total_cents);
                  return (
                    <tr key={t.id} className={cx(!enough && 'opacity-50', sel === t.id && 'bg-primary/5')}>
                      <td><input type="radio" name="tx" className="h-4 w-4" disabled={!enough} checked={sel === t.id} onChange={() => setSel(t.id)} aria-label={`Escolher débito de ${fmt(t.tx_date)}`} /></td>
                      <td className="tabular-nums">{fmt(t.tx_date)}</td><td>{t.account_name}</td><td className="text-xs">{t.description}</td>
                      <td className="text-right"><Num v={t.amount_cents} /></td>
                      <td className={cx('text-right tabular-nums', !enough && 'text-red-600')}>{money(avail(t))}{!enough && <div className="text-[11px]">não cobre o lote</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
