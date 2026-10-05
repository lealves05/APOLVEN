export const hexToRgb = (hex) => {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h || '1d4ed8', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const luminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const RADIUS = { none: '4px', md: '10px', lg: '14px', xl: '20px' };
export const FONTS = { Inter: 'Inter', Poppins: 'Poppins', 'DM Sans': 'DM Sans', Nunito: 'Nunito', Sistema: 'system-ui' };
export const PRESET_COLORS = ['#1d4ed8', '#dc2626', '#e11d48', '#db2777', '#d97706', '#ca8a04', '#65a30d', '#16a34a', '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#9333ea', '#475569', '#18181b'];

/** Paletas prontas: nome + cor principal. */
export const COLOR_THEMES = [
  ['Brasa', '#1d4ed8'], ['Faísca', '#d97706'], ['Aço', '#475569'], ['Grafite', '#18181b'], ['Oceano', '#0284c7'],
  ['Cobalto', '#2563eb'], ['Índigo', '#4f46e5'], ['Violeta', '#7c3aed'], ['Rubi', '#dc2626'], ['Framboesa', '#db2777'],
  ['Floresta', '#16a34a'], ['Esmeralda', '#059669'], ['Petróleo', '#0d9488'], ['Oliva', '#65a30d'],
];

/** Aplica cor, raio, fonte, densidade e tema no documento. */
export function applyTheme(settings = {}, prefs = {}) {
  const root = document.documentElement;
  const color = prefs.primaryColor || settings.primaryColor;
  const rgb = hexToRgb(color);
  root.style.setProperty('--primary', rgb.join(' '));
  root.style.setProperty('--primary-fg', luminance(rgb) > 0.55 ? '24 24 27' : '255 255 255');
  root.style.setProperty('--radius', RADIUS[settings.radius] || RADIUS.lg);
  root.style.setProperty('--font', `'${FONTS[settings.font] || 'Inter'}'`);
  const mode = prefs.theme || settings.theme || 'system';
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', !!dark);
  root.classList.toggle('density-compact', (prefs.density || settings.density) === 'compact');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#1d4ed8');
}
