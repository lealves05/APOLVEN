// Comunicação (5.3/20.1): mensagens preparadas no sistema e enviadas pelo aparelho do próprio usuário.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Mail, Phone, Plus, AlertTriangle, Info, Send, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime, waLink, fillTemplate, onlyDigits } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Section, Modal, Textarea, Select, Notice, Empty, Loading, useFetch, useAction, FAIL, cx } from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { ClientPicker } from './Clients';

const CHANNEL = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  email: { label: 'E-mail', icon: Mail },
  telefone: { label: 'Telefone', icon: Phone },
};
const PURPOSE = {
  relacionamento: 'Relacionamento', marketing: 'Marketing', comparativo: 'Comparativo', parcela: 'Parcela', renovacao: 'Renovação', sinistro: 'Sinistro', outro: 'Outro',
};
const TEMPLATE_INFO = {
  comparison: { label: 'Envio de comparativo', purpose: 'comparativo', vars: ['cliente', 'ramo', 'link'] },
  installment: { label: 'Lembrete de parcela', purpose: 'parcela', vars: ['cliente', 'parcela', 'seguradora', 'vencimento', 'valor'] },
  renewal: { label: 'Renovação', purpose: 'renovacao', vars: ['cliente', 'ramo', 'vencimento'] },
};
const varsOf = (text) => [...new Set((String(text || '').match(/\{([a-z_]+)\}/gi) || []).map((m) => m.slice(1, -1)))];

