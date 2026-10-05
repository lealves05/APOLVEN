// Indicadores com definição operacional e denominador explícito (22.3), produção (prêmio intermediado ≠ receita)
// e exportações protegidas (22.4).
import { useMemo, useState } from 'react';
import { Download, Database, BarChart3, Info } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api, download, qs } from '../lib/api';
import { money, fmt, num, pct, addDaysYmd, ymd } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Section, Input, Notice, Empty, Loading, useFetch, useAction, cx } from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';

const brlShort = (cents) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
const fmtPart = (v, isMoney) => (isMoney ? money(v) : num(v));

export default function Reports() {
  const { can } = useAuth();
  const [from, setFrom] = useState(addDaysYmd(-365));
  const [to, setTo] = useState(ymd());
  const { data, loading } = useFetch(() => api.get(`/v1/reports/indicators${qs({ from, to })}`), [from, to]);
  const [run, busy] = useAction();
  const dl = (path, name) => run(() => download(path, name), 'Exportação gerada.');
  const prod = data?.production || [];
  const t = useTable(prod, { sort: 'premium_cents', dir: 'desc' });
  const byInst = useMemo(() => {
    const m = {};
    for (const p of prod) m[p.institution] = (m[p.institution] || 0) + Number(p.premium_cents || 0);
    return Object.entries(m).map(([name, v]) => ({ name, premium_cents: v })).sort((a, b) => b.premium_cents - a.premium_cents).slice(0, 12);
  }, [prod]);
  const totals = prod.reduce((a, p) => ({ policies: a.policies + Number(p.policies), premium: a.premium + Number(p.premium_cents || 0) }), { policies: 0, premium: 0 });

  return (
    <div>
      <PageHeader title="Relatórios e indicadores" subtitle="Cada indicador mostra numerador, denominador e definição. Sem dados suficientes, o valor fica em branco — nunca zero."
        actions={<>
          <Input type="date" aria-label="De" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <span className="text-ink-faint">a</span>
          <Input type="date" aria-label="Até" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </>} />
      {loading && !data ? <Loading /> : !data ? <Empty title="Não foi possível carregar os indicadores" /> : (
        <div className="space-y-6">
          <p className="text-xs text-ink-faint">Período: {fmt(data.period.from)} a {fmt(data.period.to)}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.indicators.map((i) => (
              <div key={i.key} className="card flex flex-col p-4">
                <div className="text-xs font-medium text-ink-faint">{i.label}</div>
                <div className={cx('mt-2 text-2xl font-semibold tabular-nums tracking-tight', i.value == null && 'text-ink-faint')}>{i.value == null ? 'sem base' : pct(i.value, 1)}</div>
                <div className="mt-1 text-sm tabular-nums text-ink-soft">
                  <span title="Numerador">{fmtPart(i.num, i.money)}</span> <span className="text-ink-faint">/</span> <span title="Denominador">{fmtPart(i.den, i.money)}</span>
                </div>
                <p className="mt-2 border-t border-line pt-2 text-xs text-ink-faint">{i.definition}</p>
              </div>
            ))}
          </div>

          <Section title="Produção por ramo e seguradora" subtitle="Apólices com início de vigência no período."
            actions={<span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">Prêmio intermediado — não é receita da corretora</span>} bodyClass="p-0">
            {!prod.length ? <Empty icon={BarChart3} title="Sem produção no período" /> : (
              <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
                <div className="overflow-x-auto border-line lg:border-r">
                  <table className="table-clean">
                    <thead><tr><SortTh t={t} k="branch_label">Ramo</SortTh><SortTh t={t} k="institution">Seguradora</SortTh><SortTh t={t} k="policies" className="text-right">Apólices</SortTh><SortTh t={t} k="premium_cents" className="text-right">Prêmio intermediado</SortTh></tr></thead>
                    <tbody>
                      {t.rows.map((p) => (
                        <tr key={`${p.branch}-${p.institution}`}><td>{p.branch_label || p.branch}</td><td>{p.institution}</td><td className="text-right tabular-nums">{num(p.policies)}</td><td className="text-right tabular-nums">{money(p.premium_cents)}</td></tr>
                      ))}
                      <tr className="font-semibold"><td>Total</td><td /><td className="text-right tabular-nums">{num(totals.policies)}</td><td className="text-right tabular-nums">{money(totals.premium)}</td></tr>
                    </tbody>
                  </table>
                  <Pager t={t} />
                </div>
                <div className="p-4">
                  <div className="mb-2 text-xs font-medium text-ink-faint">Prêmio intermediado por seguradora</div>
                  <div className="h-72" role="img" aria-label="Gráfico de barras do prêmio intermediado por seguradora">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byInst} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} horizontal={false} />
                        <XAxis type="number" tickFormatter={brlShort} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(v) => [money(v), 'Prêmio intermediado']} contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="premium_cents" fill="#4f46e5" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </Section>
          {data.note && <Notice><Info className="mr-1 inline h-4 w-4" />{data.note}</Notice>}

          <Section title="Exportações" subtitle="CSV com proteção contra fórmulas; documentos mascarados conforme permissão. Cada exportação fica registrada na auditoria.">
            {!can('data_export') ? <p className="text-sm text-ink-faint">Seu perfil não tem permissão de exportação de dados.</p> : (
              <div className="flex flex-wrap gap-2">
                <button className="btn-outline" disabled={busy} onClick={() => dl('/v1/reports/export/apolices', 'apolices.csv')}><Download className="h-4 w-4" /> Apólices (CSV)</button>
                <button className="btn-outline" disabled={busy} onClick={() => dl('/v1/reports/export/parcelas', 'parcelas.csv')}><Download className="h-4 w-4" /> Parcelas do seguro (CSV)</button>
                <button className="btn-outline" disabled={busy} onClick={() => dl('/v1/reports/export/comissoes', 'comissoes.csv')}><Download className="h-4 w-4" /> Comissões (CSV)</button>
                <button className="btn-outline" disabled={busy} onClick={() => dl('/v1/export', 'apolven-dados.json')}><Database className="h-4 w-4" /> Cópia completa dos dados (JSON)</button>
              </div>
            )}
            <p className="mt-3 text-xs text-ink-faint">A cópia completa não inclui senhas, segredos, tokens nem arquivos. Dados conforme a última atualização das fontes.</p>
          </Section>
        </div>
      )}
    </div>
  );
}
