import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Inbox } from 'lucide-react';
import { useUI } from '../context/UIContext';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

// evita alternar entre campo controlado/não controlado quando o valor ainda não carregou
const ctl = (p) => ('value' in p ? { ...p, value: p.value ?? '' } : p);

export const Input = ({ label, hint, className, ...p }) => (
  <Field label={label} hint={hint} className={className}><input className="input" {...ctl(p)} /></Field>
);

export const Textarea = ({ label, hint, className, rows = 3, ...p }) => (
  <Field label={label} hint={hint} className={className}><textarea className="input" rows={rows} {...ctl(p)} /></Field>
);

export const Select = ({ label, hint, className, children, ...p }) => (
  <Field label={label} hint={hint} className={className}><select className="input pr-8" {...p}>{children}</select></Field>
);

/** Campo monetário que aceita vírgula. */
export function MoneyInput({ label, value, onChange, className, ...p }) {
  const [text, setText] = useState(value === '' || value == null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const cur = parseFloat(text.replace(/\./g, '').replace(',', '.'));
    if (Number(value) !== cur) setText(value === '' || value == null ? '' : String(value).replace('.', ','));
  }, [value]); // eslint-disable-line
  return (
    <Field label={label} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">R$</span>
        <input className="input pl-9 tabular-nums" inputMode="decimal" value={text} {...p}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d,.]/g, '');
            setText(t);
            const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
            onChange(Number.isFinite(n) ? n : 0);
          }} />
      </div>
    </Field>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-primary' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

