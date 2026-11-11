/** Datas são sempre strings ISO locais "AAAA-MM-DD"; meses "AAAA-MM"; dinheiro sempre em CENTAVOS inteiros. */
export type ISODate = string;
export type YearMonth = string;
export type Cents = number;

export type PaymentMethod = 'pix' | 'debito' | 'credito' | 'dinheiro' | 'boleto' | 'transferencia' | 'outro';
export type IncomeKind = 'salario' | 'hora_extra' | 'adicional' | 'outro_rendimento';
export type ExpenseKind = 'fixa' | 'variavel' | 'cartao' | 'parcelada' | 'assinatura';
export type TxKind = IncomeKind | ExpenseKind;
export type TxType = 'income' | 'expense';

export interface Account {
  id: string;
  name: string;
  kind: 'corrente' | 'poupanca' | 'carteira' | 'outro';
  /** Saldo no início do dia `initialDate`. Movimentos anteriores a essa data não alteram o saldo. */
  initialCents: Cents;
  initialDate: ISODate;
  archived?: boolean;
}

export interface Card {
  id: string;
  name: string;
  closingDay: number; // dia de fechamento da fatura
  dueDay: number; // dia de vencimento
  limitCents?: Cents;
  accountId?: string; // conta usada para pagar a fatura
}

export interface Category {
  id: string;
  name: string;
  icon: string; // nome do ícone (lucide)
  type: TxType;
}

export interface Transaction {
  id: string;
  type: TxType;
  kind: TxKind;
  description: string;
  amountCents: Cents; // sempre positivo
  categoryId: string;
  date: ISODate; // data da compra / do lançamento (competência)
  dueDate?: ISODate; // vencimento (despesas pendentes)
  paymentMethod: PaymentMethod;
  accountId?: string;
  cardId?: string;
  status: 'paid' | 'pending';
  paidDate?: ISODate;
  installment?: { groupId: string; number: number; total: number };
  recurrenceId?: string;
  recurrenceMonth?: YearMonth;
  source?: 'dividend' | 'salary' | 'manual';
  refId?: string; // id do provento, etc.
  notes?: string;
  createdAt: number;
}

export interface Recurrence {
  id: string;
  type: TxType;
  kind: TxKind;
  description: string;
  amountCents: Cents;
  categoryId: string;
  paymentMethod: PaymentMethod;
  accountId?: string;
  cardId?: string;
  dayOfMonth: number;
  startMonth: YearMonth;
  endMonth?: YearMonth;
  active: boolean;
  skipMonths?: YearMonth[];
  source?: 'salary';
}

export interface Goal {
  id: string;
  name: string;
  icon: string;
  targetCents: Cents;
  deadline?: ISODate;
  monthlyPlanCents?: Cents; // aporte mensal planejado
  createdAt: number;
}

export interface GoalMove {
  id: string;
  goalId: string;
  amountCents: Cents; // + depósito, − retirada
  date: ISODate;
  accountId?: string; // conta de onde saiu / para onde voltou o dinheiro
  note?: string;
  createdAt: number;
}

export type AssetType = 'acao' | 'fii' | 'etf';

export interface Quote {
  priceCents: Cents;
  time: string; // ISO datetime da cotação
  fetchedAt: string;
  source: string;
  changePct?: number;
}

export interface Asset {
  id: string;
  ticker: string;
  type: AssetType;
  name?: string;
  quote?: Quote;
  manualPriceCents?: Cents; // preço informado à mão, usado quando não há cotação
}

export interface Operation {
  id: string;
  assetId: string;
  side: 'buy' | 'sell';
  quantity: number;
  priceCents: Cents;
  feesCents: Cents;
  date: ISODate;
  broker: string;
  accountId?: string;
  createdAt: number;
}

export interface FixedIncome {
  id: string;
  name: string; // ex.: "CDB Banco X 110% CDI"
  investedCents: Cents;
  currentCents: Cents; // valor atual informado manualmente
  currentUpdatedAt: ISODate;
  purchaseDate: ISODate;
  maturityDate?: ISODate;
  rate?: string;
  broker?: string;
  accountId?: string;
  kind?: 'tesouro' | 'cdb' | 'lci' | 'lca' | 'poupanca' | 'outro';
  annualRatePct?: number; // taxa anual efetiva informada por você (para estimativas)
  liquidity?: string; // ex.: "diária", "no vencimento"
}

