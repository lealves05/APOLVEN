// Apólice › Versão impressa: o modelo da corretora preenchido com os dados reais, em folhas de papel, pronto para imprimir/PDF.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, FileDown, Settings2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Loading, Notice, Empty } from './ui';
import { buildPrintData } from '../lib/printFields';
import { DEFAULT_TEMPLATE } from '../lib/defaultTemplate';
import PrintSheets from './PrintSheets';

const SOURCE = { ramo: 'modelo próprio deste ramo', padrao: 'modelo padrão da corretora', fabrica: 'modelo de fábrica do APOLVEN' };

export default function PolicyPrintTab({ p }) {
  const { can } = useAuth();
  const { toast } = useUI();
  const [state, setState] = useState({ loading: true });
  const [pages, setPages] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/v1/policies/${p.id}/print-data`),
      api.get(`/v1/print-templates/policy?branch=${encodeURIComponent(p.branch || '')}`),
      api.get('/v1/company/logo').catch(() => ({ data_url: null })),
    ]).then(([raw, t, logo]) => {
      if (!alive) return;
      const tpl = t.template ? { doc: t.template.doc, header: t.template.header, footer: t.template.footer, page: t.template.page } : DEFAULT_TEMPLATE;
      setState({ loading: false, raw, tpl, source: t.source, logo: logo.data_url });
    }).catch((e) => alive && setState({ loading: false, error: e.message }));
    return () => { alive = false; };
  }, [p.id, p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => (state.raw ? buildPrintData(state.raw, { logo: state.logo, today: state.raw.today }) : null), [state.raw, state.logo]);

  if (state.loading) return <Loading />;
  if (state.error) return <div className="card"><Empty icon={AlertTriangle} title="Não foi possível montar a versão impressa" text={state.error} /></div>;
  const print = (pdf) => {
    if (pdf) toast('Na janela de impressão, escolha “Salvar como PDF” em Destino.');
    setTimeout(() => window.print(), pdf ? 400 : 0);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={() => print(false)}><Printer className="h-4 w-4" />Imprimir</button>
        <button type="button" className="btn-outline" onClick={() => print(true)}><FileDown className="h-4 w-4" />Salvar PDF</button>
        <span className="text-xs text-ink-faint">{pages ? `${pages} página(s)` : ''} · usando o {SOURCE[state.source] || SOURCE.fabrica}</span>
        {can('settings') && <Link to="/configuracoes?tab=aparencia&sec=impressao" className="btn-ghost ml-auto h-9 text-xs"><Settings2 className="h-4 w-4" />Editar modelo</Link>}
      </div>
      {!state.logo && <Notice tone="info">Sem logotipo cadastrado: o espaço dele fica em branco. {can('settings') && <Link to="/configuracoes?tab=aparencia&sec=logo" className="font-medium underline">Enviar logotipo</Link>}</Notice>}
      <div className="rounded-app-sm bg-zinc-200/70 p-2 sm:p-4 dark:bg-zinc-800">
        <PrintSheets template={state.tpl} data={data} printable onPages={setPages} />
      </div>
    </div>
  );
}
