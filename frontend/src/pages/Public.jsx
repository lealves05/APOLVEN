// Portal do cliente por link temporário (23): sem login, sem comissão, sem dados internos.
// Escolha do cliente ≠ aceite da seguradora; comprovante enviado = "pagamento informado" (em conferência).
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, AlertTriangle, Clock, Download, ExternalLink, FileUp, Loader2, Phone, ShieldCheck, Upload, X, FileText, MessageCircle, ChevronRight } from 'lucide-react';
import { CentsInput, Input, Notice, StatusChip, Spinner, cx, Hint, SubmitButton } from '../components/ui';
import { TERMS, COVERAGE_TERMS } from '../lib/glossary';
import { Mark } from '../components/Layout';
import { apiBase, fileToPayload } from '../lib/api';
import { money, moneyOrNA, fmt, fmtDateTime, ymd, CLASSIFICATION, INSTALLMENT_STATUS } from '../lib/format';
import { OfferBadges, PaymentOptions, PAY_METHOD, QUOTE_KIND } from './Quotes';

class PubError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function pub(path, body) {
  let res;
  try {
    res = await fetch(`${apiBase}/public${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch { throw new PubError(0, 'Não foi possível conectar. Verifique sua internet e tente de novo.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PubError(res.status, data.error || 'Não foi possível concluir. Tente de novo em instantes.');
  return data;
}
function usePublic(path) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const load = async () => {
    try { set({ loading: false, data: await pub(path), error: null }); } catch (e) { set({ loading: false, data: null, error: e }); }
  };
  useEffect(() => { load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

/** Dica de glossário pelo código do termo. */
const T = ({ k }) => (TERMS[k] ? <Hint label={TERMS[k][0]}>{TERMS[k][1]}</Hint> : null);

/** Link de WhatsApp da corretora (telefone brasileiro sem DDI recebe 55). */
export function waLink(phone, text) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const n = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** "Franquia normal" → "normal" (evita "franquia Franquia normal"). */
const deductible = (c) => {
  const t = c.deductible_text ? c.deductible_text.replace(/^franquia\s*:?\s*/i, '').trim() : '';
  const val = c.deductible_cents != null ? money(c.deductible_cents) : '';
  if (t && val && !t.includes(val)) return `${t} (${val})`;
  return t || val || 'não informada';
};

function Shell({ broker, children, title }) {
  useEffect(() => { document.title = title ? `${title} — ${broker?.name || 'APOLVEN'}` : 'APOLVEN'; }, [title, broker?.name]);
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-app-sm bg-primary text-primary-fg"><Mark /></div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">{broker?.name || 'Sua corretora de seguros'}</div>
            <div className="text-[11px] text-ink-faint">{broker?.susep_code ? `SUSEP ${broker.susep_code} · ` : ''}Acesso seguro por link temporário</div>
          </div>
          {broker?.phone && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {waLink(broker.phone) && <a href={waLink(broker.phone, 'Olá! Tenho uma dúvida sobre o meu seguro.')} target="_blank" rel="noopener noreferrer" className="btn-outline h-9 px-2.5 text-xs"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
              <a href={`tel:${broker.phone.replace(/\D/g, '')}`} className="btn-ghost h-9 min-w-[2.25rem] px-2.5" aria-label={`Ligar para a corretora: ${broker.phone}`}><Phone className="h-4 w-4" /><span className="hidden text-xs sm:inline">{broker.phone}</span></a>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5 sm:py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-[11px] text-ink-faint">
        Este link é pessoal e temporário. Não compartilhe. · Plataforma APOLVEN
      </footer>
    </div>
  );
}

function StateScreen({ icon: Icon, tone = 'text-ink-faint', title, text }) {
  return (
    <Shell>
      <div className="card mx-auto max-w-md px-6 py-12 text-center">
        <Icon className={cx('mx-auto h-10 w-10', tone)} />
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        {text && <p className="mt-2 text-sm text-ink-soft">{text}</p>}
      </div>
    </Shell>
  );
}
const Loader = () => <StateScreen icon={Loader2} tone="animate-spin text-ink-faint" title="Carregando…" />;
function ErrorScreen({ error }) {
  if (error.status === 410) return <StateScreen icon={Clock} tone="text-amber-500" title="Link expirado" text={`${error.message} Por segurança, os links da corretora valem por tempo limitado.`} />;
  if (error.status === 404) return <StateScreen icon={AlertTriangle} tone="text-amber-500" title="Link não encontrado" text="Confira se o endereço foi copiado inteiro ou peça um novo link à corretora." />;
  if (error.status === 429) return <StateScreen icon={Clock} tone="text-amber-500" title="Muitas tentativas" text="Aguarde alguns minutos e tente de novo." />;
  return <StateScreen icon={AlertTriangle} tone="text-red-500" title="Não foi possível abrir" text={error.message} />;
}

// ================= Comparativo =================
export function PublicComparison() {
  const { token } = useParams();
  const { loading, data: v, error, reload } = usePublic(`/comparativo/${token}`);
  const [offerId, setOfferId] = useState(null);
  const [payId, setPayId] = useState('');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [active, setActive] = useState(0);
  const railRef = useRef(null);
  if (loading) return <Loader />;
  if (error) return <ErrorScreen error={error} />;

  const indicative = (o) => o.quote_kind && o.quote_kind !== 'cotacao_valida';
  const goTo = (i) => {
    const el = railRef.current?.children?.[i];
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setActive(i);
  };
  const onRailScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = [...rail.children];
    const mid = rail.scrollLeft + rail.clientWidth / 2;
    let best = 0;
    cards.forEach((c, i) => { if (Math.abs(c.offsetLeft + c.clientWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].clientWidth / 2 - mid)) best = i; });
    if (best !== active) setActive(best);
  };

  const chosen = v.offers.find((o) => o.id === v.chosen_offer_id);
  const closed = ['escolhido', 'cancelado', 'expirado'].includes(v.status);
  const sel = v.offers.find((o) => o.id === offerId);
  const pick = (o) => { setOfferId(o.id); setPayId(o.payment_options?.[0]?.id || ''); setErr(null); setName((x) => x || v.client?.name || ''); setTimeout(() => document.getElementById('escolha')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const problems = sel ? [
    sel.payment_options?.length > 0 && !payId && { text: 'Escolha a forma de pagamento.', field: 'Forma de pagamento' },
    name.trim().length < 3 && { text: 'Informe seu nome completo.', field: 'Seu nome completo' },
    !agree && { text: 'Marque a autorização para a corretora enviar a proposta.', field: '#autorizo' },
  ].filter(Boolean) : [];
  const submit = async (e) => {
    e?.preventDefault?.();
    if (problems.length || sending) return;
    setSending(true); setErr(null);
    try {
      const r = await pub(`/comparativo/${token}/choose`, { offer_id: offerId, payment_option: payId || null, name: name.trim(), authorize: true });
      setMsg(r.message); reload();
    } catch (x) { setErr(x.message); } finally { setSending(false); }
  };

  return (
    <Shell broker={v.broker} title={`Comparativo ${v.number}`}>
      <div className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Comparativo {v.number} · {fmt(v.created_at)}</p>
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Olá, {v.client?.name?.split(' ')[0]}! Compare as opções do seu seguro</h1>
        <p className="mt-1 text-sm text-ink-soft">{v.branch}{v.period?.start ? ` · vigência pretendida de ${fmt(v.period.start)} a ${fmt(v.period.end)}` : ''}</p>
      </div>
      {v.message && <div className="card mb-5 whitespace-pre-line p-4 text-sm">{v.message}</div>}

      {(msg || chosen) && (
        <div className="card mb-5 border-emerald-500/40 p-4 sm:p-5">
          <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300"><Check className="h-5 w-5" />Escolha registrada</p>
          {chosen && <p className="mt-1 text-sm">{chosen.institution_name} — {chosen.product_name}{(() => { const p = chosen.payment_options?.find((x) => x.id === v.chosen_payment_option); return p ? ` · ${PAY_METHOD[p.method] || p.method} ${p.installments}x (total ${money(p.total_cents)})` : ''; })()}{v.chosen_at ? ` · ${fmtDateTime(v.chosen_at)}` : ''}</p>}
          <p className="mt-2 text-sm text-ink-soft">{msg || 'A corretora vai preparar a proposta e enviar à seguradora. A contratação só vale depois da aceitação da seguradora.'}</p>
        </div>
      )}

      {v.min_coverages?.length > 0 && (
        <div className="mb-4 text-sm"><span className="font-medium">Você pediu: </span>
          <span className="text-ink-soft">{v.min_coverages.map((m) => `${m.name}${m.required === false ? ' (desejável)' : ''}${m.min_limit_cents != null ? ` — mínimo ${money(m.min_limit_cents)}` : ''}`).join('; ')}</span></div>
      )}

      {v.offers.length > 1 && (
        <div className="mb-3 sm:hidden">
          <p className="mb-2 text-sm font-medium">{v.offers.length} opções — toque para ver ou deslize os cartões</p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Opções do comparativo">
            {v.offers.map((o, i) => (
              <button key={o.id} type="button" role="tab" aria-selected={active === i} onClick={() => goTo(i)}
                className={cx('shrink-0 rounded-app-sm border px-3 py-2 text-left text-xs', active === i ? 'border-primary bg-primary/5' : 'border-line bg-surface')}>
                <span className="block font-medium">Opção {i + 1} · {o.institution_name}</span>
                <span className="block tabular-nums text-ink-soft">{money(o.total_premium_cents)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={railRef} onScroll={onRailScroll} className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {v.offers.map((o, i) => (
          <OfferCard key={o.id} o={o} index={i} total={v.offers.length} v={v} selected={offerId === o.id} chosen={v.chosen_offer_id === o.id}
            canPick={!closed && !o.expired && !indicative(o)} waiting={!closed && !o.expired && indicative(o)} broker={v.broker} onPick={() => pick(o)} />
        ))}
      </div>
      {v.offers.length > 1 && (
        <div className="mt-1 flex items-center justify-center gap-3 sm:hidden" aria-hidden>
          {v.offers.map((o, i) => <span key={o.id} className={cx('h-2 rounded-full transition-all', active === i ? 'w-5 bg-primary' : 'w-2 bg-line')} />)}
          {active < v.offers.length - 1 && <button type="button" tabIndex={-1} className="ml-1 inline-flex items-center text-xs text-primary" onClick={() => goTo(active + 1)}>próxima <ChevronRight className="h-3.5 w-3.5" /></button>}
        </div>
      )}

      {!closed && !msg && (
        <form id="escolha" onSubmit={submit} className="card mt-6 scroll-mt-4 p-4 sm:p-5">
          <h2 className="text-base font-semibold">Registrar sua escolha</h2>
          {!sel ? (v.offers.some((o) => !o.expired && !indicative(o))
            ? <p className="mt-2 text-sm text-ink-soft">Toque em <b>“Escolher esta opção”</b> em uma das opções acima.</p>
            : <p className="mt-2 text-sm text-ink-soft">Ainda não há opção disponível para escolha: as seguradoras precisam confirmar os preços. A corretora vai avisar você.</p>) : (
            <div className="mt-3 space-y-4">
              <div className="rounded-app-sm bg-muted px-3 py-2.5 text-sm"><b>{sel.institution_name}</b> — {sel.product_name} · preço total (prêmio) {money(sel.total_premium_cents)}</div>
              {sel.payment_options?.length > 0 && (
                <fieldset>
                  <legend className="label">Forma de pagamento</legend>
                  <div className="space-y-2">
                    {sel.payment_options.map((p) => (
                      <label key={p.id} className={cx('flex cursor-pointer items-start gap-3 rounded-app-sm border px-3 py-2.5', payId === p.id ? 'border-primary bg-primary/5' : 'border-line')}>
                        <input type="radio" name="pay" className="mt-1 accent-[rgb(var(--primary))]" checked={payId === p.id} onChange={() => setPayId(p.id)} />
                        <span className="text-sm"><b>{PAY_METHOD[p.method] || p.method} {p.installments}x</b>
                          {p.installments > 1 && p.installment_cents ? ` de ${money(p.installment_cents)}` : ''}
                          <span className="block text-ink-soft">Total: {money(p.total_cents)}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <Input label="Seu nome completo" minLength={3} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input id="autorizo" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--primary))]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>Autorizo a corretora a enviar esta proposta à seguradora, com as coberturas, a vigência e a forma de pagamento acima. Entendo que a contratação só vale depois da aceitação da seguradora.</span>
              </label>
              {err && <Notice tone="danger">{err}</Notice>}
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton className="btn-primary w-full sm:w-auto" busy={sending} problems={problems} onClick={() => submit()}>{sending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}Confirmar escolha</SubmitButton>
              </div>
            </div>
          )}
        </form>
      )}
      {v.status === 'expirado' && <Notice tone="warn" className="mt-4">Este comparativo expirou. Fale com a corretora para receber valores atualizados.</Notice>}

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">{v.notice} Campos “não informado” não foram fornecidos pela seguradora.</p>
    </Shell>
  );
}

function OfferCard({ o, index, total, v, selected, chosen, canPick, waiting, broker, onPick }) {
  const wa = waLink(broker?.phone, `Olá! Sobre o comparativo ${v.number}: gostaria de saber quando a opção ${index + 1} (${o.institution_name}) estará confirmada.`);
  return (
    <article aria-label={`Opção ${index + 1} de ${total}`} className={cx('card flex w-[85vw] max-w-sm shrink-0 snap-center flex-col p-4 sm:w-auto sm:max-w-none', (selected || chosen) && 'ring-2 ring-primary', o.expired && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Opção {index + 1} de {total}</p>
          <h2 className="font-semibold">{o.institution_name}</h2>
          <p className="text-sm text-ink-soft">{o.product_name}</p>
        </div>
        <span className="inline-flex shrink-0 items-center"><StatusChip map={QUOTE_KIND} value={o.quote_kind} /><T k={o.quote_kind === 'cotacao_valida' ? 'cotacao_valida' : 'valor_indicativo'} /></span>
      </div>
      <OfferBadges id={o.id} badges={v.badges} className="mt-2" />
      <div className="mt-3">
        <p className="flex items-center text-xs text-ink-faint">Preço total do seguro (prêmio)<T k="premio" /></p>
        <p className="text-2xl font-semibold tabular-nums">{money(o.total_premium_cents)}</p>
        {o.premium_net_cents == null && o.taxes_cents == null
          ? <p className="flex flex-wrap items-center text-xs text-ink-faint">Impostos (IOF) incluídos; detalhe não informado pela seguradora<T k="iof" /></p>
          : <p className="flex flex-wrap items-center text-xs text-ink-faint">Sem impostos {moneyOrNA(o.premium_net_cents)}<T k="premio_liquido" /> · IOF {moneyOrNA(o.taxes_cents)}<T k="iof" /></p>}
      </div>
      <p className={cx('mt-2 flex items-center gap-1 text-xs', o.expired ? 'font-medium text-red-600' : 'text-ink-soft')}>
        <Clock className="h-3.5 w-3.5" />{o.valid_until ? `Preço válido até ${fmt(o.valid_until)}` : 'Validade não informada'}{o.expired && ' — vencida'}<T k="validade" />
      </p>
      {o.quote_kind === 'valor_indicativo' && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Valor indicativo: a seguradora ainda precisa confirmar o preço.</p>}

      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1.5 flex items-center text-xs font-semibold uppercase tracking-wide text-ink-faint">Coberturas<T k="cobertura" /></p>
        <ul className="space-y-1.5 text-sm">
          {(v.min_coverages || []).map((m) => {
            const c = (o.coverages || []).find((x) => x.code === m.code);
            return (
              <li key={m.code} className="flex gap-2">
                {c ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Incluída" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-label="Não incluída" />}
                <span><span className={cx(!c && 'text-red-600')}>{m.name}</span>{COVERAGE_TERMS[m.code] && <Hint label={m.name}>{COVERAGE_TERMS[m.code]}</Hint>}
                  {c ? <span className="block text-xs text-ink-faint">Limite {c.limit_cents == null ? 'não informado' : money(c.limit_cents)} · Franquia: {deductible(c)}</span>
                    : <span className="block text-xs text-red-600">Não incluída</span>}</span>
              </li>
            );
          })}
          {(o.coverages || []).filter((c) => !(v.min_coverages || []).some((m) => m.code === c.code)).map((c) => (
            <li key={c.code} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{c.name}{COVERAGE_TERMS[c.code] && <Hint label={c.name}>{COVERAGE_TERMS[c.code]}</Hint>}<span className="block text-xs text-ink-faint">Limite {c.limit_cents == null ? 'não informado' : money(c.limit_cents)}</span></span></li>
          ))}
        </ul>
      </div>
      {o.assistances?.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1 flex items-center text-xs font-semibold uppercase tracking-wide text-ink-faint">Assistências<T k="assistencia" /></p>
          <p className="text-sm">{o.assistances.map((a) => a.name || a.code).join(' · ')}</p>
        </div>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Pagamento</p>
        <PaymentOptions options={o.payment_options} chosen={chosen ? v.chosen_payment_option : null} compact />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <span className="inline-flex items-center"><StatusChip map={CLASSIFICATION} value={o.classification} /><T k="classificacao" /></span>
        {o.issues?.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">{o.issues.map((x, i) => <li key={i} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />{x}</li>)}</ul>}
        {(o.requirements || o.conditions) && <p className="mt-1.5 text-xs text-ink-soft">{o.requirements && <><b>Exigências:</b> {o.requirements} </>}{o.conditions && <><b>Condições:</b> {o.conditions}</>}</p>}
      </div>
      <div className="mt-auto pt-4">
        {chosen ? <span className="chip bg-primary text-primary-fg"><Check className="h-3 w-3" />Sua escolha</span>
          : canPick ? <button type="button" className={selected ? 'btn-primary w-full' : 'btn-outline w-full'} onClick={onPick}>{selected ? <><Check className="h-4 w-4" />Selecionada</> : 'Escolher esta opção'}</button>
            : waiting ? (
              <div className="rounded-app-sm border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
                <b className="block">Aguardando confirmação da seguradora</b>
                Esta opção ainda não pode ser escolhida. A corretora avisa você quando o preço for confirmado.
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-primary underline"><MessageCircle className="h-3.5 w-3.5" />Perguntar à corretora</a>}
              </div>
            ) : o.expired ? <p className="text-xs text-red-600">Preço vencido: peça à corretora valores atualizados.</p> : null}
      </div>
    </article>
  );
}

// ================= Parcelas =================
const CAN_REPORT = ['prevista', 'aberta', 'proxima_vencimento', 'vencida', 'parcial', 'em_divergencia'];
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const SRC = { manual: 'registrada pela corretora', seguradora: 'informada pela seguradora', fornecedor: 'informada pela seguradora', importacao: 'importada de arquivo da seguradora', cliente: 'informada pelo cliente' };

export function PublicInstallments() {
  const { token } = useParams();
  const { loading, data, error, reload } = usePublic(`/parcelas/${token}`);
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState(null);
  if (loading) return <Loader />;
  if (error) return <ErrorScreen error={error} />;
  const { policy, broker, installments } = data;
  return (
    <Shell broker={broker} title="Parcelas do seguro">
      <h1 className="text-xl font-semibold sm:text-2xl">Parcelas do seu seguro</h1>
      <div className="card mt-3 grid gap-3 p-4 text-sm sm:grid-cols-4">
        <div><span className="block text-xs text-ink-faint">Segurado</span>{policy.client}</div>
        <div><span className="block text-xs text-ink-faint">Seguradora</span>{policy.institution}</div>
        <div><span className="block text-xs text-ink-faint">Apólice</span>{policy.policy_number || '—'}</div>
        <div><span className="block text-xs text-ink-faint">Vigência</span>{fmt(policy.start_date)} a {fmt(policy.end_date)}</div>
        {policy.assistance_phone && <div className="sm:col-span-4"><a className="inline-flex items-center gap-1.5 text-primary" href={`tel:${policy.assistance_phone.replace(/\D/g, '')}`}><Phone className="h-4 w-4" />Assistência da seguradora: {policy.assistance_phone}</a></div>}
      </div>
      <Notice className="mt-4">{data.notice}</Notice>
      {done && <Notice tone="ok" className="mt-4">{done}</Notice>}

      <ul className="mt-4 space-y-3">
        {installments.map((x) => (
          <li key={x.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Parcela {x.number}{x.total_count ? `/${x.total_count}` : ''}</p>
                <p className="text-sm text-ink-soft">Vencimento {fmt(x.due_date)}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums">{money(x.amount_cents)}</p>
                {x.balance_cents != null && x.balance_cents !== x.amount_cents && <p className="text-xs text-ink-faint">Em aberto: {money(x.balance_cents)}</p>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip map={INSTALLMENT_STATUS} value={x.status} />
              <span className="text-xs text-ink-faint">{x.last_update_at ? `Atualizado em ${fmtDateTime(x.last_update_at)}` : 'Sem atualização'}{x.source ? ` · ${SRC[x.source] || x.source}` : ''}</span>
            </div>
            {x.status === 'pagamento_informado' && <p className="mt-2 text-xs text-ink-soft">Recebemos o comprovante. O pagamento fica em conferência até a confirmação da seguradora.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {x.charge_url && isHttps(x.charge_url) && CAN_REPORT.includes(x.status) && (
                <a href={x.charge_url} target="_blank" rel="noopener noreferrer" className="btn-primary"><ExternalLink className="h-4 w-4" />Pagar pelo link oficial</a>
              )}
              {CAN_REPORT.includes(x.status) && open !== x.id && <button className="btn-outline" onClick={() => { setOpen(x.id); setDone(null); }}><Upload className="h-4 w-4" />Enviar comprovante</button>}
            </div>
            {open === x.id && <ReceiptForm token={token} inst={x} onCancel={() => setOpen(null)} onDone={(m) => { setOpen(null); setDone(m); reload(); }} />}
          </li>
        ))}
        {!installments.length && <li className="card p-6 text-center text-sm text-ink-faint">Nenhuma parcela registrada para esta apólice.</li>}
      </ul>
      {broker?.phone && <p className="mt-6 text-center text-sm text-ink-soft">Dúvidas? Fale com {broker.name}: <a className="text-primary" href={`tel:${broker.phone.replace(/\D/g, '')}`}>{broker.phone}</a></p>}
    </Shell>
  );
}

function ReceiptForm({ token, inst, onCancel, onDone }) {
  const [file, setFile] = useState(null);
  const [amount, setAmount] = useState(inst.balance_cents ?? inst.amount_cents ?? null);
  const [date, setDate] = useState(ymd());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const payload = await fileToPayload(file);
      const r = await pub(`/parcelas/${token}/comprovante`, { installment_id: inst.id, amount_cents: amount, paid_date: date, ...payload });
      onDone(r.message);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-app-sm border border-line bg-muted/50 p-3">
      <div>
        <span className="label">Comprovante (PDF ou foto, até 8 MB)</span>
        <label className="btn-outline cursor-pointer">
          <FileUp className="h-4 w-4" />{file ? 'Trocar arquivo' : 'Escolher arquivo'}
          <input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} />
        </label>
        {file && <span className="ml-2 inline-flex items-center gap-1 text-sm"><FileText className="h-4 w-4 text-ink-faint" />{file.name}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CentsInput label="Valor pago" value={amount} onChange={setAmount} />
        <Input label="Data do pagamento" type="date" max={ymd()} value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      <p className="text-xs text-ink-faint">O envio não confirma o pagamento: ele fica em conferência até a confirmação da seguradora.</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={busy} onClick={(e) => e.currentTarget.form?.requestSubmit()} problems={[!file && { text: 'Anexe o comprovante (PDF ou foto).' }, !amount && { text: 'Informe o valor pago.', field: 'Valor pago' }, !date && { text: 'Informe a data do pagamento.', field: 'Data do pagamento' }]}>{busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}Enviar comprovante</SubmitButton>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

// ================= Documento =================
export function PublicDocument() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  const fetchDoc = async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${apiBase}/public/documento/${token}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new PubError(res.status, d.error || 'Não foi possível baixar o documento.'); }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/);
      const name = m ? decodeURIComponent(m[1] || m[2]) : 'documento';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setState({ status: 'ok', name, url });
    } catch (e) { setState({ status: 'error', error: e instanceof PubError ? e : new PubError(0, e.message) }); }
  };
  useEffect(() => { fetchDoc(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (state.url) URL.revokeObjectURL(state.url); }, [state.url]);
  if (state.status === 'loading') return <StateScreen icon={Loader2} tone="animate-spin text-ink-faint" title="Preparando seu documento…" text="O download começa automaticamente." />;
  if (state.status === 'error') return <ErrorScreen error={state.error} />;
  return (
    <Shell title="Documento">
      <div className="card mx-auto max-w-md px-6 py-10 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-emerald-500" />
        <h1 className="mt-4 text-lg font-semibold">Download iniciado</h1>
        <p className="mt-2 break-words text-sm text-ink-soft">{state.name}</p>
        <p className="mt-2 text-xs text-ink-faint">Se o download não começou, use o botão abaixo. Guarde o arquivo em local seguro: este link é temporário.</p>
        <a href={state.url} download={state.name} className="btn-primary mt-5"><Download className="h-4 w-4" />Baixar novamente</a>
      </div>
    </Shell>
  );
}

export default PublicComparison;

