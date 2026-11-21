import type { AppData, Settings } from '../lib/types';

/**
 * Um cartão só por banco (pedido do dono): o cartão ligado à conexão bancária é o oficial; outros cartões do mesmo
 * banco (repetidos, recriados ou de outro cartão da mesma conta) são juntados nele. As compras, recorrências e
 * importações passam para o oficial; nada é apagado além do cartão repetido, que fica vazio.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function planCardMerge(
  data: AppData,
  links: Settings['bank']['links'],
  accounts: { id: string; itemId: string; bankName: string; type?: string }[],
): { map: Map<string, string>; links: Settings['bank']['links'] } {
  const map = new Map<string, string>();
  const byItem = new Map<string, { accId: string; cardId: string; bankName: string }[]>();
  for (const [accId, l] of Object.entries(links ?? {})) {
    if (l.kind !== 'cartao' || !l.id) continue;
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) continue;
    byItem.set(acc.itemId, [...(byItem.get(acc.itemId) ?? []), { accId, cardId: l.id, bankName: acc.bankName }]);
  }
  const linkedIds = new Set([...byItem.values()].flat().map((x) => x.cardId));
  const newLinks = { ...(links ?? {}) };
  for (const list of byItem.values()) {
    const existing = list.filter((x) => data.cards.some((c) => c.id === x.cardId));
    if (!existing.length) continue;
    // o oficial: o cartão com mais lançamentos entre os ligados ao banco
    const count = (id: string) => data.transactions.filter((t) => t.cardId === id).length;
    const canon = [...existing].sort((a, b) => count(b.cardId) - count(a.cardId))[0].cardId;
    for (const x of list) {
      if (x.cardId !== canon) { map.set(x.cardId, canon); newLinks[x.accId] = { kind: 'cartao', id: canon }; }
    }
    const bank = new RegExp(`\\b${norm(list[0].bankName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    for (const c of data.cards) {
      if (c.id === canon || linkedIds.has(c.id) || map.has(c.id)) continue;
      if (bank.test(norm(c.name))) map.set(c.id, canon);
    }
  }
  return { map, links: newLinks };
}
