// Gestão documental (19.3), importações com prévia obrigatória (19.1) e links temporários revogáveis.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, Download, Link2, FileText, Lock, Copy, FileSpreadsheet, Ban, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, download, fileToPayload, fileToText, qs, appUrl } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import {
  PageHeader, Section, Tabs, Modal, Input, Textarea, Select, Notice, Empty, Loading, FileButton, useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { fmt, fmtDateTime, money, maskDoc, BRANCHES } from '../lib/format';

const ENTITY_LABEL = {
  client: 'Cliente', policy: 'Apólice', proposal: 'Proposta', quote_request: 'Cotação', claim: 'Sinistro', provider_connection: 'Conexão com seguradora',
  service_request: 'Solicitação', endorsement: 'Endosso', company: 'Corretora', premium_installment: 'Parcela', commission_agreement: 'Acordo de comissão',
};
const UPLOAD_ENTITIES = ['company', 'client', 'policy', 'proposal', 'quote_request', 'claim', 'provider_connection', 'service_request', 'endorsement'];
const DOC_KINDS = {
  apolice: 'Apólice', certificado: 'Certificado', proposta_formal: 'Proposta formal', cotacao_formal: 'Cotação formal', condicoes_gerais: 'Condições gerais',
  endosso: 'Endosso', boleto: 'Boleto', comprovante: 'Comprovante', documento_pessoal: 'Documento pessoal', vistoria: 'Vistoria', sinistro: 'Sinistro',
  contrato: 'Contrato', certidao: 'Certidão', evidencia: 'Evidência', questionario_restrito: 'Questionário restrito (saúde)', extrato_comissao: 'Extrato de comissão', outro: 'Outro',
};
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xml,.xlsx';
const size = (b) => (b == null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

const TABS = [{ value: 'documentos', label: 'Documentos' }, { value: 'importacoes', label: 'Importações' }, { value: 'links', label: 'Links temporários' }];

export default function Documents() {
  const [sp, setSp] = useSearchParams();
  const { can, feature } = useAuth();
  // abas que dependem de módulos do plano: importações e links temporários
  const tabs = TABS.filter((t) => (t.value !== 'importacoes' || (can('imports') && feature('importacoes'))) && (t.value !== 'links' || feature('portal_cliente')));
  const tab = tabs.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'documentos';
  return (
    <>
      <PageHeader title="Documentos" subtitle="Arquivos privados com versão, origem e nível de acesso; importações com prévia antes de gravar" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp(t === 'documentos' ? {} : { tab: t })} />
      {tab === 'documentos' && <DocsTab clientId={sp.get('client_id') || ''} />}
      {tab === 'importacoes' && <ImportsTab />}
      {tab === 'links' && <LinksTab />}
    </>
  );
}

