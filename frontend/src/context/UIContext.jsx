import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

const Ctx = createContext(null);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirm] = useState(null);
  const id = useRef(0);

  const toast = useCallback((message, type = 'success') => {
    const t = { id: ++id.current, message, type };
    setToasts((l) => [...l, t]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== t.id)), 4000);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirm({ title: 'Tem certeza?', confirmText: 'Confirmar', danger: true, ...(typeof opts === 'string' ? { message: opts } : opts), resolve });
  }), []);

  const close = (v) => { confirmState?.resolve(v); setConfirm(null); };
  // Esc fecha a confirmação (equivale a "Voltar")
  useEffect(() => {
    if (!confirmState) return undefined;
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); confirmState.resolve(false); setConfirm(null); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [confirmState]);

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div aria-live="polite" className="fixed bottom-20 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2 lg:bottom-auto lg:top-16">
        {toasts.map((t) => (
          <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'} className="card animate-pop flex items-start gap-3 p-3.5 text-sm">
            {t.type === 'error'
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} className="text-ink-faint hover:text-ink" aria-label="Fechar aviso">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4 animate-fade" onClick={() => close(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="ui-confirm-t" aria-describedby={confirmState.message ? 'ui-confirm-m' : undefined}
            className="card animate-pop w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 id="ui-confirm-t" className="text-base font-semibold">{confirmState.title}</h3>
            {confirmState.message && <p id="ui-confirm-m" className="mt-1.5 text-sm text-ink-soft">{confirmState.message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => close(false)}>Voltar</button>
              <button autoFocus className={confirmState.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>
                {confirmState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useUI = () => useContext(Ctx);