/** Links de envio pelo aparelho (nada é enviado pelo servidor). */
function sendLinks(channel, { phone, email }, body, subject = 'Contato da corretora') {
  if (channel === 'whatsapp') return phone ? { href: waLink(phone, body), label: 'Abrir no WhatsApp', icon: MessageCircle } : null;
  if (channel === 'email') return email ? { href: `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, label: 'Abrir no e-mail', icon: Mail } : null;
  return phone ? { href: `tel:${onlyDigits(phone)}`, label: 'Ligar', icon: Phone } : null;
}

function ComposeModal({ open, onClose, onSaved, templates }) {
  const [v, setV] = useState({ client: null, channel: 'whatsapp', purpose: 'relacionamento', body: '' });
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (open) { setV({ client: null, channel: 'whatsapp', purpose: 'relacionamento', body: '' }); setError(null); setReady(null); } }, [open]);
  const pending = varsOf(v.body);
  const applyTemplate = (key) => {
    if (!key) return;
    const first = (v.client?.name || '').split(' ')[0];
    setV({ ...v, purpose: TEMPLATE_INFO[key]?.purpose || v.purpose, body: fillTemplate(templates[key], first ? { cliente: first } : {}) });
  };
  const save = async () => {
    setError(null);
    const r = await run(() => api.post('/v1/messages', { client_id: v.client.id, channel: v.channel, purpose: v.purpose, body: v.body.trim() }), null, (e) => {
      if (e.status === 409) { setError(e.message); return true; }
      return false;
    });
    if (r === FAIL) return;
    setReady({ msg: r, link: sendLinks(v.channel, r, v.body.trim()) });
    onSaved();
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Preparar mensagem" subtitle="A mensagem é registrada no histórico do cliente e enviada por você, pelo seu aparelho."
      footer={ready ? <button className="btn-ghost" onClick={onClose}>Fechar</button> : (
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy || !v.client || v.body.trim().length < 2} onClick={save}><Send className="h-4 w-4" /> {busy ? 'Preparando…' : 'Preparar envio'}</button>
        </>
      )}>
      {ready ? (
        <div className="space-y-4">
          <Notice tone="ok">Mensagem registrada no histórico de {v.client?.name}. Agora conclua o envio pelo seu aparelho.</Notice>
          <pre className="whitespace-pre-wrap rounded-app-sm bg-muted p-3 font-sans text-sm">{ready.msg.body}</pre>
          {ready.link ? (
            <a className="btn-primary w-full justify-center" href={ready.link.href} target="_blank" rel="noopener noreferrer">
              <ready.link.icon className="h-4 w-4" /> {ready.link.label}
            </a>
          ) : (
            <Notice tone="warn">O cliente não tem {v.channel === 'email' ? 'e-mail' : 'telefone'} cadastrado. <Link to={`/clientes/${v.client?.id}`} className="font-medium underline">Completar cadastro</Link> e copie o texto acima.</Notice>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {error && <Notice tone="danger" className="sm:col-span-2"><AlertTriangle className="mr-1 inline h-4 w-4" />{error}{v.purpose === 'marketing' && ' Registre a autorização de marketing na ficha do cliente (aba Autorizações) ou use outra finalidade se não for marketing.'}</Notice>}
          <div className="sm:col-span-2"><ClientPicker required value={v.client} onChange={(x) => setV({ ...v, client: x })} /></div>
          <Select label="Canal" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
            {Object.entries(CHANNEL).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </Select>
          <Select label="Finalidade" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>
            {Object.entries(PURPOSE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          {v.purpose === 'marketing' && <p className="text-xs text-ink-faint sm:col-span-2">Marketing exige autorização registrada e cliente sem bloqueio de marketing.</p>}
          <Select label="Usar modelo (opcional)" value="" onChange={(e) => applyTemplate(e.target.value)} className="sm:col-span-2">
            <option value="">Selecione um modelo…</option>
            {Object.keys(templates).map((k) => <option key={k} value={k}>{TEMPLATE_INFO[k]?.label || k}</option>)}
          </Select>
          <Textarea label="Mensagem *" rows={6} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="sm:col-span-2" />
          {pending.length > 0 && (
            <Notice tone="warn" className="sm:col-span-2">Substitua as variáveis antes de enviar: {pending.map((x) => `{${x}}`).join(', ')}.</Notice>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Communication() {
  const { company } = useAuth();
  const templates = company?.settings?.whatsapp || {};
  const { data, loading, reload } = useFetch(() => api.get('/v1/messages'), []);
  const [open, setOpen] = useState(false);
  const t = useTable(data, { sort: 'created_at', dir: 'desc', get: { client: (r) => r.client_name } });
  const tplList = useMemo(() => Object.entries(templates), [templates]);

  return (
    <>
      <PageHeader title="Comunicação" subtitle="Mensagens preparadas no sistema e enviadas pelo seu próprio WhatsApp, e-mail ou telefone."
        actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova mensagem</button>} />

      <Notice className="mb-5">
        <Info className="mr-1 inline h-4 w-4" />
        O sistema <strong>não envia mensagens automaticamente</strong>. Integração com provedores oficiais de WhatsApp (API Business) ou de e-mail depende de contratação específica e
        <strong> não está ativa</strong>. Cada mensagem preparada fica registrada no histórico do cliente.
      </Notice>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {loading && !data ? <Loading /> : !data ? (
            <Section><Empty icon={AlertTriangle} title="Não foi possível carregar" action={<button className="btn-outline" onClick={reload}>Tentar de novo</button>} /></Section>
          ) : !data.length ? (
            <Section><Empty icon={MessageCircle} title="Nenhuma mensagem preparada" text="Prepare mensagens de relacionamento, parcelas, renovações e comparativos."
              action={<button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova mensagem</button>} /></Section>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table-clean">
                <thead><tr>
                  <SortTh t={t} k="created_at">Data</SortTh>
                  <SortTh t={t} k="client">Cliente</SortTh>
                  <SortTh t={t} k="channel">Canal</SortTh>
                  <SortTh t={t} k="purpose">Finalidade</SortTh>
                  <th>Mensagem</th>
                  <th>Preparada por</th>
                </tr></thead>
                <tbody>
                  {t.rows.map((m) => {
                    const C = CHANNEL[m.channel] || CHANNEL.whatsapp;
                    return (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                        <td>{m.client_id ? <Link to={`/clientes/${m.client_id}`} className="hover:text-primary">{m.client_name}</Link> : '—'}</td>
                        <td><span className="inline-flex items-center gap-1"><C.icon className="h-4 w-4 text-ink-faint" aria-hidden />{C.label}</span></td>
                        <td><span className={cx('chip', m.purpose === 'marketing' ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-muted text-ink-soft')}>{PURPOSE[m.purpose] || m.purpose}</span></td>
                        <td className="max-w-sm"><p className="line-clamp-2 text-sm" title={m.body}>{m.body}</p></td>
                        <td>{m.created_by_name || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager t={t} />
            </div>
          )}
        </div>

        <Section title="Modelos de WhatsApp" subtitle="Definidos em Configurações. Somente leitura aqui."
          actions={<Link to="/configuracoes" className="text-xs font-medium text-primary hover:underline">Editar modelos</Link>}>
          {!tplList.length ? <Empty title="Nenhum modelo configurado" /> : (
            <ul className="space-y-4">
              {tplList.map(([k, text]) => (
                <li key={k}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{TEMPLATE_INFO[k]?.label || k}</span>
                    {TEMPLATE_INFO[k] && <span className="chip bg-muted text-ink-soft">{PURPOSE[TEMPLATE_INFO[k].purpose]}</span>}
                  </div>
                  <p className="whitespace-pre-wrap rounded-app-sm bg-muted p-2.5 text-sm">{text}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {varsOf(text).map((x) => <code key={x} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{`{${x}}`}</code>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 flex items-start gap-1 text-xs text-ink-faint"><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Os modelos são preenchidos automaticamente nas telas de comparativo, parcelas e renovações; aqui você pode usá-los como ponto de partida.</p>
        </Section>
      </div>

      <ComposeModal open={open} templates={templates} onClose={() => setOpen(false)} onSaved={reload} />
    </>
  );
}