export type DebtKind = 'emprestimo' | 'financiamento' | 'cartao' | 'cheque_especial' | 'parcelamento' | 'consignado' | 'outro';

export interface Debt {
  id: string;
  kind: DebtKind;
  name: string;
  institution: string;
  originalCents: Cents;
  balanceCents: Cents; // saldo devedor atual
  installmentCents: Cents;
  remainingInstallments: number;
  monthlyRatePct: number; // juros ao mês (%)
  cetPct?: number; // CET ao ano (%)
  dueDay: number;
  endDate?: ISODate;
  createdAt: number;
}

export type DividendKind = 'dividendo' | 'jcp' | 'rendimento' | 'amortizacao' | 'outro';

export interface DividendEvent {
  id: string;
  assetId: string;
  kind: DividendKind;
  ratePerUnit: number; // R$ por ação/cota (pode ter muitas casas decimais)
  dataCom?: ISODate; // último dia com direito
  exDate?: ISODate;
  paymentDate?: ISODate;
  approvedOn?: ISODate;
  source: 'api' | 'manual';
  sourceName?: string;
  official: boolean; // pagamento oficialmente anunciado
  quantityOverride?: number;
  receivedAt?: ISODate;
  receivedTxId?: string;
  key: string; // chave p/ evitar duplicidade
}

export interface Snapshot {
  id: string; // = date
  date: ISODate;
  accountsCents: Cents;
  goalsCents: Cents;
  fixedIncomeCents: Cents;
  equityMarketCents: Cents;
  equityCostCents: Cents;
  totalCents: Cents;
  debtCents?: Cents;
}

export interface FiredAlert {
  id: string; // chave de deduplicação
  at: number;
}

export interface AppData {
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  goals: Goal[];
  goalMoves: GoalMove[];
  assets: Asset[];
  operations: Operation[];
  fixedIncomes: FixedIncome[];
  dividends: DividendEvent[];
  debts: Debt[];
  snapshots: Snapshot[];
  firedAlerts: FiredAlert[];
}

export type CollectionName = keyof AppData;

export interface NotificationPrefs {
  enabled: boolean;
  time: string; // HH:MM
  billsDaysBefore: number;
  dividendDaysBefore: number;
  types: {
    salary: boolean;
    billsDue: boolean;
    overdue: boolean;
    dividendAnnounced: boolean;
    dividendSoon: boolean;
    dividendReceived: boolean;
    overBudget: boolean;
    lowBalance: boolean;
    goalReached: boolean;
    backup: boolean;
  };
}

export interface Settings {
  onboarded: boolean;
  theme: 'dark' | 'light' | 'system';
  userName?: string;
  security: {
    enabled: boolean;
    kind: 'pin' | 'password';
    salt?: string;
    hash?: string;
    iterations?: number;
    biometric: boolean;
    lockAfterSec: number;
    hideInRecents: boolean;
  };
  salary: {
    amountCents: Cents;
    payDay: number;
    accountId?: string;
    savePct: number;
    investPct: number;
  };
  budgets: Record<string, Cents>; // categoryId -> limite mensal
  notifications: NotificationPrefs;
  api: {
    quoteProvider: 'brapi' | 'yahoo' | 'manual';
    dividendProvider: 'brapi' | 'yahoo' | 'manual';
    brapiToken: string;
    brapiPlan: 'free' | 'startup' | 'pro';
    lastQuoteRefresh?: string;
    lastDividendRefresh?: string;
  };
  lastBackupAt?: string;
  ai: {
    mode: 'local' | 'api';
    apiKey: string;
    model: string;
    consent: boolean; // autorização explícita para enviar um resumo dos dados ao serviço de IA
  };
  freedom: { yieldPct: number }; // rendimento anual que você assume para a meta de liberdade financeira
}