// ---------------- Documentos ----------------
function DocsTab({ clientId }) {
  const { feature } = useAuth();
  const { toast } = useUI();
  const [entity, setEntity] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, reload } = useFetch(() => api.get(`/v1/documents${qs({ entity, client_id: clientId })}`), [entity, clientId]);
  const [upload, setUpload] = useState(false);
  const [link, setLink] = useState(null);
  const rows = useMemo(() => (data || []).filter((d) => !q || `${d.filename} ${d.description || ''}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const t = useTable(rows, { sort: 'created_at', dir: 'desc' });
  const get = (d) => download(`/v1/documents/${d.id}/download`, d.filename).catch((e) => toast(e.message, 'error'));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input className="min-w-[220px] flex-1" label="Buscar" placeholder="Nome do arquivo ou descrição" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select label="Vinculado a" value={entity} onChange={(e) => setEntity(e.target.value)} className="min-w-[200px]">
          <option value="">Todos</option>
          {Object.entries(ENTITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <button className="btn-primary" onClick={() => setUpload(true)}><Upload className="h-4 w-4" /> Enviar documento</button>
      </div>
      {clientId && <Notice tone="info">Mostrando documentos de um cliente específico.</Notice>}
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="card"><Empty icon={FileText} title="Nenhum documento" text="Envie apólices, propostas, comprovantes e evidências. Os arquivos ficam privados e só saem por download autenticado ou link temporário." /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="filename">Arquivo</SortTh><SortTh t={t} k="kind">Tipo</SortTh><SortTh t={t} k="entity">Vínculo</SortTh>
              <th>Acesso</th><SortTh t={t} k="valid_until">Validade</SortTh><SortTh t={t} k="created_at">Enviado em</SortTh><th aria-label="Ações" />
            </tr></thead>
            <tbody>
              {t.rows.map((d) => (
                <tr key={d.id}>
                  <td data-label="Arquivo">
                    <div className="font-medium break-all">{d.filename}</div>
                    <div className="text-xs text-ink-faint">v{d.version} · {size(d.size)} · origem: {d.origin}{d.description ? ` · ${d.description}` : ''}</div>
                  </td>
                  <td data-label="Tipo">{DOC_KINDS[d.kind] || d.kind}</td>
                  <td data-label="Vínculo">{ENTITY_LABEL[d.entity] || d.entity}</td>
                  <td data-label="Acesso">{d.access_level === 'restrito'
                    ? <span className="chip bg-red-500/10 text-red-700 dark:text-red-300"><Lock className="h-3 w-3" /> Restrito</span>
                    : <span className="chip bg-muted text-ink-soft">Normal</span>}</td>
                  <td data-label="Validade" className="whitespace-nowrap">{d.valid_until ? fmt(d.valid_until) : '—'}</td>
                  <td data-label="Enviado em" className="whitespace-nowrap">{fmtDateTime(d.created_at)}</td>
                  <td data-label="">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost btn-icon" aria-label="Baixar" title="Baixar" onClick={() => get(d)}><Download className="h-4 w-4" /></button>
                      {d.access_level !== 'restrito' && feature('portal_cliente') && <button className="btn-ghost btn-icon" aria-label="Gerar link temporário" title="Link temporário" onClick={() => setLink(d)}><Link2 className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      {upload && <UploadModal clientId={clientId} onClose={() => setUpload(false)} onDone={() => { setUpload(false); reload(); }} />}
      {link && <LinkModal doc={link} onClose={() => setLink(null)} />}
    </div>
  );
}

function UploadModal({ clientId, onClose, onDone }) {
  const { can } = useAuth();
  const [run, busy] = useAction();
  const [v, setV] = useState({ entity: clientId ? 'client' : 'company', entity_id: '', client_id: clientId || '', kind: 'outro', access_level: 'normal', valid_until: '', description: '' });
  const [file, setFile] = useState(null);
  const [term, setTerm] = useState('');
  const [clients, setClients] = useState([]);
  useEffect(() => {
    if (term.trim().length < 2) { setClients([]); return undefined; }
    const tm = setTimeout(() => { api.get(`/v1/clients${qs({ q: term.trim() })}`).then((r) => setClients((Array.isArray(r) ? r : r?.rows || []).slice(0, 8))).catch(() => setClients([])); }, 300);
    return () => clearTimeout(tm);
  }, [term]);
  const restrictedOk = can('documents_restricted');
  const needsId = !['company', 'client'].includes(v.entity);
  const uuid = /^[0-9a-f-]{36}$/i;
  const invalid = !file || (v.entity === 'client' && !v.client_id) || (needsId && !uuid.test(v.entity_id.trim()));
  const submit = async () => {
    const r = await run(async () => {
      const payload = await fileToPayload(file);
      const restricted = v.access_level === 'restrito' || v.kind === 'questionario_restrito';
      return api.post('/v1/documents', {
        entity: v.entity, entity_id: v.entity === 'client' ? v.client_id : needsId ? v.entity_id.trim() : null,
        client_id: v.client_id || null, kind: v.kind, access_level: restricted ? 'restrito' : 'normal',
        valid_until: v.valid_until || null, description: v.description.trim() || null, ...payload,
      });
    }, 'Documento enviado.');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} title="Enviar documento" subtitle="PDF, imagem, CSV, TXT, XML ou XLSX — até 8 MB. O conteúdo é conferido no servidor."
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || invalid} onClick={submit}>Enviar</button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileButton accept={ACCEPT} onFile={setFile}><Upload className="h-4 w-4" /> {file ? 'Trocar arquivo' : 'Escolher arquivo'}</FileButton>
          <span className="text-sm text-ink-soft break-all">{file ? `${file.name} (${size(file.size)})` : 'Nenhum arquivo escolhido'}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Vinculado a" value={v.entity} onChange={(e) => setV({ ...v, entity: e.target.value, entity_id: '' })}>
            {UPLOAD_ENTITIES.map((k) => <option key={k} value={k}>{ENTITY_LABEL[k]}</option>)}
          </Select>
          <Select label="Tipo de documento" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value, ...(e.target.value === 'questionario_restrito' ? { access_level: 'restrito' } : {}) })}>
            {Object.entries(DOC_KINDS).filter(([k]) => k !== 'questionario_restrito' || restrictedOk).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        {(v.entity === 'client' || v.entity !== 'company') && (
          <div>
            <Input label={v.entity === 'client' ? 'Cliente' : 'Cliente relacionado (opcional)'} placeholder="Digite nome ou CPF/CNPJ" value={term} onChange={(e) => setTerm(e.target.value)} />
            {clients.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-app-sm border border-line">
                {clients.map((c) => (
                  <li key={c.id}><button type="button" className={cx('w-full px-3 py-2 text-left text-sm hover:bg-muted', v.client_id === c.id && 'bg-primary/10')}
                    onClick={() => { setV({ ...v, client_id: c.id }); setTerm(c.name); setClients([]); }}>
                    {c.name} <span className="text-xs text-ink-faint">{c.document_masked || ''}</span></button></li>
                ))}
              </ul>
            )}
            {v.client_id && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Cliente selecionado.</p>}
          </div>
        )}
        {needsId && (
          <Input label={`Identificador do registro (${ENTITY_LABEL[v.entity]})`} value={v.entity_id} onChange={(e) => setV({ ...v, entity_id: e.target.value })}
            hint="Normalmente o envio é feito pela tela do próprio registro, que preenche este campo. Cole aqui o identificador interno, se necessário." />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Nível de acesso" value={v.kind === 'questionario_restrito' ? 'restrito' : v.access_level} disabled={v.kind === 'questionario_restrito'}
            onChange={(e) => setV({ ...v, access_level: e.target.value })}
            hint={restrictedOk ? 'Restrito: saúde e questionários; não pode ser compartilhado por link.' : 'Documentos restritos exigem permissão específica.'}>
            <option value="normal">Normal</option>
            {restrictedOk && <option value="restrito">Restrito</option>}
          </Select>
          <Input label="Válido até" type="date" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} />
        </div>
        <Textarea label="Descrição" value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </div>
    </Modal>
  );
}

function LinkModal({ doc, onClose }) {
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [hours, setHours] = useState(48);
  const [url, setUrl] = useState(null);
  const create = async () => {
    const r = await run(() => api.post(`/v1/documents/${doc.id}/link`, { hours: Number(hours) }), 'Link criado.');
    if (r !== FAIL) setUrl(appUrl(r.path));
  };
  return (
    <Modal open onClose={onClose} title="Link temporário" subtitle={doc.filename}
      footer={<><button className="btn-ghost" onClick={onClose}>Fechar</button>
        {!url && <button className="btn-primary" disabled={busy} onClick={create}>Gerar link</button>}</>}>
      {!url ? (
        <div className="space-y-3">
          <Select label="Validade" value={hours} onChange={(e) => setHours(e.target.value)}>
            {[[2, '2 horas'], [24, '24 horas'], [48, '48 horas'], [72, '3 dias'], [168, '7 dias']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}
          </Select>
          <Notice tone="info">Quem tiver o link pode baixar o arquivo até o vencimento. Os acessos ficam registrados e o link pode ser revogado na aba “Links temporários”.</Notice>
        </div>
      ) : (
        <div className="space-y-3">
          <Notice tone="warn">Copie o link agora: por segurança, ele não é exibido novamente.</Notice>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link temporário" />
            <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copiado.'); }}><Copy className="h-4 w-4" /> Copiar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Importações (19.1) ----------------
const IMPORTS = {
  clients: {
    title: 'Clientes', path: '/v1/reports/imports/clients', columns: 'nome;tipo;documento;email;telefone;origem',
    example: 'nome;tipo;documento;email;telefone;origem', note: 'tipo: PF ou PJ (deduzido pelo documento quando vazio). Clientes com documento já cadastrado são rejeitados.',
  },
  policies: {
    title: 'Apólices', path: '/v1/reports/imports/policies', columns: 'apolice;documento_cliente;seguradora;ramo;inicio;fim;premio_total;produto',
    example: 'apolice;documento_cliente;seguradora;ramo;inicio;fim;premio_total;produto',
    note: `seguradora: nome exatamente como cadastrado · ramo: código (${Object.keys(BRANCHES).slice(0, 6).join(', ')}…) · importe os clientes antes. As apólices entram para conferência com o documento.`,
  },
};

function ImportsTab() {
  return (
    <div className="space-y-4">
      <Notice tone="info">A importação é feita em duas etapas: primeiro a <b>prévia</b> (nada é gravado), depois a <b>gravação</b> somente das linhas aceitas. Linhas rejeitadas podem ser baixadas para correção.</Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        <ImportCard kind="clients" />
        <ImportCard kind="policies" />
      </div>
    </div>
  );
}

function ImportCard({ kind }) {
  const cfg = IMPORTS[kind];
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [file, setFile] = useState(null);
  const [content, setContent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const reset = () => { setFile(null); setContent(null); setPreview(null); setDone(null); };
  const choose = async (f) => {
    reset();
    if (f.size > 5_000_000) { setDone({ error: 'Arquivo acima de 5 MB. Divida em partes.' }); return; }
    const text = await fileToText(f);
    setFile(f); setContent(text);
    const r = await run(() => api.post(cfg.path, { content: text, commit: false }));
    if (r !== FAIL) setPreview(r);
  };
  const commit = async () => {
    if (!(await confirm({ title: `Gravar ${preview.accepted} registro(s)?`, message: `Serão gravadas somente as linhas aceitas na prévia. ${preview.rejected?.length || 0} linha(s) rejeitada(s) não serão importadas.`, confirmText: 'Gravar importação', danger: false }))) return;
    const r = await run(() => api.post(cfg.path, { content, commit: true }), 'Importação concluída.');
    if (r !== FAIL) { setDone(r); setPreview(null); }
  };
  const rejectedCsv = (r) => {
    const csv = r.rejected_csv || ['linha;identificacao;erros', ...(r.rejected || []).map((x) => [x.line, x.name || x.policy_number || '', (x.errors || []).join(', ')].map((s) => `"${String(s ?? '').replaceAll('"', '""')}"`).join(';'))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rejeitados-${kind}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const template = () => {
    const blob = new Blob(['﻿' + cfg.example + '\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `modelo-${kind}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <Section title={`Importar ${cfg.title.toLowerCase()} (CSV)`} actions={<button className="btn-ghost" onClick={template}><FileSpreadsheet className="h-4 w-4" /> Modelo</button>}>
      <div className="space-y-3">
        <div>
          <p className="text-xs text-ink-faint">Colunas esperadas (separadas por ponto e vírgula, com cabeçalho):</p>
          <code className="mt-1 block break-all rounded-app-sm bg-muted px-2 py-1.5 text-xs">{cfg.columns}</code>
          <p className="mt-1 text-xs text-ink-faint">{cfg.note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FileButton accept=".csv,text/csv,text/plain" onFile={choose} disabled={busy}><Upload className="h-4 w-4" /> {file ? 'Escolher outro arquivo' : 'Escolher arquivo CSV'}</FileButton>
          {file && <span className="text-sm text-ink-soft">{file.name}</span>}
          {(file || done) && <button className="btn-ghost" onClick={reset}>Limpar</button>}
        </div>
        {done?.error && <Notice tone="danger">{done.error}</Notice>}

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> {preview.accepted} aceita(s)</span>
              <span className="chip bg-red-500/10 text-red-700 dark:text-red-300"><AlertTriangle className="h-3 w-3" /> {preview.rejected?.length || 0} rejeitada(s)</span>
              <span className="text-xs text-ink-faint">Prévia — nada foi gravado.</span>
            </div>
            {preview.preview?.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-app-sm border border-line">
                <table className="table-clean">
                  {kind === 'clients' ? (
                    <><thead><tr><th>Linha</th><th>Nome</th><th>Tipo</th><th>Documento</th><th>Contato</th></tr></thead>
                      <tbody>{preview.preview.map((x) => (
                        <tr key={x.line}><td data-label="Linha">{x.line}</td><td data-label="Nome">{x.name}</td><td data-label="Tipo">{x.kind === 'pj' ? 'PJ' : 'PF'}</td>
                          <td data-label="Documento">{x.document ? maskDoc(x.document) : '—'}</td><td data-label="Contato" className="text-xs">{[x.email, x.phone].filter(Boolean).join(' · ') || '—'}</td></tr>
                      ))}</tbody></>
                  ) : (
                    <><thead><tr><th>Linha</th><th>Apólice</th><th>Ramo</th><th>Vigência</th><th>Prêmio total</th></tr></thead>
                      <tbody>{preview.preview.map((x) => (
                        <tr key={x.line}><td data-label="Linha">{x.line}</td><td data-label="Apólice">{x.policy_number}<div className="text-xs text-ink-faint">{x.product}</div></td>
                          <td data-label="Ramo">{BRANCHES[x.branch] || x.branch}</td><td data-label="Vigência" className="whitespace-nowrap">{fmt(x.start)} a {fmt(x.end)}</td>
                          <td data-label="Prêmio total" className="tabular-nums">{money(x.premium, 'não informado')}</td></tr>
                      ))}</tbody></>
                  )}
                </table>
                {preview.accepted > preview.preview.length && <p className="px-3 py-2 text-xs text-ink-faint">Mostrando as primeiras {preview.preview.length} de {preview.accepted} linhas aceitas.</p>}
              </div>
            )}
            {preview.rejected?.length > 0 && <RejectedList rows={preview.rejected} />}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy || !preview.accepted} onClick={commit}>Gravar {preview.accepted} linha(s) aceita(s)</button>
              {preview.rejected?.length > 0 && <button className="btn-outline" onClick={() => rejectedCsv(preview)}><Download className="h-4 w-4" /> Baixar rejeitadas</button>}
            </div>
          </div>
        )}

        {done && !done.error && (
          <div className="space-y-2">
            <Notice tone="ok">{done.inserted} registro(s) gravado(s). {done.rejected?.length ? `${done.rejected.length} linha(s) rejeitada(s) não foram importadas.` : ''}
              {kind === 'policies' && ' Apólices importadas devem ser conferidas com o documento emitido.'}</Notice>
            {done.rejected?.length > 0 && <button className="btn-outline" onClick={() => rejectedCsv(done)}><Download className="h-4 w-4" /> Baixar CSV de rejeitadas</button>}
          </div>
        )}
      </div>
    </Section>
  );
}

