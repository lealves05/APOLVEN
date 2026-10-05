// Copia o texto do cabeçalho de cada coluna para data-label nas células,
// para que as tabelas virem cards no celular (ver index.css).
function label() {
  document.querySelectorAll('table.table-clean, table.table-stack').forEach((t) => {
    const heads = [...t.querySelectorAll(':scope > thead th')].map((th) => th.textContent.trim());
    t.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        const l = td.colSpan > 1 ? '' : heads[i] || '';
        if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
      });
    });
  });
}

export function startMobileTables() {
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(label); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
}
