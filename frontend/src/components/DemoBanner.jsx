import { useState } from 'react';
import { Sparkles, Rocket } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { maskPhone } from '../lib/format';
import { Modal, Input, Toggle, useAction, FAIL } from './ui';

/** Faixa exibida na versão de demonstração, com a ativação do uso normal. */
export default function DemoBanner() {
  const { company, user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!company?.is_demo || user?.role !== 'owner') return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-amber-400 px-4 py-1.5 text-sm text-amber-950">
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1"><b>Demonstração</b><span className="hidden sm:inline"> — os dados são fictícios e a conta é apagada após 7 dias sem ativação.</span></span>
        <button className="btn h-8 bg-amber-950 px-3 text-xs text-amber-50 hover:bg-amber-900" onClick={() => setOpen(true)}>
          <Rocket className="h-3.5 w-3.5" /> Ativar uso normal
        </button>
      </div>
      {open && <ActivateModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ActivateModal({ onClose }) {
  const { activate } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '', phone: '', keepData: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    const r = await run(() => activate(f));
    if (r !== FAIL) { onClose(); toast('Sistema ativado! Use o e-mail e a senha que você definiu para entrar.'); }
  };
  return (
    <Modal open onClose={onClose} title="Ativar o uso normal" subtitle="Transforme a demonstração na conta da sua corretora"
      footer={<><button className="btn-ghost" onClick={onClose}>Continuar testando</button>
        <button className="btn-primary" disabled={busy || !f.companyName || !f.name || !f.email || f.password.length < 6} onClick={go}><Rocket className="h-4 w-4" /> Ativar</button></>}>
      <div className="space-y-4">
        <Input label="Nome da corretora" value={f.companyName} onChange={set('companyName')} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Seu nome" value={f.name} onChange={set('name')} />
          <Input label="Telefone / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} />
        </div>
        <Input label="E-mail (será o seu login)" type="email" value={f.email} onChange={set('email')} />
        <Input label="Senha" type="password" value={f.password} onChange={set('password')} hint="Mínimo de 10 caracteres, com letras e números" autoComplete="new-password" />
        <div className="rounded-app-sm border border-line p-3">
          <Toggle checked={f.keepData} onChange={(v) => setF({ ...f, keepData: v })} label="Manter os dados de exemplo"
            hint={f.keepData ? 'Clientes, clientes, apólices, cotações e lançamentos fictícios continuam no sistema.' : 'Recomendado: começa limpo, mantendo só as configurações e a aparência.'} />
        </div>
      </div>
    </Modal>
  );
}
