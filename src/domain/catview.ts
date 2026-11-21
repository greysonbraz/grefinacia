import { normDesc, detectSubscriptions } from './analysis';
import { costMonth, effectiveDue } from './ledger';
import { makeDate, monthOf } from '../lib/dates';
import type { AppData, Cents, ISODate, Settings, Transaction, YearMonth } from '../lib/types';

/** Grupos de categorias (visão "Grupos" dos gráficos). Categorias criadas por você entram em "Outros". */
export const GROUPS: { id: string; name: string; icon: string; cats: string[] }[] = [
  { id: 'moradia', name: 'Moradia e contas', icon: 'Home', cats: ['moradia', 'contas'] },
  { id: 'alimentacao', name: 'Alimentação', icon: 'Utensils', cats: ['mercado', 'alimentacao'] },
  { id: 'transporte', name: 'Transporte', icon: 'Car', cats: ['transporte'] },
  { id: 'saude', name: 'Saúde', icon: 'HeartPulse', cats: ['saude'] },
  { id: 'educacao', name: 'Educação', icon: 'GraduationCap', cats: ['educacao'] },
  { id: 'digital', name: 'Lazer e assinaturas', icon: 'Tv', cats: ['lazer', 'assinaturas'] },
  { id: 'compras', name: 'Compras', icon: 'ShoppingBag', cats: ['compras', 'vestuario', 'presentes'] },
  { id: 'financeiro', name: 'Impostos e dívidas', icon: 'Landmark', cats: ['impostos', 'dividas', 'juros'] },
  { id: 'outros', name: 'Outros', icon: 'CircleEllipsis', cats: ['outros_gasto'] },
];
export const groupOf = (categoryId: string): string => GROUPS.find((g) => g.cats.includes(categoryId))?.id ?? 'outros';

/** Despesas de uma ou mais categorias nos meses (mesma regra dos totais: mês da fatura para o cartão). */
export function categoryTxs(data: AppData, categoryIds: string[], months: YearMonth[]): Transaction[] {
  const cats = new Set(categoryIds);
  const ms = new Set(months);
  return data.transactions
    .filter((t) => t.type === 'expense' && cats.has(t.categoryId) && ms.has(costMonth(t)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/**
 * Troca a categoria dos lançamentos escolhidos. Com `learn`, guarda a regra "descrição parecida → categoria"
 * (a mesma das importações), para os próximos lançamentos do banco já entrarem certos.
 */
export function recategorize(txs: Transaction[], categoryId: string, rules: Settings['importRules'], learn: boolean): { txs: Transaction[]; rules: Settings['importRules'] } {
  const changed = txs.filter((t) => t.categoryId !== categoryId).map((t) => ({ ...t, categoryId }));
  let out = rules;
  if (learn) {
    out = [...rules];
    for (const t of txs) {
      const pattern = normDesc(t.description);
      if (!pattern || pattern.length < 3) continue;
      const i = out.findIndex((r) => r.pattern === pattern);
      if (i >= 0) out[i] = { pattern, categoryId };
      else out.push({ pattern, categoryId });
    }
  }
  return { txs: changed, rules: out };
}

// ---------- Marca das assinaturas: desenho próprio do app (sem logos de terceiros) ----------
const BRANDS: [RegExp, string, string][] = [
  [/netflix/, 'N', '#e50914'], [/spotify/, 'S', '#1db954'], [/youtube/, 'Y', '#ff0033'], [/google|gsuite|workspace/, 'G', '#4285f4'],
  [/amazon|prime video|primevideo/, 'a', '#00a8e1'], [/disney/, 'D', '#113ccf'], [/\bhbo\b|\bmax\b/, 'M', '#5822b4'], [/apple|icloud|itunes/, 'A', '#6e6e73'],
  [/globoplay|globo/, 'g', '#fb0234'], [/deezer/, 'D', '#a238ff'], [/paramount/, 'P', '#0064ff'], [/crunchyroll/, 'C', '#f47521'],
  [/microsoft|office|xbox/, 'M', '#107c10'], [/playstation|\bpsn\b/, 'P', '#003791'], [/openai|chatgpt/, 'O', '#10a37f'], [/anthropic|claude/, 'C', '#d97757'],
  [/canva/, 'C', '#00c4cc'], [/adobe/, 'A', '#fa0f00'], [/dropbox/, 'D', '#0061ff'], [/linkedin/, 'in', '#0a66c2'], [/tinder/, 'T', '#fe3c72'],
  [/ifood/, 'i', '#ea1d2c'], [/uber/, 'U', '#3a3a3c'], [/smart ?fit/, 'S', '#f5b301'], [/wellhub|gympass/, 'W', '#d6286b'], [/twitch/, 'T', '#9146ff'],
  [/kindle|audible/, 'K', '#ff9900'], [/duolingo/, 'D', '#58cc02'], [/mercado ?livre|meli/, 'M', '#ffe600'], [/claro/, 'C', '#da291c'], [/vivo/, 'V', '#660099'], [/\btim\b/, 'T', '#004691'],
];
const PALETTE = ['#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#fb923c', '#a3e635'];

/** Nome limpo do lançamento: tira "Pix enviado", "Pagamento", códigos e números. */
export function cleanMerchant(desc: string): string {
  const s = desc.replace(/^(pix (enviado|recebido)|pagamento( de)?|compra( no)?|deb(ito)?( automatico)?|pag\*|pg \*|ec \*)\s*[-:]?\s*/i, '').replace(/\*/g, ' ').replace(/\b\d[\d./-]*\b/g, ' ').replace(/\s+/g, ' ').trim();
  return s || desc.trim();
}

/** Letra e cor da marca do serviço (cores conhecidas; sem marca conhecida, cor fixa pelo nome). */
export function brandMark(desc: string): { letter: string; color: string; known: boolean } {
  const n = cleanMerchant(desc).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, letter, color] of BRANDS) if (re.test(n)) return { letter, color, known: true };
  const first = n.match(/[a-z0-9]/)?.[0]?.toUpperCase() ?? '?';
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { letter: first, color: PALETTE[h % PALETTE.length], known: false };
}

export interface MonthSub { key: string; name: string; cents: Cents; date: ISODate; paid: boolean }
/**
 * Assinaturas do mês para o Início: lançamentos do mês na categoria Assinaturas (ou do tipo assinatura) e
 * as assinaturas que o app detecta pela repetição, com a data prevista quando ainda não apareceram.
 */
export function monthSubscriptions(data: AppData, today: ISODate): { items: MonthSub[]; totalCents: Cents } {
  const ym = monthOf(today);
  const items: MonthSub[] = [];
  const seen = new Set<string>();
  for (const t of data.transactions) {
    if (t.type !== 'expense' || (t.categoryId !== 'assinaturas' && t.kind !== 'assinatura')) continue;
    const d = t.status === 'pending' ? effectiveDue(t) : t.date;
    if (monthOf(d) !== ym) continue;
    const k = normDesc(cleanMerchant(t.description)) || t.id;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ key: t.id, name: cleanMerchant(t.description), cents: t.amountCents, date: d, paid: t.status === 'paid' });
  }
  for (const s of detectSubscriptions(data, today)) {
    const k = normDesc(cleanMerchant(s.name));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const day = s.lastDate.slice(8, 10);
    const date = monthOf(s.lastDate) === ym ? s.lastDate : makeDate(ym, Number(day));
    items.push({ key: s.key, name: cleanMerchant(s.name), cents: s.monthlyCents, date, paid: monthOf(s.lastDate) === ym });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { items, totalCents: items.reduce((s, i) => s + i.cents, 0) };
}
