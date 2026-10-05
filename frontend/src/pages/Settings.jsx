// Configurações da corretora: dados reutilizados no credenciamento (Anexo C), unidades, usuários,
// perfis de acesso, regras operacionais e aparência.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Copy, ShieldCheck, ShieldOff, Upload, Trash2, Save, KeyRound, Building } from 'lucide-react';
import { api, fileToPayload } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import {
  PageHeader, Section, Tabs, Modal, Input, Textarea, Select, Toggle, Notice, Empty, Loading, FileButton, useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { ROLES, maskDoc, maskPhone, maskCep, lookupCep, fmtDateTime, onlyDigits } from '../lib/format';
import { COLOR_THEMES, PRESET_COLORS, RADIUS, FONTS, applyTheme } from '../lib/theme';

const MFA_ROLES = ['owner', 'admin', 'finance'];
const SEGMENTS = { danos: 'Danos / patrimonial', pessoas: 'Pessoas (vida/AP)', auto: 'Automóvel', saude: 'Saúde', odonto: 'Odontológico', previdencia: 'Previdência', capitalizacao: 'Capitalização', beneficios: 'Benefícios' };
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export default function Settings() {
  const { can, user } = useAuth();
  const admin = ['owner', 'admin'].includes(user?.role);
  const tabs = [
    { value: 'corretora', label: 'Corretora', show: true },
    { value: 'unidades', label: 'Unidades', show: can('units_manage', 'settings') },
    { value: 'usuarios', label: 'Usuários', show: can('users') },
    { value: 'perfis', label: 'Perfis de acesso', show: admin || can('users') },
    { value: 'regras', label: 'Regras', show: can('settings') },
    { value: 'aparencia', label: 'Aparência', show: can('settings') },
  ].filter((t) => t.show);
  const [sp, setSp] = useSearchParams();
  const tab = tabs.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'corretora';
  return (
    <>
      <PageHeader title="Configurações da corretora" subtitle="Dados cadastrais, equipe, perfis de acesso, regras e aparência" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp(t === 'corretora' ? {} : { tab: t })} />
      {tab === 'corretora' && <CompanyTab />}
      {tab === 'unidades' && <UnitsTab />}
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'perfis' && <PermissionsTab />}
      {tab === 'regras' && <RulesTab />}
      {tab === 'aparencia' && <AppearanceTab />}
    </>
  );
}

// ---------------- Corretora ----------------
const COMPANY_FIELDS = ['name', 'trade_name', 'document', 'susep_code', 'tech_responsible_name', 'tech_responsible_document', 'segments', 'phone', 'email', 'cep', 'street', 'number', 'complement', 'district', 'city', 'uf', 'logo_url'];

