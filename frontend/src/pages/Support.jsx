// Suporte e treinamento: vídeo-aulas narradas e legendadas (com transcrição), perguntas frequentes, como o sistema
// funciona, atalhos e contato com o suporte.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LifeBuoy, Keyboard, Workflow, Bot, Hand, Info, MessageCircle, Mail, CheckCircle2, Clock, PlayCircle, Search, Captions, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Section, Notice, cx } from '../components/ui';
import { LESSONS, MODULES, fmtDur, posterUrl, thumbUrl, videoUrl, captionsUrl, TOTAL_SECONDS } from '../lib/training';
import { waLink } from '../lib/format';
import pkg from '../../package.json';

const FLOW = [
  ['Cliente e oportunidade', 'Cadastre ou encontre o cliente e abra a oportunidade.', '/clientes'],
  ['Dados do risco', 'Preencha o formulário do ramo com a necessidade do cliente.', '/cotacoes/nova'],
  ['Validação', 'Confira dados, compartilhamento e destinatários da pesquisa.'],
  ['Consulta às fontes', 'Seguradoras elegíveis são consultadas; acompanhe os retornos parciais.', '/cotacoes'],
  ['Comparação', 'Compare as propostas tecnicamente adequadas (requisitos mínimos primeiro).'],
  ['Envio do comparativo', 'Revise e envie ao cliente pelo link ou WhatsApp.'],
  ['Escolha e autorização', 'O cliente escolhe e autoriza uma versão específica.'],
  ['Transmissão', 'Transmita e acompanhe recepção, análise e aceite — etapas distintas.', '/propostas'],
  ['Documento emitido', 'Receba e confira a apólice ou certificado.', '/apolices'],
  ['Parcelas do seguro', 'Acompanhe as parcelas pagas à seguradora.', '/parcelas'],
  ['Comissão', 'Registre a comissão prevista/confirmada e concilie os recebimentos.', '/comissoes'],
  ['Repasses', 'Libere e pague repasses conforme acordo e aprovação.', '/repasses'],
  ['Pós-venda e renovação', 'Disponibilize a documentação e inicie o pós-venda e a renovação.', '/renovacoes'],
];

const SHORTCUTS = [
  ['Ctrl + K (⌘ + K no Mac)', 'Busca global'],
  ['/', 'Abrir a busca (fora de campos de texto)'],
  ['Alt + C', 'Nova cotação'],
  ['Alt + N', 'Novo cliente'],
  ['Alt + S', 'Nova solicitação de pós-venda'],
  ['Esc', 'Fechar janelas'],
];


const FAQ = [
  ['O APOLVEN cota automaticamente em todas as seguradoras?', 'Só onde existe integração validada: conector disponível, credenciamento aprovado, credencial válida, teste bem-sucedido e a função ativada em produção (Seguradoras e integrações). Nas demais, a consulta é assistida: a equipe pede no canal oficial e registra a resposta formal.'],
  ['Qual a diferença entre cotação válida e valor indicativo?', 'Cotação válida é o retorno formal da seguradora, com número ou documento e validade. Valor indicativo é simulação, tabela ou estimativa: aparece na comparação, mas não vira proposta sem confirmação.'],
  ['Por que a comparação aparece como "parcial"?', 'Porque alguma fonte elegível ainda não respondeu, falhou ou está em consulta assistida. Falha técnica, tempo excedido ou falta de resposta nunca são tratados como recusa.'],
  ['O cliente vê a comissão no comparativo?', 'Não. O comparativo e os links do cliente não mostram comissão nem dados internos. A comissão também nunca entra na pontuação da "melhor oferta".'],
  ['Prêmio, comissão e repasse são a mesma coisa?', 'Não. O prêmio é pago pelo cliente à seguradora (Parcelas do seguro). A comissão é a receita da corretora (Comissões). O repasse é a parte da comissão recebida que vai para parceiros (Repasses). A assinatura do sistema é outro controle.'],
  ['O cliente informou que pagou a parcela. Está pago?', 'Ainda não: fica como "pagamento informado" em conferência até a confirmação pela fonte oficial da seguradora.'],
  ['Como altero uma apólice já conferida?', 'Por endosso, na aba Endossos da apólice. A versão original é preservada e cada alteração gera uma nova versão.'],
  ['Por que o sistema pede o código do autenticador de novo?', 'Operações sensíveis (credenciais de seguradora, dados bancários de favorecidos) exigem reautenticação, mesmo com a sessão aberta.'],
  ['Onde vejo quem alterou um registro?', 'Em Gestão › Auditoria, com usuário, data, ação e motivo. Os registros não podem ser apagados.'],
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function useWatched(userId) {
  const key = `apolven.aulas.${userId || 'anon'}`;
  const [seen, setSeen] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } });
  const mark = (n) => setSeen((s) => {
    if (s[n]) return s;
    const next = { ...s, [n]: 1 };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sem armazenamento local */ }
    return next;
  });
  return [seen, mark];
}

