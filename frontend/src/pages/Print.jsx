// Comparativo para impressão / PDF (9.1): mesma projeção do cliente (sem comissão), em A4.
import { useParams } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { Loading, Empty, useFetch, StatusChip } from '../components/ui';
import { Mark } from '../components/Layout';
import { api } from '../lib/api';
import { fmt, fmtDateTime, money, maskDoc, CLASSIFICATION } from '../lib/format';
import { CompareGrid, PAY_METHOD } from './Quotes';

export function PrintComparison() {
  const { id } = useParams();
  const { data, loading } = useFetch(() => api.get(`/v1/comparisons/${id}`), [id]);
  if (loading) return <Loading />;
  if (!data) return <Empty title="Comparativo não encontrado" />;
  const v = data.view;
  const validDates = v.offers.map((o) => o.valid_until).filter(Boolean).sort();
  const chosen = v.offers.find((o) => o.id === v.chosen_offer_id);
  const chosenPay = chosen?.payment_options?.find((p) => p.id === v.chosen_payment_option);
  const pendencies = v.offers.filter((o) => o.quote_kind === 'valor_indicativo' || o.requirements || o.expired);

  return (
    <div className="min-h-full bg-zinc-100 py-6 text-zinc-900 print:bg-white print:py-0">
      <style>{'@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } .print-sheet { box-shadow: none !important; width: auto !important; padding: 0 !important; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4 print:hidden">
        <button className="btn-ghost" onClick={() => window.close()}><X className="h-4 w-4" />Fechar</button>
        <button className="btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir / salvar PDF</button>
      </div>

      <article className="print-sheet mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-sm shadow-lg">
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-zinc-900 text-white"><Mark /></div>
            <div>
              <div className="text-lg font-bold leading-tight">{v.broker?.name}</div>
              <div className="text-xs text-zinc-600">
                {v.broker?.document && <>CNPJ {maskDoc(v.broker.document)} · </>}{v.broker?.susep_code && <>SUSEP {v.broker.susep_code}</>}
              </div>
              <div className="text-xs text-zinc-600">{[v.broker?.phone, v.broker?.email].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Comparativo de seguros</div>
            <div className="text-lg font-bold">{v.number}</div>
            <div className="text-xs text-zinc-600">Emitido em {fmtDateTime(v.created_at)}</div>
            <div className="text-xs text-zinc-600">Impresso em {fmtDateTime(new Date())}</div>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 print:grid-cols-4">
          <Info label="Cliente" value={v.client?.name} />
          <Info label="Ramo" value={v.branch || '—'} />
          <Info label="Vigência pretendida" value={v.period?.start ? `${fmt(v.period.start)} a ${fmt(v.period.end)}` : 'não informada'} />
          <Info label="Validade das cotações" value={validDates.length ? `a partir de ${fmt(validDates[0])}${validDates.length > 1 && validDates[validDates.length - 1] !== validDates[0] ? ` (a mais longa até ${fmt(validDates[validDates.length - 1])})` : ''}` : 'não informada'} />
        </section>

        {v.message && <p className="mt-4 whitespace-pre-line rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">{v.message}</p>}

        {v.min_coverages?.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Coberturas mínimas solicitadas</h2>
            <p className="text-xs">{v.min_coverages.map((m) => `${m.name}${m.required === false ? ' (desejável)' : ''}${m.min_limit_cents != null ? ` — mínimo ${money(m.min_limit_cents)}` : ''}`).join('; ')}</p>
          </section>
        )}

        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Opções</h2>
          <CompareGrid offers={v.offers} minCoverages={v.min_coverages || []} badges={v.badges} chosenId={v.chosen_offer_id} chosenPayment={v.chosen_payment_option} printMode />
        </section>

        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Diferenças, pendências e pontos de decisão</h2>
          <ul className="space-y-1.5 text-xs">
            {v.offers.map((o, i) => (
              <li key={o.id}>
                <b>Opção {i + 1} — {o.institution_name}</b> <StatusChip map={CLASSIFICATION} value={o.classification} className="ml-1 border border-zinc-300" />
                {o.issues?.length ? <span>: {o.issues.join('; ')}.</span> : <span>: sem diferenças em relação ao mínimo.</span>}
                {o.requirements && <span> Exigências: {o.requirements}.</span>}
              </li>
            ))}
          </ul>
          {pendencies.length > 0 && <p className="mt-2 text-xs text-zinc-600">Valores indicativos precisam de confirmação da seguradora; exigências (vistoria, documentos, análise) devem ser cumpridas antes da contratação.</p>}
        </section>

        <section className="mt-5 break-inside-avoid rounded border border-zinc-300 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Escolha do cliente</h2>
          {chosen ? (
            <p className="text-xs">Opção escolhida: <b>{chosen.institution_name} — {chosen.product_name}</b>
              {chosenPay && <> · {PAY_METHOD[chosenPay.method] || chosenPay.method} {chosenPay.installments}x, total {money(chosenPay.total_cents)}</>}
              {v.chosen_at && <> · registrada em {fmtDateTime(v.chosen_at)}</>}.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-8 gap-y-6 pt-2 text-xs">
              <Line label="Opção escolhida (nº)" /><Line label="Forma de pagamento" />
              <Line label="Nome completo" /><Line label="Data" />
              <div className="col-span-2"><Line label="Assinatura" /></div>
            </div>
          )}
          <p className="mt-3 text-[11px] text-zinc-600">A escolha registra a manifestação do cliente e autoriza a corretora a encaminhar a proposta da opção indicada. Ela não é aceitação da seguradora: a contratação depende da análise e aceitação da seguradora.</p>
        </section>

        <footer className="mt-5 border-t border-zinc-300 pt-3 text-[11px] leading-relaxed text-zinc-600">
          <p>{v.notice}</p>
          <p className="mt-1">Prêmio total refere-se ao período de vigência indicado. Campos “não informado” não foram fornecidos pela seguradora e não devem ser lidos como zero. Consulte as condições gerais e especiais de cada produto.</p>
        </footer>
      </article>
    </div>
  );
}

const Info = ({ label, value }) => (
  <div><div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div><div className="text-xs font-medium">{value ?? '—'}</div></div>
);
const Line = ({ label }) => (
  <div><div className="h-6 border-b border-zinc-400" /><div className="mt-1 text-[10px] text-zinc-500">{label}</div></div>
);

export default PrintComparison;