function CompanyTab() {
  const { can, setCompany } = useAuth();
  const { toast } = useUI();
  const edit = can('settings');
  const { data, loading } = useFetch(() => api.get('/v1/company'), []);
  const [v, setV] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (data) setV(Object.fromEntries(COMPANY_FIELDS.map((k) => [k, k === 'segments' ? data[k] || [] : k === 'document' ? maskDoc(data[k] || '') : data[k] ?? ''])));
  }, [data]);
  if (loading || !v) return <Loading />;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const cep = async () => {
    const r = await lookupCep(v.cep);
    if (r) setV((x) => ({ ...x, street: r.street || x.street, district: r.district || x.district, city: r.city || x.city, uf: r.uf || x.uf }));
  };
  const logo = async (file) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Use PNG, JPG ou WEBP.', 'error'); return; }
    if (file.size > 200 * 1024) { toast('Logotipo acima de 200 KB. Reduza a imagem.', 'error'); return; }
    const p = await fileToPayload(file);
    setV((x) => ({ ...x, logo_url: `data:${p.mime};base64,${p.data}` }));
  };
  const save = async () => {
    const body = {};
    for (const k of COMPANY_FIELDS) {
      if (k === 'segments') body.segments = v.segments;
      else if (k === 'name') body.name = v.name.trim();
      else if (k === 'document') body.document = onlyDigits(v.document) || null;
      else if (k === 'email') body.email = v.email.trim() || null;
      else body[k] = String(v[k] ?? '').trim() || null;
    }
    if (body.uf) body.uf = body.uf.toUpperCase();
    const r = await run(() => api.put('/v1/company', body), 'Dados da corretora salvos.');
    if (r !== FAIL) setCompany(r);
  };
  const extraSegs = (v.segments || []).filter((s) => !SEGMENTS[s]);

  return (
    <div className="space-y-4">
      <Notice tone="info">Estes dados são <b>reaproveitados no credenciamento</b> com seguradoras e parceiros (Seguradoras e Integrações → etapa 2), nos documentos ao cliente e nos comparativos. Mantenha-os atualizados para não precisar digitar de novo.</Notice>
      <fieldset disabled={!edit} className="space-y-4">
        <Section title="Identificação e registro">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Razão social *" value={v.name} maxLength={160} onChange={set('name')} />
            <Input label="Nome fantasia" value={v.trade_name} maxLength={160} onChange={set('trade_name')} />
            <Input label="CNPJ" value={v.document} inputMode="numeric" onChange={(e) => setV({ ...v, document: maskDoc(e.target.value) })} />
            <Input label="Código SUSEP da corretora" value={v.susep_code} maxLength={40} onChange={set('susep_code')} hint="Registro no órgão regulador — diferente do código comercial em cada seguradora." />
            <Input label="Responsável técnico" value={v.tech_responsible_name} maxLength={160} onChange={set('tech_responsible_name')} />
            <Input label="CPF do responsável técnico" value={v.tech_responsible_document} inputMode="numeric" onChange={(e) => setV({ ...v, tech_responsible_document: maskDoc(e.target.value).slice(0, 14) })} />
          </div>
          <fieldset className="mt-4">
            <legend className="label">Segmentos de atuação</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {Object.entries(SEGMENTS).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.segments.includes(k)}
                  onChange={() => setV({ ...v, segments: v.segments.includes(k) ? v.segments.filter((x) => x !== k) : [...v.segments, k] })} /> {l}</label>
              ))}
              {extraSegs.map((s) => <span key={s} className="chip bg-muted text-ink-soft">{s}</span>)}
            </div>
          </fieldset>
        </Section>
        <Section title="Contato e endereço">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Telefone" value={v.phone} onChange={(e) => setV({ ...v, phone: maskPhone(e.target.value) })} />
            <Input label="E-mail" type="email" value={v.email} maxLength={160} onChange={set('email')} className="lg:col-span-3" />
            <Input label="CEP" value={v.cep} inputMode="numeric" onChange={(e) => setV({ ...v, cep: maskCep(e.target.value) })} onBlur={cep} hint="Preenche o endereço automaticamente." />
            <Input label="Logradouro" value={v.street} maxLength={200} onChange={set('street')} className="lg:col-span-2" />
            <Input label="Número" value={v.number} maxLength={20} onChange={set('number')} />
            <Input label="Complemento" value={v.complement} maxLength={100} onChange={set('complement')} />
            <Input label="Bairro" value={v.district} maxLength={100} onChange={set('district')} />
            <Input label="Cidade" value={v.city} maxLength={100} onChange={set('city')} />
            <Select label="UF" value={v.uf || ''} onChange={set('uf')}>
              <option value="">—</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </Section>
        <Section title="Logotipo" subtitle="PNG, JPG ou WEBP até 200 KB — usado no menu e nos documentos ao cliente">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-16 w-40 place-items-center rounded-app-sm border border-dashed border-line bg-muted/50">
              {v.logo_url ? <img src={v.logo_url} alt="Logotipo da corretora" className="max-h-14 max-w-[150px] object-contain" /> : <Building className="h-6 w-6 text-ink-faint" />}
            </div>
            {edit && <FileButton accept="image/png,image/jpeg,image/webp" onFile={logo}><Upload className="h-4 w-4" /> Enviar logotipo</FileButton>}
            {edit && v.logo_url && <button type="button" className="btn-ghost" onClick={() => setV({ ...v, logo_url: '' })}><Trash2 className="h-4 w-4" /> Remover</button>}
          </div>
        </Section>
      </fieldset>
      {edit && <div className="flex justify-end"><button className="btn-primary" disabled={busy || v.name.trim().length < 2} onClick={save}><Save className="h-4 w-4" /> Salvar dados da corretora</button></div>}
    </div>
  );
}

