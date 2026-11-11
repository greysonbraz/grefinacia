import type { AppData, Settings } from './types';
import { DEFAULT_CATEGORIES } from './categories';

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  theme: 'dark',
  security: { enabled: false, kind: 'pin', biometric: false, lockAfterSec: 30, hideInRecents: true },
  salary: { amountCents: 0, payDay: 5, savePct: 20, investPct: 20 },
  budgets: {},
  notifications: {
    enabled: true,
    time: '09:00',
    billsDaysBefore: 2,
    dividendDaysBefore: 1,
    types: { salary: true, billsDue: true, overdue: true, dividendAnnounced: true, dividendSoon: true, dividendReceived: true, overBudget: true, lowBalance: true, goalReached: true, backup: true },
  },
  api: { quoteProvider: 'brapi', dividendProvider: 'brapi', brapiToken: '', brapiPlan: 'free' },
  ai: { mode: 'local', apiKey: '', model: 'claude-haiku-5-5', consent: false },
  freedom: { yieldPct: 6 },
};

export function emptyData(): AppData {
  return {
    accounts: [],
    cards: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    transactions: [],
    recurrences: [],
    goals: [],
    goalMoves: [],
    assets: [],
    operations: [],
    fixedIncomes: [],
    dividends: [],
    debts: [],
    snapshots: [],
    firedAlerts: [],
  };
}

export const DATA_KEYS: (keyof AppData)[] = ['accounts', 'cards', 'categories', 'transactions', 'recurrences', 'goals', 'goalMoves', 'assets', 'operations', 'fixedIncomes', 'dividends', 'debts', 'snapshots', 'firedAlerts'];