function RejectedList({ rows }) {
  return (
    <details className="rounded-app-sm border border-line px-3 py-2 text-sm" open={rows.length <= 5}>
      <summary className="cursor-pointer font-medium">Linhas rejeitadas ({rows.length})</summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
        {rows.map((x) => <li key={x.line}><b>Linha {x.line}</b>{x.name || x.policy_number ? ` (${x.name || x.policy_number})` : ''}: {(x.errors || []).join('; ')}</li>)}
      </ul>
    </details>
  );
}

// ---------------- Links ----------------
const PURPOSE = { documento: 'Documento', comparativo: 'Comparativo', parcelas: 'Parcelas' };

function LinksTab() {
  const { confirm } = useUI();
  const [run] = useAction();
  const { data, loading, reload } = useFetch(() => api.get('/v1/documents/links'), []);
  const revoke = async (l) => {
    if (!(await confirm({ title: 'Revogar link?', message: 'Quem tiver o link perderá o acesso imediatamente.', confirmText: 'Revogar' }))) return;
    if (await run(() => api.post(`/v1/documents/links/${l.id}/revoke`, {}), 'Link revogado.') !== FAIL) reload();
  };
  if (loading && !data) return <Loading />;
  if (!data?.length) return <div className="card"><Empty icon={Link2} title="Nenhum link temporário" text="Links gerados para documentos, comparativos e parcelas aparecem aqui." /></div>;
  const now = Date.now();
  return (
    <div className="card overflow-x-auto">
      <table className="table-clean">
        <thead><tr><th>Finalidade</th><th>Criado em</th><th>Expira em</th><th>Acessos</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
        <tbody>
          {data.map((l) => {
            const st = l.revoked_at ? ['Revogado', 'bg-red-500/10 text-red-700 dark:text-red-300'] : new Date(l.expires_at).getTime() < now ? ['Expirado', 'bg-muted text-ink-soft'] : ['Ativo', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'];
            return (
              <tr key={l.id}>
                <td data-label="Finalidade">{PURPOSE[l.purpose] || l.purpose}<div className="text-xs text-ink-faint">{ENTITY_LABEL[l.entity] || l.entity}</div></td>
                <td data-label="Criado em" className="whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                <td data-label="Expira em" className="whitespace-nowrap">{fmtDateTime(l.expires_at)}</td>
                <td data-label="Acessos">{l.access_count ?? 0}{l.last_access_at && <div className="text-xs text-ink-faint">último {fmtDateTime(l.last_access_at)}</div>}</td>
                <td data-label="Situação"><span className={cx('chip', st[1])}>{st[0]}</span></td>
                <td data-label="">{!l.revoked_at && new Date(l.expires_at).getTime() >= now && <button className="btn-ghost text-red-600" onClick={() => revoke(l)}><Ban className="h-4 w-4" /> Revogar</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