// ---------------- Unidades ----------------
function UnitsTab() {
  const { can } = useAuth();
  const edit = can('units_manage');
  const { data, loading, reload } = useFetch(() => api.get('/v1/company/units'), []);
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Filiais e escritórios. Vínculos com seguradoras podem ser configurados por unidade.</p>
        {edit && <button className="btn-primary" onClick={() => setOpen({})}><Plus className="h-4 w-4" /> Nova unidade</button>}
      </div>
      {!data?.length ? <div className="card"><Empty title="Nenhuma unidade" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Unidade</th><th>CNPJ</th><th>SUSEP</th><th>Cidade/UF</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td data-label="Unidade" className="font-medium">{u.name}{u.is_main && <span className="ml-2 chip bg-primary/10 text-primary">Principal</span>}</td>
                  <td data-label="CNPJ">{u.document ? maskDoc(u.document) : '—'}</td>
                  <td data-label="SUSEP">{u.susep_code || '—'}</td>
                  <td data-label="Cidade/UF">{u.city ? `${u.city}/${u.uf || ''}` : '—'}</td>
                  <td data-label="Situação">{u.active === false ? <span className="chip bg-muted text-ink-soft">Inativa</span> : <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Ativa</span>}</td>
                  <td data-label="">{edit && <button className="btn-ghost btn-icon" aria-label={`Editar ${u.name}`} onClick={() => setOpen(u)}><Pencil className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <UnitModal unit={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function UnitModal({ unit, onClose, onDone }) {
  const [run, busy] = useAction();
  const [v, setV] = useState({ name: unit.name || '', document: unit.document ? maskDoc(unit.document) : '', susep_code: unit.susep_code || '', city: unit.city || '', uf: unit.uf || '', active: unit.active !== false });
  const save = async () => {
    const body = { name: v.name.trim(), document: onlyDigits(v.document) || null, susep_code: v.susep_code.trim() || null, city: v.city.trim() || null, uf: v.uf || null };
    const r = await run(() => (unit.id ? api.put(`/v1/company/units/${unit.id}`, { ...body, active: v.active }) : api.post('/v1/company/units', body)), 'Unidade salva.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title={unit.id ? `Editar ${unit.name}` : 'Nova unidade'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || v.name.trim().length < 2} onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Nome *" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} className="sm:col-span-2" />
        <Input label="CNPJ" value={v.document} inputMode="numeric" onChange={(e) => setV({ ...v, document: maskDoc(e.target.value) })} />
        <Input label="Código SUSEP" value={v.susep_code} maxLength={40} onChange={(e) => setV({ ...v, susep_code: e.target.value })} />
        <Input label="Cidade" value={v.city} maxLength={100} onChange={(e) => setV({ ...v, city: e.target.value })} />
        <Select label="UF" value={v.uf} onChange={(e) => setV({ ...v, uf: e.target.value })}>
          <option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        {unit.id && <div className="sm:col-span-2"><Toggle checked={v.active} onChange={(a) => setV({ ...v, active: a })} label="Unidade ativa" hint="Unidades inativas deixam de aparecer para novos vínculos; o histórico é preservado." /></div>}
      </div>
    </Modal>
  );
}

// ---------------- Usuários ----------------
function UsersTab() {
  const { user } = useAuth();
  const { confirm } = useUI();
  const [run] = useAction();
  const admin = ['owner', 'admin'].includes(user?.role);
  const { data, loading, reload } = useFetch(() => api.get('/v1/company/users'), []);
  const { data: units } = useFetch(() => api.get('/v1/company/units'), []);
  const [open, setOpen] = useState(null);
  const [temp, setTemp] = useState(null);
  const unitName = (id) => (units || []).find((u) => u.id === id)?.name || '—';
  const resetMfa = async (u) => {
    if (!(await confirm({ title: `Redefinir verificação em duas etapas de ${u.name}?`, message: 'Use quando a pessoa perdeu o aplicativo autenticador. Ela precisará configurar o segundo fator de novo no próximo acesso e as sessões atuais serão encerradas.', confirmText: 'Redefinir' }))) return;
    if (await run(() => api.post(`/v1/company/users/${u.id}/reset-mfa`, {}), 'Verificação em duas etapas redefinida.') !== FAIL) reload();
  };
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Perfis com <b>verificação em duas etapas obrigatória</b>: {MFA_ROLES.map((r) => ROLES[r]).join(', ')}.</p>
        <button className="btn-primary" onClick={() => setOpen({})}><Plus className="h-4 w-4" /> Convidar usuário</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table-clean">
          <thead><tr><th>Usuário</th><th>Perfil</th><th>Unidade / equipe</th><th>Duas etapas</th><th>Último acesso</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
          <tbody>
            {(data || []).map((u) => (
              <tr key={u.id}>
                <td data-label="Usuário"><div className="font-medium">{u.name}{u.id === user?.id && <span className="ml-1 text-xs text-ink-faint">(você)</span>}</div><div className="text-xs text-ink-faint">{u.email}</div></td>
                <td data-label="Perfil">{ROLES[u.role] || u.role}{MFA_ROLES.includes(u.role) && <div className="text-[11px] text-amber-700 dark:text-amber-300">exige duas etapas</div>}</td>
                <td data-label="Unidade / equipe">{unitName(u.unit_id)}{u.team && <div className="text-xs text-ink-faint">{u.team}</div>}</td>
                <td data-label="Duas etapas">{u.mfa_enabled
                  ? <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-3 w-3" /> Ativa</span>
                  : <span className={cx('chip', MFA_ROLES.includes(u.role) ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-ink-soft')}><ShieldOff className="h-3 w-3" /> Não ativada</span>}</td>
                <td data-label="Último acesso" className="whitespace-nowrap">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Nunca'}</td>
                <td data-label="Situação">{u.active ? <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Ativo</span> : <span className="chip bg-muted text-ink-soft">Inativo</span>}</td>
                <td data-label="">
                  <div className="flex justify-end gap-1">
                    {(u.role !== 'owner' || user?.role === 'owner') && <button className="btn-ghost btn-icon" aria-label={`Editar ${u.name}`} onClick={() => setOpen(u)}><Pencil className="h-4 w-4" /></button>}
                    {admin && u.role !== 'owner' && u.mfa_enabled && <button className="btn-ghost btn-icon" title="Redefinir duas etapas" aria-label={`Redefinir duas etapas de ${u.name}`} onClick={() => resetMfa(u)}><KeyRound className="h-4 w-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <UserModal u={open} units={units || []} onClose={() => setOpen(null)} onDone={(r) => { setOpen(null); if (r?.temporary_password) setTemp(r); reload(); }} />}
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Senha provisória" subtitle={temp ? `${temp.name} · ${temp.email}` : ''}
        footer={<button className="btn-primary" onClick={() => setTemp(null)}>Concluir</button>}>
        {temp && <TempPassword value={temp.temporary_password} />}
      </Modal>
    </div>
  );
}

function TempPassword({ value }) {
  const { toast } = useUI();
  return (
    <div className="space-y-3">
      <Notice tone="warn">Esta senha é exibida <b>uma única vez</b>. Entregue-a por um canal seguro; a pessoa troca no primeiro acesso.</Notice>
      <div className="flex gap-2">
        <input className="input font-mono" readOnly value={value} aria-label="Senha provisória" onFocus={(e) => e.target.select()} />
        <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(value); toast('Senha copiada.'); }}><Copy className="h-4 w-4" /> Copiar</button>
      </div>
    </div>
  );
}

function UserModal({ u, units, onClose, onDone }) {
  const { user } = useAuth();
  const [run, busy] = useAction();
  const isNew = !u.id;
  const [v, setV] = useState({ name: u.name || '', email: u.email || '', role: u.role || 'broker', unit_id: u.unit_id || '', team: u.team || '', active: u.active !== false, new_password: '' });
  const owner = u.role === 'owner';
  const save = async () => {
    const base = { name: v.name.trim(), email: v.email.trim(), unit_id: v.unit_id || null, team: v.team.trim() || null, ...(owner ? {} : { role: v.role }) };
    const r = await run(() => (isNew ? api.post('/v1/company/users', base)
      : api.put(`/v1/company/users/${u.id}`, { ...base, active: v.active, ...(v.new_password ? { new_password: v.new_password } : {}) })),
    isNew ? 'Usuário criado.' : 'Usuário atualizado.');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} title={isNew ? 'Convidar usuário' : `Editar ${u.name}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || v.name.trim().length < 2 || !/\S+@\S+\.\S+/.test(v.email)} onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Nome *" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <Input label="E-mail *" type="email" value={v.email} maxLength={160} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <Select label="Perfil" value={owner ? 'owner' : v.role} disabled={owner} onChange={(e) => setV({ ...v, role: e.target.value })}
          hint={MFA_ROLES.includes(owner ? 'owner' : v.role) ? 'Este perfil exige verificação em duas etapas.' : undefined}>
          {owner && <option value="owner">{ROLES.owner}</option>}
          {Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, l]) => <option key={k} value={k}>{l}{MFA_ROLES.includes(k) ? ' (duas etapas obrigatória)' : ''}</option>)}
        </Select>
        <Select label="Unidade" value={v.unit_id} onChange={(e) => setV({ ...v, unit_id: e.target.value })}>
          <option value="">Sem unidade específica</option>
          {units.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Input label="Equipe" value={v.team} maxLength={60} onChange={(e) => setV({ ...v, team: e.target.value })} />
        {!isNew && (
          <>
            <Input label="Nova senha (opcional)" type="password" autoComplete="new-password" value={v.new_password} onChange={(e) => setV({ ...v, new_password: e.target.value })}
              hint="Mínimo de 10 caracteres, com letras e números." />
            {u.id !== user?.id && <div className="sm:col-span-2"><Toggle checked={v.active} onChange={(a) => setV({ ...v, active: a })} label="Acesso ativo" hint="Desativar encerra as sessões e preserva o histórico do usuário." /></div>}
          </>
        )}
        {isNew && <Notice tone="info" className="sm:col-span-2">Uma senha provisória será gerada e exibida uma única vez após salvar.</Notice>}
      </div>
    </Modal>
  );
}

// ---------------- Perfis de acesso ----------------
function PermissionsTab() {
  const { user, refresh } = useAuth();
  const edit = ['owner', 'admin'].includes(user?.role);
  const { data, loading } = useFetch(() => api.get('/v1/company/permissions'), []);
  const [values, setValues] = useState(null);
  const [role, setRole] = useState('admin');
  const [run, busy] = useAction();
  useEffect(() => { if (data) setValues(JSON.parse(JSON.stringify(data.values || {}))); }, [data]);
  const groups = useMemo(() => {
    const g = {};
    (data?.catalog || []).forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return Object.entries(g);
  }, [data]);
  if (loading || !values) return <Loading />;
  const roles = Object.keys(values).filter((r) => r !== 'owner');
  const cur = values[role] || {};
  const set = (key, val) => setValues({ ...values, [role]: { ...cur, [key]: val } });
  const save = async () => {
    const r = await run(() => api.put('/v1/company', { settings: { permissions: values } }), 'Perfis de acesso salvos.');
    if (r !== FAIL) refresh();
  };
  return (
    <div className="space-y-4">
      <Notice tone="info">O <b>Proprietário</b> sempre tem todas as permissões. Permissões de escopo definem se o perfil vê todas as carteiras, somente a própria ou nenhuma. {!edit && 'Somente proprietário ou administrador altera os perfis.'}</Notice>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Perfil">
        {roles.map((r) => (
          <button key={r} role="tab" aria-selected={role === r} onClick={() => setRole(r)}
            className={cx('rounded-full border px-3 py-1 text-sm', role === r ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-soft hover:bg-muted')}>
            {data.roles?.[r] || ROLES[r] || r}
          </button>
        ))}
      </div>
      <fieldset disabled={!edit} className="grid gap-4 lg:grid-cols-2">
        {groups.map(([g, perms]) => (
          <Section key={g} title={g}>
            <ul className="space-y-2">
              {perms.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{p.label}</span>
                  {p.type === 'scope' ? (
                    <select className="input w-auto py-1 text-sm" aria-label={p.label} value={cur[p.key] === true ? 'all' : cur[p.key] || 'none'} onChange={(e) => set(p.key, e.target.value)}>
                      <option value="all">Todas</option><option value="own">Própria carteira</option><option value="none">Nenhuma</option>
                    </select>
                  ) : (
                    <input type="checkbox" className="h-4 w-4" aria-label={p.label} checked={cur[p.key] === true} onChange={(e) => set(p.key, e.target.checked)} />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </fieldset>
      {edit && <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Salvar perfis de acesso</button></div>}
    </div>
  );
}

// ---------------- Regras ----------------
const nums = (s) => String(s || '').split(/[\s,;]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n >= 0);
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const WA_VARS = {
  comparison: ['cliente', 'ramo', 'link'], installment: ['cliente', 'parcela', 'seguradora', 'vencimento', 'valor'], renewal: ['cliente', 'ramo', 'vencimento'],
};
const WA_LABEL = { comparison: 'Envio de comparativo', installment: 'Lembrete de parcela', renewal: 'Aviso de renovação' };

function RulesTab() {
  const { company, setCompany } = useAuth();
  const [run, busy] = useAction();
  const s = company?.settings || {};
  const init = () => ({
    alertDays: (s.renewals?.alertDays || []).join(', '),
    upcomingDays: s.installments?.upcomingDays ?? 7, reminderDays: s.installments?.reminderDays ?? 3, agingBands: (s.installments?.agingBands || []).join(', '),
    expiringDays: s.quotes?.expiringDays ?? 3, comparisonLinkDays: s.quotes?.comparisonLinkDays ?? 7,
    scoring: { coverage: 45, cost: 30, deductible: 15, assistance: 10, ...(s.scoring || {}) },
    approvals: { internalProposalApproval: false, comparisonApproval: false, ...(s.approvals || {}) },
    lossReasons: (s.lossReasons || []).join('\n'), incomeCategories: (s.incomeCategories || []).join('\n'), expenseCategories: (s.expenseCategories || []).join('\n'),
    whatsapp: { ...(s.whatsapp || {}) },
  });
  const [v, setV] = useState(init);
  useEffect(() => { setV(init()); }, [company]); // eslint-disable-line
  const weights = ['coverage', 'cost', 'deductible', 'assistance'];
  const WL = { coverage: 'Coberturas', cost: 'Custo total', deductible: 'Franquias', assistance: 'Assistências' };
  const badWeight = weights.some((k) => !(Number(v.scoring[k]) >= 0 && Number(v.scoring[k]) <= 100));
  const total = weights.reduce((a, k) => a + (Number(v.scoring[k]) || 0), 0);
  const save = async () => {
    const settings = {
      renewals: { ...(s.renewals || {}), alertDays: [...new Set(nums(v.alertDays))].sort((a, b) => b - a) },
      installments: { ...(s.installments || {}), upcomingDays: Number(v.upcomingDays) || 0, reminderDays: Number(v.reminderDays) || 0, agingBands: [...new Set(nums(v.agingBands))].sort((a, b) => a - b) },
      quotes: { ...(s.quotes || {}), expiringDays: Number(v.expiringDays) || 0, comparisonLinkDays: Number(v.comparisonLinkDays) || 1 },
      scoring: Object.fromEntries(weights.map((k) => [k, Number(v.scoring[k]) || 0])),
      approvals: v.approvals,
      lossReasons: lines(v.lossReasons), incomeCategories: lines(v.incomeCategories), expenseCategories: lines(v.expenseCategories),
      whatsapp: v.whatsapp,
    };
    const r = await run(() => api.put('/v1/company', { settings }), 'Regras salvas.');
    if (r !== FAIL) setCompany(r);
  };
  const numInput = (label, key, hint) => <Input label={label} type="number" min={0} max={365} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} hint={hint} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Renovações" subtitle="Sugestões de rotina, não prazos legais">
          <Input label="Avisar com quantos dias de antecedência" value={v.alertDays} onChange={(e) => setV({ ...v, alertDays: e.target.value })} hint="Separe por vírgula. Ex.: 90, 60, 30, 15" />
        </Section>
        <Section title="Cotações e comparativos">
          <div className="grid gap-3 sm:grid-cols-2">
            {numInput('Alertar cotação vencendo (dias)', 'expiringDays')}
            {numInput('Validade do link do comparativo (dias)', 'comparisonLinkDays')}
          </div>
        </Section>
        <Section title="Parcelas do seguro" subtitle="Painel e lembretes das parcelas pagas à seguradora">
          <div className="grid gap-3 sm:grid-cols-2">
            {numInput('Próximas do vencimento (dias)', 'upcomingDays')}
            {numInput('Lembrete antes do vencimento (dias)', 'reminderDays')}
            <Input className="sm:col-span-2" label="Faixas de atraso (dias)" value={v.agingBands} onChange={(e) => setV({ ...v, agingBands: e.target.value })} hint="Ex.: 15, 30, 60" />
          </div>
        </Section>
        <Section title="Aprovações internas">
          <Toggle checked={!!v.approvals.internalProposalApproval} onChange={(x) => setV({ ...v, approvals: { ...v.approvals, internalProposalApproval: x } })}
            label="Propostas exigem aprovação interna" hint="Um gestor aprova antes da autorização do cliente e da transmissão." />
          <Toggle checked={!!v.approvals.comparisonApproval} onChange={(x) => setV({ ...v, approvals: { ...v.approvals, comparisonApproval: x } })}
            label="Comparativos exigem aprovação antes do envio" />
        </Section>
      </div>
      <Section title="Pesos da comparação" subtitle="Aplicados somente às ofertas que já atendem aos requisitos mínimos do cliente">
        <div className="grid gap-3 sm:grid-cols-4">
          {weights.map((k) => <Input key={k} label={WL[k]} type="number" min={0} max={100} value={v.scoring[k]} onChange={(e) => setV({ ...v, scoring: { ...v.scoring, [k]: e.target.value } })} />)}
        </div>
        <p className="mt-2 text-xs text-ink-faint">Soma atual: {total}. Os pesos são proporcionais (não precisam somar 100). <b>Comissão nunca é critério</b> de “melhor oferta”.</p>
        {badWeight && <Notice tone="warn" className="mt-2">Cada peso deve ficar entre 0 e 100.</Notice>}
      </Section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Motivos de perda"><Textarea rows={7} value={v.lossReasons} onChange={(e) => setV({ ...v, lossReasons: e.target.value })} hint="Um por linha." /></Section>
        <Section title="Categorias de receita"><Textarea rows={7} value={v.incomeCategories} onChange={(e) => setV({ ...v, incomeCategories: e.target.value })} hint="Um por linha." /></Section>
        <Section title="Categorias de despesa"><Textarea rows={7} value={v.expenseCategories} onChange={(e) => setV({ ...v, expenseCategories: e.target.value })} hint="Um por linha." /></Section>
      </div>
      <Section title="Modelos de mensagem (WhatsApp)" subtitle="Abertos no WhatsApp para revisão antes do envio; nada é enviado automaticamente">
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.keys(WA_VARS).map((k) => (
            <div key={k}>
              <Textarea label={WA_LABEL[k]} rows={5} maxLength={1000} value={v.whatsapp[k] || ''} onChange={(e) => setV({ ...v, whatsapp: { ...v.whatsapp, [k]: e.target.value } })} />
              <p className="mt-1 text-xs text-ink-faint">Variáveis: {WA_VARS[k].map((x) => <code key={x} className="mr-1 rounded bg-muted px-1">{`{${x}}`}</code>)}</p>
            </div>
          ))}
        </div>
      </Section>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy || badWeight} onClick={save}><Save className="h-4 w-4" /> Salvar regras</button></div>
    </div>
  );
}

// ---------------- Aparência ----------------
function AppearanceTab() {
  const { company, user, setCompany } = useAuth();
  const [run, busy] = useAction();
  const s = company?.settings || {};
  const init = () => ({ primaryColor: s.primaryColor || '#1d4ed8', theme: s.theme || 'system', radius: s.radius || 'lg', layout: s.layout || 'side', density: s.density || 'normal', font: s.font || 'Inter' });
  const [v, setV] = useState(init);
  useEffect(() => { setV(init()); }, [company]); // eslint-disable-line
  // pré-visualização ao vivo; ao sair sem salvar, volta ao tema salvo
  useEffect(() => { applyTheme({ ...s, ...v }, {}); }, [v]); // eslint-disable-line
  const latest = useRef({ company, user });
  latest.current = { company, user };
  useEffect(() => () => applyTheme(latest.current.company?.settings, latest.current.user?.preferences), []);
  const save = async () => {
    const r = await run(() => api.put('/v1/company', { settings: v }), 'Aparência salva para toda a corretora.');
    if (r !== FAIL) setCompany(r);
  };
  const opt = (label, key, options) => (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(options).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={v[key] === k} onClick={() => setV({ ...v, [key]: k })}
            className={cx('rounded-app-sm border px-3 py-1.5 text-sm', v[key] === k ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-muted')}>{l}</button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="space-y-4">
      <Notice tone="info">A aparência vale para toda a equipe. Cada pessoa pode ajustar preferências próprias em Minha conta, que têm prioridade na tela dela.</Notice>
      <Section title="Cor principal">
        <div className="flex flex-wrap gap-2">
          {COLOR_THEMES.map(([name, hex]) => (
            <button key={name} type="button" onClick={() => setV({ ...v, primaryColor: hex })} aria-pressed={v.primaryColor === hex}
              className={cx('flex items-center gap-2 rounded-app-sm border px-2.5 py-1.5 text-sm', v.primaryColor === hex ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:bg-muted')}>
              <span className="h-4 w-4 rounded-full" style={{ background: hex }} />{name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map((hex) => (
            <button key={hex} type="button" aria-label={`Cor ${hex}`} onClick={() => setV({ ...v, primaryColor: hex })}
              className={cx('h-7 w-7 rounded-full border-2', v.primaryColor === hex ? 'border-ink' : 'border-transparent')} style={{ background: hex }} />
          ))}
          <label className="ml-2 flex items-center gap-2 text-sm">Personalizada
            <input type="color" value={v.primaryColor} onChange={(e) => setV({ ...v, primaryColor: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent" />
          </label>
        </div>
      </Section>
      <Section title="Estilo">
        <div className="grid gap-4 sm:grid-cols-2">
          {opt('Tema', 'theme', { system: 'Automático', light: 'Claro', dark: 'Escuro' })}
          {opt('Arredondamento', 'radius', Object.fromEntries(Object.keys(RADIUS).map((k) => [k, { none: 'Reto', md: 'Médio', lg: 'Padrão', xl: 'Amplo' }[k] || k])))}
          {opt('Menu', 'layout', { side: 'Lateral', top: 'Superior' })}
          {opt('Densidade', 'density', { normal: 'Confortável', compact: 'Compacta' })}
          {opt('Fonte', 'font', Object.fromEntries(Object.keys(FONTS).map((k) => [k, k])))}
        </div>
      </Section>
      <Section title="Pré-visualização">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary">Botão principal</button>
          <button type="button" className="btn-outline">Secundário</button>
          <span className="chip bg-primary/10 text-primary">Etiqueta</span>
          <Input label="" placeholder="Campo de exemplo" className="w-56" />
        </div>
      </Section>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => setV(init())}>Descartar</button>
        <button className="btn-primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Salvar aparência</button>
      </div>
    </div>
  );
}