/** Lê o WebVTT da aula (mesmas falas da narração e da legenda). */
function useCues(lesson) {
  const [cues, setCues] = useState([]);
  useEffect(() => {
    let alive = true;
    setCues([]);
    fetch(captionsUrl(lesson)).then((r) => (r.ok ? r.text() : '')).then((t) => {
      if (!alive) return;
      const sec = (x) => { const [h, m, s] = x.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s.replace(',', '.')); };
      const out = [];
      for (const block of t.replace(/\r/g, '').split(/\n\n+/)) {
        const lines = block.split('\n');
        const i = lines.findIndex((l) => l.includes('-->'));
        if (i < 0) continue;
        const [a, b] = lines[i].split('-->').map((x) => sec(x.trim().split(' ')[0]));
        out.push({ start: a, end: b, text: lines.slice(i + 1).join(' ').trim() });
      }
      setCues(out);
    }).catch(() => {});
    return () => { alive = false; };
  }, [lesson]);
  return cues;
}

export default function Support() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState('');
  const [seen, mark] = useWatched(user?.id);
  const [time, setTime] = useState(0);
  const player = useRef(null);
  const cur = LESSONS.find((l) => l.n === Number(params.get('aula'))) || LESSONS[0];
  const idx = LESSONS.indexOf(cur);
  const cues = useCues(cur);
  const done = LESSONS.filter((l) => seen[l.n]).length;
  const open = (l, play = true) => {
    setParams((p) => { const q = new URLSearchParams(p); q.set('aula', String(l.n)); return q; }, { replace: true });
    if (play) setTimeout(() => { player.current?.play?.().catch(() => {}); player.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }, 80);
  };
  useEffect(() => { setTime(0); player.current?.load?.(); }, [cur.n]);
  const groups = useMemo(() => {
    const t = norm(term.trim());
    const hit = (l) => !t || norm(`${l.title} ${l.desc} ${l.learn.join(' ')} ${l.text || ''}`).includes(t);
    return MODULES.map((m) => ({ ...m, items: LESSONS.filter((l) => l.mod === m.key && hit(l)) })).filter((g) => g.items.length);
  }, [term]);
  const seek = (s) => { const v = player.current; if (!v) return; v.currentTime = s + 0.05; v.play?.().catch(() => {}); };

  return (
    <div className="space-y-6">
      <PageHeader title="Suporte e treinamento"
        subtitle={`${LESSONS.length} vídeo-aulas com narração e legenda, gravadas no próprio APOLVEN (${Math.round(TOTAL_SECONDS / 60)} min no total).`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Aula atual" className="min-w-0 space-y-3">
          <video ref={player} key={cur.n} controls playsInline preload="metadata" poster={posterUrl(cur)}
            className="aspect-[16/10] w-full rounded-app bg-black shadow-lg"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => { mark(cur.n); if (LESSONS[idx + 1]) open(LESSONS[idx + 1], false); }}>
            <source src={videoUrl(cur)} type="video/mp4" />
            <track kind="captions" src={captionsUrl(cur)} srcLang="pt-BR" label="Português (transcrição)" />
            Seu navegador não reproduz vídeos.
          </video>
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip bg-primary/10 text-primary">Aula {cur.n} de {LESSONS.length}</span>
              <span className="flex items-center gap-1 text-ink-faint"><Clock className="h-4 w-4" /> {fmtDur(cur.s)}</span>
              <span className="flex items-center gap-1 text-ink-faint"><Captions className="h-4 w-4" /> narração e legenda</span>
              {seen[cur.n] && <span className="chip bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">assistida</span>}
            </div>
            <h2 className="mt-2 text-xl font-bold sm:text-2xl">{cur.title}</h2>
            <p className="text-ink-soft">{cur.desc}</p>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
              {cur.learn.map((x) => <li key={x} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-outline" disabled={idx === 0} onClick={() => open(LESSONS[idx - 1])}><ChevronLeft className="h-4 w-4" />Aula anterior</button>
              <button className="btn-primary" disabled={idx === LESSONS.length - 1} onClick={() => open(LESSONS[idx + 1])}>Próxima aula<ChevronRight className="h-4 w-4" /></button>
              {!seen[cur.n] && <button className="btn-ghost" onClick={() => mark(cur.n)}><CheckCircle2 className="h-4 w-4" />Marcar como assistida</button>}
              {cur.routes?.[0] && !cur.routes[0].endsWith('/') && <Link className="btn-ghost ml-auto" to={cur.routes[0]}>Ir para a tela</Link>}
            </div>
          </div>
          <Section title="Transcrição" subtitle="Clique em uma frase para ir àquele ponto da aula.">
            {!cues.length ? <p className="text-sm text-ink-faint">Transcrição indisponível.</p> : (
              <ol className="max-h-72 space-y-1 overflow-y-auto pr-1 text-sm">
                {cues.map((c, i) => {
                  const active = time >= c.start && time < (cues[i + 1]?.start ?? c.end + 1);
                  return (
                    <li key={`${c.start}-${i}`}>
                      <button onClick={() => seek(c.start)} aria-current={active ? 'true' : undefined}
                        className={cx('flex w-full gap-3 rounded-app-sm px-2 py-1.5 text-left hover:bg-muted', active && 'bg-primary/10 text-ink')}>
                        <span className="w-10 shrink-0 tabular-nums text-xs leading-5 text-ink-faint">{fmtDur(Math.floor(c.start))}</span>
                        <span className={active ? 'font-medium' : 'text-ink-soft'}>{c.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </section>
        <aside className="space-y-3" aria-label="Lista de aulas">
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">Seu progresso</span><span className="text-ink-faint">{done} de {LESSONS.length}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={LESSONS.length} aria-valuenow={done}>
              <div className="h-full bg-primary transition-all" style={{ width: `${(done / LESSONS.length) * 100}%` }} />
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-app-sm border border-line px-3">
              <Search className="h-4 w-4 text-ink-faint" />
              <input className="w-full bg-transparent py-2 text-sm outline-none" placeholder="Buscar aula" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar aula" />
            </label>
          </div>
          <div className="card max-h-[78vh] overflow-y-auto p-2">
            {groups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="px-2 pt-1 text-xs font-bold uppercase tracking-wide text-ink-faint">{g.label}</div>
                {g.items.map((l) => (
                  <button key={l.n} onClick={() => open(l)} aria-current={l.n === cur.n ? 'true' : undefined}
                    className={cx('mt-1 flex w-full items-center gap-3 rounded-app-sm p-2 text-left hover:bg-primary/5', l.n === cur.n && 'bg-primary/10 ring-1 ring-primary/40')}>
                    <span className="relative shrink-0">
                      <img src={thumbUrl(l)} alt="" loading="lazy" className="h-14 w-24 rounded object-cover" />
                      <PlayCircle className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug">{l.n}. {l.title}</span>
                      <span className="text-xs text-ink-faint">{fmtDur(l.s)}{seen[l.n] ? ' · ✓ assistida' : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="p-3 text-sm text-ink-faint">Nenhuma aula encontrada.</p>}
          </div>
        </aside>
      </div>
      <Section title="Perguntas frequentes">
        <div className="space-y-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="rounded-app-sm border border-line p-3">
              <summary className="cursor-pointer font-medium">{q}</summary>
              <p className="mt-2 text-sm text-ink-soft">{a}</p>
            </details>
          ))}
        </div>
      </Section>
      <HelpExtras />
    </div>
  );
}

function HelpExtras() {
  const { access, company } = useAuth();
  const ch = access?.support_channel || {};
  const hasChannel = ch.whatsapp || ch.email;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Section title="Fluxo de uma nova venda" subtitle="Do primeiro contato à renovação">
            <ol className="space-y-3">
              {FLOW.map(([t, d, to], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{i + 1}</span>
                  <div className="text-sm">
                    <p className="font-medium">{to ? <Link to={to} className="hover:underline">{t}</Link> : t}</p>
                    <p className="text-ink-soft">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
          <Section title="Assistido × automático">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-app-sm border border-line p-3">
                <p className="flex items-center gap-2 font-medium"><Bot className="h-4 w-4 text-primary" /> Automático</p>
                <p className="mt-1 text-sm text-ink-soft">Só acontece quando há conector disponível, credenciamento aprovado, credencial válida, teste bem-sucedido e a função ativada em <b>produção</b> em Seguradoras e Integrações. Cada função (cotação, transmissão, parcelas…) é liberada separadamente.</p>
              </div>
              <div className="rounded-app-sm border border-line p-3">
                <p className="flex items-center gap-2 font-medium"><Hand className="h-4 w-4 text-primary" /> Assistido</p>
                <p className="mt-1 text-sm text-ink-soft">Sem integração automática, a equipe consulta a seguradora pelo canal oficial e registra a resposta formal com origem e validade. O sistema nunca apresenta um valor simulado como cotação real.</p>
              </div>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>Falha técnica, tempo excedido ou falta de resposta <b>não</b> são recusa da seguradora.</li>
              <li>Ambiente de testes nunca é tratado como produção.</li>
              <li>Prêmio do seguro, comissão da corretora, repasses e assinatura do sistema são controles separados.</li>
              <li>“Pagamento informado” é diferente de “pagamento confirmado” pela fonte oficial.</li>
            </ul>
            <Link to="/integracoes" className="btn-outline mt-3">Ver Seguradoras e Integrações</Link>
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Atalhos de teclado" actions={<Keyboard className="h-4 w-4 text-ink-faint" />}>
            <dl className="space-y-2 text-sm">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt><kbd className="rounded border border-line bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
                  <dd className="text-right text-ink-soft">{d}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Falar com o suporte" actions={<LifeBuoy className="h-4 w-4 text-ink-faint" />}>
            {hasChannel ? (
              <div className="flex flex-col gap-2">
                {ch.whatsapp && <a className="btn-outline" href={waLink(ch.whatsapp, `Olá! Preciso de ajuda com o APOLVEN (${company?.trade_name || company?.name || ''}).`)} target="_blank" rel="noreferrer noopener"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
                {ch.email && <a className="btn-outline" href={`mailto:${ch.email}`}><Mail className="h-4 w-4" /> {ch.email}</a>}
              </div>
            ) : <p className="text-sm text-ink-soft">O canal de suporte ainda não foi informado pela plataforma. Fale com o administrador da sua corretora.</p>}
            <Notice tone="warn" className="mt-3">Nunca envie senhas, códigos de verificação, Client Secret, tokens ou chaves ao suporte. Informe o código de correlação exibido nas mensagens de erro.</Notice>
          </Section>
          <Section title="Sobre" actions={<Info className="h-4 w-4 text-ink-faint" />}>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Sistema</dt><dd>APOLVEN</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Versão</dt><dd className="tabular-nums">{pkg.version}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Modo de compilação</dt><dd>{import.meta.env.MODE}</dd></div>
            </dl>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint"><Workflow className="h-3.5 w-3.5" /> Regras e textos seguem a especificação funcional vigente.</p>
          </Section>
        </div>
      </div>
    </>
  );
}
