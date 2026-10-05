// Ajuda: como o sistema funciona, atalhos, assistido × automático e contato com o suporte.
import { Link } from 'react-router-dom';
import { LifeBuoy, Keyboard, Workflow, Bot, Hand, Info, MessageCircle, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Section, Notice } from '../components/ui';
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

export default function Support() {
  const { access, company } = useAuth();
  const ch = access?.support_channel || {};
  const hasChannel = ch.whatsapp || ch.email;
  return (
    <>
      <PageHeader title="Ajuda e suporte" subtitle="Como o sistema funciona, atalhos e contato" />
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
