// Logotipo da corretora (Configurações › Aparência): PNG/JPG/WEBP conferidos pela assinatura do arquivo,
// redimensionados no navegador (até 1200 px para impressão + miniatura para o menu) e enviados ao servidor.
import { useEffect, useState } from 'react';
import { Upload, Trash2, Building, ImageOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Section, Notice, FileButton, Spinner, useAction, FAIL } from './ui';

const MAX_INPUT = 8 * 1024 * 1024; // arquivo original (antes de reduzir)
const MAX_LOGO = 1024 * 1024;
const MAX_THUMB = 150 * 1024;

async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const bytesOf = (dataUrl) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/** Reduz para caber em maxSide e no limite de bytes; PNG mantém transparência. */
function encode(bmp, maxSide, mime, maxBytes) {
  let side = maxSide;
  for (let i = 0; i < 8; i += 1) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (mime === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(bmp, 0, 0, w, h);
    const url = c.toDataURL(mime, 0.9);
    if (bytesOf(url) <= maxBytes) return { url, w, h };
    side = Math.round(side * 0.8);
  }
  throw new Error('Não foi possível reduzir a imagem ao tamanho permitido.');
}

export default function LogoUploader() {
  const { can, setCompany } = useAuth();
  const { toast, confirm } = useUI();
  const [run, busy] = useAction();
  const [logo, setLogo] = useState(undefined);
  const [info, setInfo] = useState(null);
  const [working, setWorking] = useState(false);
  const edit = can('settings');
  const load = () => api.get('/v1/company/logo').then((r) => { setLogo(r.data_url || null); setInfo(r); }).catch(() => setLogo(null));
  useEffect(() => { load(); }, []);
  const refreshCompany = async () => { try { setCompany(await api.get('/v1/company')); } catch { /* menu atualiza no próximo acesso */ } };

  const pick = async (file) => {
    if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) { toast('SVG não é aceito por segurança. Use PNG, JPG ou WEBP.', 'error'); return; }
    if (file.size > MAX_INPUT) { toast('Arquivo acima de 8 MB. Use uma imagem menor.', 'error'); return; }
    setWorking(true);
    try {
      const real = await sniff(file);
      if (!real) throw new Error('O arquivo não é uma imagem PNG, JPG ou WEBP válida.');
      const bmp = await loadBitmap(file);
      const outMime = real === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const image = encode(bmp, 1200, outMime, MAX_LOGO);
      const thumb = encode(bmp, 256, outMime, MAX_THUMB);
      const r = await run(() => api.put('/v1/company/logo', { image: image.url, thumb: thumb.url }), 'Logotipo atualizado.');
      if (r !== FAIL) { await load(); await refreshCompany(); }
    } catch (e) { toast(e.message, 'error'); } finally { setWorking(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Remover o logotipo?', message: 'Ele sai do menu e dos documentos impressos. Você pode enviar outro quando quiser.', confirmText: 'Remover' }))) return;
    const r = await run(() => api.del('/v1/company/logo'), 'Logotipo removido.');
    if (r !== FAIL) { await load(); await refreshCompany(); }
  };

  return (
    <Section title="Logo da corretora" subtitle="PNG, JPG ou WEBP. Aparece no menu, na versão impressa da apólice e nos documentos ao cliente.">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-24 w-56 place-items-center rounded-app-sm border border-dashed border-line bg-white p-2">
          {logo === undefined ? <Spinner /> : logo ? <img src={logo} alt="Logotipo da corretora" className="max-h-20 max-w-[200px] object-contain" />
            : <span className="flex flex-col items-center gap-1 text-xs text-ink-faint"><Building className="h-6 w-6" />Sem logotipo</span>}
        </div>
        <div className="space-y-2">
          {edit && (
            <div className="flex flex-wrap gap-2">
              <FileButton accept="image/png,image/jpeg,image/webp" onFile={pick} disabled={working || busy}>
                {working || busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {logo ? 'Trocar logotipo' : 'Enviar logotipo'}
              </FileButton>
              {logo && <button type="button" className="btn-ghost text-red-600" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Remover</button>}
            </div>
          )}
          <p className="text-xs text-ink-faint">A imagem é reduzida automaticamente (até 1200 px e 1 MB). Fundo transparente (PNG) fica melhor no papel.</p>
          {info?.legacy && <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><ImageOff className="h-3.5 w-3.5" />Logotipo antigo em baixa resolução: envie de novo para melhorar a impressão.</p>}
        </div>
      </div>
      {!edit && <Notice className="mt-3">Só quem administra a corretora pode trocar o logotipo.</Notice>}
    </Section>
  );
}
