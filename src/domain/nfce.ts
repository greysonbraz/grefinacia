import type { ISODate } from '../lib/types';

/**
 * NFC-e (nota fiscal do consumidor). O QR code impresso no cupom traz o link público de consulta da Sefaz do estado
 * e a chave de acesso (44 dígitos). Da chave saem estado, mês, CNPJ e número; na emissão em contingência o QR
 * também traz o dia e o valor. Itens e loja vêm da página pública de consulta (a mesma que abre no navegador).
 */
export interface NfceQr {
  url: string; // sempre https
  chave: string;
  uf: string; // código IBGE (41 = PR)
  cnpj: string;
  ym: string; // AAAA-MM
  numero: number;
  offline?: { day: number; totalCents: number };
}

export function parseNfceQr(raw: string): NfceQr | null {
  const s = raw.trim();
  const m = s.match(/^https?:\/\/([^\s?#]+)\?(?:.*&)?p=([^&\s]+)/i);
  if (!m) return null;
  const parts = decodeURIComponent(m[2]).split('|');
  const chave = (parts[0] ?? '').replace(/\D/g, '');
  if (chave.length !== 44) return null;
  const yy = Number(chave.slice(2, 4)), mm = Number(chave.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const q: NfceQr = { url: s.replace(/^http:/i, 'https:'), chave, uf: chave.slice(0, 2), cnpj: chave.slice(6, 20), ym: `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}`, numero: Number(chave.slice(25, 34)) };
  // contingência (offline): chave|versão|ambiente|dia|valor|digVal|idToken|hash
  if (parts.length >= 8 && /^\d{1,2}$/.test(parts[3]) && /^\d+(\.\d{1,2})?$/.test(parts[4])) q.offline = { day: Number(parts[3]), totalCents: Math.round(Number(parts[4]) * 100) };
  return q;
}

export interface NfceItem { name: string; qty: number; unit: string; totalCents: number }
export interface NfceData { merchant: string | null; cnpj: string | null; date: ISODate | null; totalCents: number | null; items: NfceItem[] }

const cents = (s: string | null | undefined) => {
  const v = (s ?? '').replace(/[^\d,.-]/g, '');
  if (!v) return null;
  const n = Number(v.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Página pública da NFC-e (leiaute padrão do Portal da NFC-e, usado pela maioria dos estados).
 * Devolve null quando a página pede captcha ou não é o leiaute esperado: aí o app só oferece abrir no navegador.
 */
export function parseNfceHtml(html: string): NfceData | null {
  if (/captcha/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('#tabResult tr')];
  const items: NfceItem[] = rows.map((r) => ({
    name: txt(r.querySelector('.txtTit')).replace(/\(Código:.*$/i, '').trim(),
    qty: Number((txt(r.querySelector('.Rqtd')).match(/\d+(?:[.,]\d+)?/)?.[0] ?? '1').replace(',', '.')) || 1,
    unit: txt(r.querySelector('.RUN')).replace(/^UN:?\s*/i, '') || 'UN',
    totalCents: cents(txt(r.querySelector('.valor'))) ?? 0,
  })).filter((i) => i.name && i.totalCents > 0);
  // total: "Valor a pagar R$:" (ou "Valor total R$:") seguido do número
  let total: number | null = null;
  for (const label of ['valor a pagar', 'valor total']) {
    const box = [...doc.querySelectorAll('#totalNota div, #linhaTotal, .linhaShade')].find((d) => txt(d).toLowerCase().startsWith(label));
    total = cents(txt(box?.querySelector('.totalNumb')));
    if (total) break;
  }
  if (!total && items.length) total = items.reduce((s, i) => s + i.totalCents, 0);
  if (!items.length && !total) return null;
  const merchant = txt(doc.querySelector('#u20, .txtTopo')) || null;
  const cnpj = html.match(/CNPJ:?\s*(?:<[^>]+>\s*)*([\d./-]{14,18})/i)?.[1] ?? null;
  const dm = html.match(/Emiss[ãa]o:?\s*(?:<[^>]+>\s*)*(\d{2})\/(\d{2})\/(\d{4})/i);
  return { merchant, cnpj, date: dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null, totalCents: total, items };
}

/** Sefaz que o app consulta direto (as outras abrem no navegador). */
export const NFCE_HOSTS = ['www.fazenda.pr.gov.br'];
export const nfceHostAllowed = (url: string) => { try { return NFCE_HOSTS.includes(new URL(url).host); } catch { return false; } };