// Pilha de modais abertos: só o do topo responde a Esc/Tab.
const modalStack = [];
let modalSeq = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal acessível (role="dialog", foco preso, Esc).
 * - Formulário alterado: Esc, clique fora ou X pedem confirmação antes de descartar.
 * - Tamanhos lg/xl (formulários longos) não fecham com clique fora.
 * - guard={false} desliga a confirmação (modais só de leitura/filtros).
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', guard = true }) {
  const [id] = useState(() => `modal-${++modalSeq}`);
  const boxRef = useRef(null);
  const dirtyRef = useRef(false);
  const [asking, setAsking] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const requestClose = useCallback(() => {
    if (guard && dirtyRef.current) { setAsking(true); return; }
    closeRef.current?.();
  }, [guard]);

  useEffect(() => {
    if (!open) return undefined;
    dirtyRef.current = false;
    setAsking(false);
    modalStack.push(id);
    const prev = document.activeElement;
    const box = boxRef.current;
    // foco inicial: primeiro campo do corpo; senão o próprio diálogo
    const t = setTimeout(() => {
      const first = box?.querySelector(`[data-modal-body] :is(${FOCUSABLE})`);
      (first || box)?.focus({ preventScroll: true });
    }, 30);
    const markDirty = (e) => { if (!e.target?.closest?.('[data-no-dirty]') && !e.target?.readOnly) dirtyRef.current = true; };
    box?.addEventListener('input', markDirty, true);
    box?.addEventListener('change', markDirty, true);
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose(); return; }
      if (e.key === 'Tab' && box) {
        const els = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!els.length) { e.preventDefault(); box.focus(); return; }
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === firstEl || !box.contains(document.activeElement))) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && (document.activeElement === lastEl || !box.contains(document.activeElement))) { e.preventDefault(); firstEl.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      box?.removeEventListener('input', markDirty, true);
      box?.removeEventListener('change', markDirty, true);
      const i = modalStack.lastIndexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open, id, requestClose]);

  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  const backdropCloses = size === 'sm' || size === 'md';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 animate-fade"
      onMouseDown={(e) => { if (e.target === e.currentTarget && backdropCloses) requestClose(); }}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={subtitle ? `${id}-s` : undefined} tabIndex={-1}
        className={cx('card animate-pop relative flex max-h-[94vh] w-full flex-col rounded-b-none outline-none sm:rounded-b-app', w)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-t`} className="text-base font-semibold">{title}</h2>
            {subtitle && <p id={`${id}-s`} className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={requestClose} className="btn-ghost btn-icon -mr-2 -mt-1" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        <div data-modal-body className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        {asking && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-black/30 p-4">
            <div role="alertdialog" aria-modal="true" aria-labelledby={`${id}-d`} className="card w-full max-w-sm p-5 shadow-lg">
              <h3 id={`${id}-d`} className="text-base font-semibold">Descartar o que foi preenchido?</h3>
              <p className="mt-1.5 text-sm text-ink-soft">As informações digitadas neste formulário ainda não foram salvas.</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" autoFocus className="btn-primary" onClick={() => setAsking(false)}>Continuar preenchendo</button>
                <button type="button" className="btn-ghost text-red-600" onClick={() => { setAsking(false); dirtyRef.current = false; closeRef.current?.(); }}>Descartar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Normaliza pendências: string ou { text, field } (field = rótulo do campo ou seletor CSS). */
const asProblem = (p) => (typeof p === 'string' ? { text: p } : p);

/** Leva o usuário ao campo da pendência: procura pelo rótulo (texto) ou seletor, rola e foca. */
export function focusField(field, scope) {
  if (!field || typeof document === 'undefined') return false;
  const root = scope || document;
  let el = null;
  if (/^[#.[]/.test(field)) el = root.querySelector(field);
  if (!el) {
    const want = field.toLowerCase();
    const labels = [...root.querySelectorAll('.label, label, legend, h3')];
    const lab = labels.find((l) => l.textContent.trim().toLowerCase().replace(/\s*\*$/, '').startsWith(want));
    if (lab) el = lab.closest('label')?.querySelector('input,select,textarea,button') || lab.parentElement?.querySelector('input,select,textarea,button') || lab;
  }
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  setTimeout(() => el.focus?.({ preventScroll: true }), 250);
  return true;
}

/**
 * Botão de envio que nunca fica "mudo": com pendências, ao clicar lista tudo o que falta
 * e leva ao primeiro campo. problems: [string | { text, field }].
 */
export function SubmitButton({ problems = [], onClick, busy, className = 'btn-primary', children, disabled, ...p }) {
  const [shown, setShown] = useState(false);
  const [probId] = useState(() => `prob-${++modalSeq}`);
  const ref = useRef(null);
  const list = problems.filter(Boolean).map(asProblem);
  useEffect(() => { if (!list.length) setShown(false); }, [list.length]);
  const click = (e) => {
    if (busy) return;
    if (list.length) {
      setShown(true);
      const scope = ref.current?.closest('[role="dialog"]') || ref.current?.closest('form') || document;
      const firstWithField = list.find((x) => x.field);
      if (firstWithField) focusField(firstWithField.field, scope);
      return;
    }
    onClick?.(e);
  };
  return (
    <>
      {shown && list.length > 0 && (
        <div id={probId} role="alert" className="order-first mr-auto w-full rounded-app-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 sm:w-auto sm:max-w-[60%]">
          <b className="block">Falta {list.length === 1 ? '1 item' : `${list.length} itens`} para continuar:</b>
          <ul className="mt-1 space-y-0.5">
            {list.map((x, i) => (
              <li key={i} className="flex gap-1.5"><span aria-hidden>•</span>{x.field
                ? <button type="button" className="inline text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    onClick={() => focusField(x.field, ref.current?.closest('[role="dialog"]') || document)}>{x.text}</button>
                : <span>{x.text}</span>}</li>
            ))}
          </ul>
        </div>
      )}
      <button ref={ref} type="button" className={className} aria-describedby={shown && list.length ? probId : undefined}
        disabled={disabled || busy} onClick={click} {...p}>{children}</button>
    </>
  );
}

/** Dica em linguagem simples: botão "?" que abre uma explicação curta (toque ou clique). */
export function Hint({ label, children, className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <span ref={ref} className={cx('relative inline-flex align-middle', className)}>
      <button type="button" aria-label={`O que é ${label}?`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="hint-btn ml-1 inline-grid h-[18px] w-[18px] place-items-center rounded-full border border-current text-[10px] font-bold leading-none text-ink-faint hover:text-primary">?</button>
      {open && (
        <span role="note" className="absolute left-1/2 top-full z-40 mt-1.5 w-64 max-w-[80vw] -translate-x-1/2 rounded-app-sm border border-line bg-surface p-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-lg">
          <b className="mb-0.5 block">{label}</b>{children}
        </span>
      )}
    </span>
  );
}

export const Spinner = ({ className = 'h-5 w-5' }) => <Loader2 className={cx('animate-spin text-ink-faint', className)} />;

export const Loading = () => <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>;

export function Empty({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-ink-faint"><Icon className="h-5 w-5" /></div>
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-faint">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-app-sm bg-muted p-1 w-fit max-w-full">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('tab-btn whitespace-nowrap rounded-[calc(var(--radius)*0.45)] px-3 py-1.5 text-sm font-medium transition',
            value === t.value ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-faint">{label}</span>
        {Icon && <Icon className={cx('h-4 w-4', tone || 'text-ink-faint')} />}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

export function Avatar({ name, color, size = 'h-8 w-8', src }) {
  if (src) return <img src={src} alt="" className={cx(size, 'rounded-full object-cover')} />;
  const ini = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <span className={cx(size, 'inline-grid shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white')}
      style={{ background: color || 'rgb(var(--primary))' }}>{ini}</span>
  );
}

/** Carrega dados com estado de loading/erro e toast automático. */
export function useFetch(fn, deps = []) {
  const { toast } = useUI();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, loading, reload };
}

export const FAIL = Symbol('fail');

/**
 * Executa ação assíncrona com toast. Retorna o resultado ou FAIL.
 * onError(e) pode retornar true para suprimir o toast de erro.
 */
export function useAction() {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success, onError) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      const handled = onError ? await onError(e) : false;
      if (!handled) toast(e.message, 'error');
      return FAIL;
    } finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

// ---------------- Componentes do APOLVEN ----------------

/** Campo monetário em CENTAVOS (a API trabalha com centavos inteiros). Vazio = null (não informado). */
export function CentsInput({ label, value, onChange, className, hint, allowEmpty = true, ...p }) {
  const show = (c) => (c === null || c === undefined || c === '' ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const cur = text === '' ? null : Math.round(parseFloat(text.replace(/\./g, '').replace(',', '.')) * 100);
    if ((value ?? null) !== (Number.isFinite(cur) ? cur : null)) setText(show(value));
  }, [value]); // eslint-disable-line
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">R$</span>
        <input className="input pl-9 tabular-nums" inputMode="decimal" value={text} placeholder={allowEmpty ? 'não informado' : '0,00'} {...p}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d,.]/g, '');
            setText(t);
            if (t === '') { onChange(allowEmpty ? null : 0); return; }
            const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
            onChange(Number.isFinite(n) ? Math.round(n * 100) : null);
          }} />
      </div>
    </Field>
  );
}

/** Etiqueta de estado a partir de um dicionário { chave: { label, cls } }. */
export function StatusChip({ map, value, className }) {
  const s = map?.[value];
  return <span className={cx('chip', s?.cls || 'bg-muted text-ink-soft', className)}>{s?.label || value || '—'}</span>;
}

export function Section({ title, subtitle, actions, children, className, bodyClass }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div><h2 className="text-sm font-semibold">{title}</h2>{subtitle && <p className="text-xs text-ink-faint">{subtitle}</p>}</div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

/** Lista de pares rótulo/valor. */
export function KV({ items, cols = 2 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3 text-sm', cols === 3 ? 'sm:grid-cols-3' : cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2')}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0"><dt className="text-xs text-ink-faint">{k}</dt><dd className="mt-0.5 break-words">{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

/** Aviso destacado (informativo/atenção/erro). */
export function Notice({ tone = 'info', children, className }) {
  const cls = { info: 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100', warn: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    danger: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200', ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100' }[tone];
  return <div role="status" className={cx('rounded-app-sm border px-3.5 py-2.5 text-sm', cls, className)}>{children}</div>;
}

/**
 * Modal que pede um texto (motivo, evidência, protocolo) antes de uma ação sensível.
 * fields: [{ key, label, required, textarea, type, placeholder }]
 */
export function PromptModal({ open, title, subtitle, fields = [{ key: 'reason', label: 'Motivo', required: true, textarea: true }], confirmText = 'Confirmar', danger, onClose, onSubmit }) {
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV({}); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton className={danger ? 'btn-danger' : 'btn-primary'} busy={busy}
          problems={fields.filter((f) => f.required && String(v[f.key] || '').trim().length < (f.min || 3)).map((f) => ({ text: `Preencha “${f.label}” (mín. ${f.min || 3} caracteres).`, field: f.label }))}
          onClick={async () => { setBusy(true); try { await onSubmit(v); } finally { setBusy(false); } }}>{confirmText}</SubmitButton></>}>
      <div className="space-y-3">
        {fields.map((f) => (f.textarea
          ? <Textarea key={f.key} label={f.label} rows={3} value={v[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
          : <Input key={f.key} label={f.label} type={f.type || 'text'} value={v[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />))}
      </div>
    </Modal>
  );
}

/** Botão de arquivo (abre o seletor e entrega o File). */
export function FileButton({ children, accept, onFile, className = 'btn-outline', disabled }) {
  return (
    <label className={cx(className, 'cursor-pointer', disabled && 'pointer-events-none opacity-50')}>
      {children}
      <input type="file" className="hidden" accept={accept} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </label>
  );
}
