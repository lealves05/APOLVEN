// Seguradoras e Integrações › Contrato da API: documentação legível do "padrão APOLVEN" (apolven-cotacao/1) para que
// uma seguradora, parceiro de multicálculo ou middleware implemente a API de cotação. JSON Schemas e exemplos vêm do servidor.
import { useState } from 'react';
import { Copy, Download, FileJson, ShieldCheck, Clock, Repeat, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';
import { Section, Notice, Loading, Empty, useFetch, cx } from './ui';

const AUTH_HELP = {
  bearer: 'Cabeçalho Authorization: Bearer <token>.',
  api_key: 'Chave em um cabeçalho com o nome configurado pela corretora (ex.: X-API-Key: <chave>).',
  oauth2_cc: 'OAuth2 client credentials: o APOLVEN pede o token em POST {endereço do token} (grant_type=client_credentials, cliente em HTTP Basic) e envia Authorization: Bearer <access_token>.',
};

function Code({ value, name }) {
  const { toast } = useUI();
  const text = JSON.stringify(value, null, 2);
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch { toast('Não foi possível copiar.', 'error'); } };
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="overflow-hidden rounded-app-sm border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-muted/60 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-ink-soft">{name}</span>
        <span className="flex gap-1">
          <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={copy}><Copy className="h-3.5 w-3.5" />Copiar</button>
          <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={save}><Download className="h-3.5 w-3.5" />Baixar</button>
        </span>
      </div>
      <pre className="max-h-[420px] overflow-auto bg-zinc-950 p-3 text-[12px] leading-relaxed text-zinc-100">{text}</pre>
    </div>
  );
}

const TABS = [['requisicao', 'Requisição'], ['resposta', 'Resposta'], ['status', 'Teste de conexão']];

export default function QuoteApiContract() {
  const { data: k, loading } = useFetch(() => api.get('/v1/integrations/api-contract'), []);
  const [tab, setTab] = useState('requisicao');
  if (loading && !k) return <Loading />;
  if (!k) return <Empty title="Contrato indisponível" />;
  const schema = { requisicao: k.request_schema, resposta: k.response_schema, status: k.status_schema }[tab];
  const example = { requisicao: k.examples.requisicao, resposta: k.examples.resposta, status: k.examples.status }[tab];
  return (
    <div className="space-y-4">
      <Section title={`Contrato da API de cotação — padrão APOLVEN (${k.contract})`}
        subtitle="Para seguradoras, parceiros de multicálculo e middlewares que querem receber cotações automáticas do APOLVEN">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <p>A corretora cadastra o <b>endereço base https</b> da sua API e a autenticação. O APOLVEN faz duas chamadas, sempre com <code className="rounded bg-muted px-1">Content-Type: application/json</code> e o cabeçalho <code className="rounded bg-muted px-1">X-Apolven-Contrato: {k.contract}</code>:</p>
            <ul className="space-y-2">
              <li className="rounded-app-sm border border-line p-2.5"><span className="chip mr-2 bg-sky-500/10 font-mono text-sky-700 dark:text-sky-300">GET</span><code>{'{base}'}/{k.paths.status}</code>
                <span className="mt-1 block text-xs text-ink-soft">Teste de conexão: confirma autenticação e contrato. Não cota nada.</span></li>
              <li className="rounded-app-sm border border-line p-2.5"><span className="chip mr-2 bg-emerald-500/10 font-mono text-emerald-700 dark:text-emerald-300">POST</span><code>{'{base}'}/{k.paths.quote}</code>
                <span className="mt-1 block text-xs text-ink-soft">Cotação: um pedido por seguradora e cenário. Responda HTTP 200 com as ofertas (ou a recusa).</span></li>
            </ul>
            <div>
              <p className="mb-1 font-medium">Autenticação aceita</p>
              <ul className="list-disc space-y-1 pl-5 text-ink-soft">{Object.entries(k.auth_types).map(([key, l]) => <li key={key}><b className="text-ink">{l}:</b> {AUTH_HELP[key]}</li>)}</ul>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Regras</p>
            <ul className="space-y-2 text-ink-soft">
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Somente https, nome público (sem IP, rede interna ou redirecionamento). Resposta até {Math.round(k.limits.response_max_bytes / 1024)} KB, JSON válido e no schema — campos não previstos são recusados.</span></li>
              <li className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Tempo máximo configurado pela corretora (até {k.limits.timeout_ms_max / 1000} s). Sem resposta: “tempo esgotado”, nunca recusa.</span></li>
              <li className="flex gap-2"><Repeat className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>HTTP 408, 429 e 5xx são falhas técnicas: até {k.limits.retries} novas tentativas com o mesmo <code>id_requisicao</code> e cabeçalho <code>Idempotency-Key</code> — devolva a mesma resposta. 401/403 = credencial recusada; 422 = dados insuficientes.</span></li>
              <li className="flex gap-2"><ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Valores em centavos (inteiros), datas AAAA-MM-DD. <b>valida</b> exige número da cotação e validade; <b>indicativa</b> é valor a confirmar; <b>recusa</b> exige motivo. Use os códigos de cobertura recebidos.</span></li>
              <li className="flex gap-2"><FileJson className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Limite de {k.limits.rate_per_minute} consultas por minuto por corretora. O pedido traz só os dados necessários para precificar.</span></li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Schemas e exemplos" subtitle="JSON Schema (draft 2020-12). Os mesmos arquivos estão no repositório em docs/api-cotacao/."
        actions={<div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map(([key, l]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={cx('rounded-full border px-3 py-1 text-sm', tab === key ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line text-ink-soft hover:bg-muted')}>{l}</button>
          ))}
        </div>}>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="min-w-0"><p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Exemplo</p><Code value={example} name={`exemplo-${tab}.json`} /></div>
          <div className="min-w-0"><p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">JSON Schema</p><Code value={schema} name={`${tab}.schema.json`} /></div>
        </div>
        {tab === 'resposta' && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Exemplo de recusa</p>
            <Code value={k.examples.recusa} name="exemplo-recusa.json" />
          </div>
        )}
        <Notice className="mt-4">A resposta original fica guardada na cotação (somente para a equipe) e nunca é mostrada ao cliente. Ofertas recebidas entram no comparativo com origem “Retorno da API da seguradora”.</Notice>
      </Section>
    </div>
  );
}
