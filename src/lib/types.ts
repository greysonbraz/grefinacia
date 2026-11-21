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

/** Dinheiro que só mudou de conta: não é receita nem despesa. */
export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: Cents; // sempre positivo
  date: ISODate;
  note?: string;
  createdAt: number;
  /** Conexão bancária: o outro lado fora do app (conta vazia ''): aplicação/resgate de investimento ou conta sua não cadastrada. */
  kind?: 'propria' | 'investimento' | 'cambio';
  /** Câmbio: já somado na conta em dólar (aba Dólar). */
  usdApplied?: boolean;
  importId?: string;
  fitId?: string;
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
  source?: 'dividend' | 'salary' | 'manual' | 'import';
  refId?: string; // id do provento, etc.
  notes?: string;
  boletoLine?: string; // linha digitável (só dígitos), quando a conta é um boleto
  importId?: string; // importação de extrato que criou o lançamento (para desfazer)
  fitId?: string; // identificador do banco para o lançamento (evita importar duas vezes)
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

/** Criptomoeda acompanhada pela CoinGecko (coinId é o identificador de lá, ex.: "bitcoin"). */
export interface CryptoAsset {
  id: string;
  coinId: string;
  symbol: string; // ex.: BTC
  name: string;
  quote?: Quote;
  manualPriceCents?: Cents;
}

/** Compra ou venda de cripto. A quantidade aceita frações (até 8 casas). */
export interface CryptoOperation {
  id: string;
  assetId: string;
  side: 'buy' | 'sell';
  quantity: number;
  priceCents: Cents; // preço de 1 unidade inteira da moeda, em reais
  feesCents: Cents;
  date: ISODate;
  broker: string; // corretora ou exchange
  accountId?: string;
  createdAt: number;
}

/** Ponto de uma série: data e valor (centavos para preços; % para índices). */
export type HistoryPoint = [ISODate, number];

/**
 * Histórico guardado no aparelho: preços de fechamento de um ativo ou valores de um índice (CDI, IPCA).
 * Cresce com o tempo: cada busca e cada cotação acrescentam pontos, então o histórico passa do limite da fonte.
 */
export interface MarketHistory {
  id: string; // ex.: "b3:PETR4", "cripto:bitcoin", "indice:CDI"
  kind: 'b3' | 'cripto' | 'indice';
  symbol: string;
  unit: 'cents' | 'pct' | 'brl' | 'pts'; // brl: reais por unidade (cotação do dólar); pts: pontos de índice
  points: HistoryPoint[]; // ordenado por data
  source: string;
  updatedAt: string; // última busca na fonte (ISO)
}

/** Uma importação de extrato (OFX ou CSV). Desfazer apaga os lançamentos que ela criou. */
export interface ImportBatch {
  id: string;
  createdAt: string; // ISO
  fileName: string;
  format: 'ofx' | 'csv' | 'pdf';
  bank?: string;
  accountId?: string; // extrato de conta
  cardId?: string; // fatura de cartão
  count: number;
  incomeCents: Cents;
  expenseCents: Cents;
  from: ISODate;
  to: ISODate;
  undoneAt?: string;
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
  receivedAt?: ISODate; // pagamento CONFIRMADO (por você ou pelo extrato); só isto conta como dinheiro recebido
  receivedTxId?: string;
  confirmedBy?: 'manual' | 'extrato';
  /** Cancelado pela fonte ou por você. O registro não é apagado: fica no histórico, fora dos totais. */
  cancelledAt?: string;
  cancelReason?: string;
  /** A fonte deixou de trazer o evento (pode ter sido corrigido ou cancelado). Não cancela sozinho: pede conferência. */
  missingSince?: string;
  /** Histórico de correções (valor, datas, cancelamento), da mais antiga para a mais nova. */
  revisions?: { at: string; source: string; text: string }[];
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
  cryptoCents?: Cents;
}

export interface FiredAlert {
  id: string; // chave de deduplicação
  at: number;
}

/** Dinheiro e investimentos em dólar (Etapa 15). Valores em centavos de dólar. */
export interface UsdHolding {
  id: string;
  kind: 'conta' | 'deposito' | 'bond' | 'fundo' | 'acao' | 'etf' | 'reit' | 'outro';
  name: string; // ex.: "Conta Global Inter", "Apple"
  ticker?: string; // ações/ETFs/REITs americanos (cotação pelo Yahoo Finance)
  quantity?: number;
  avgCostUsdCents?: number; // preço médio pago por unidade (centavos de dólar; aceita fração)
  balanceUsdCents?: number; // conta ou "outro": saldo informado por você
  priceUsdCents?: number; // última cotação
  priceTime?: string;
  changePct?: number;
  /** Renda fixa em dólar (Time Deposit / Porquinho): valor aplicado, taxa ao ano, aplicação e vencimento. */
  appliedUsdCents?: number;
  ratePct?: number;
  startDate?: ISODate;
  maturityDate?: ISODate;
  updatedAt: string;
}

/** Investimento lido do banco pela conexão (Etapa 14). É uma foto da posição, atualizada a cada sincronização. */
export interface BankInvestment {
  id: string; // id da Pluggy
  itemId: string;
  bankName: string;
  name: string;
  code?: string; // ticker (ações/FII/ETF) ou CNPJ (fundos)
  isin?: string;
  type: string; // FIXED_INCOME, EQUITY, MUTUAL_FUND, SECURITY, ETF, COE
  subtype?: string; // CDB, LCI, TREASURY, STOCK, REAL_ESTATE_FUND...
  balanceCents: Cents; // valor líquido hoje (depois de IR e IOF)
  grossCents: Cents; // valor bruto
  originalCents?: Cents; // valor aplicado, quando o banco informa
  quantity?: number;
  unitCents?: Cents;
  dueDate?: ISODate;
  issuer?: string;
  rate?: number;
  rateType?: string;
  fixedAnnualRate?: number;
  date?: ISODate; // data de referência do valor
  status?: string; // ACTIVE, PENDING, TOTAL_WITHDRAWAL
  /** Conta no patrimônio? Fica de fora quando o mesmo ativo já está cadastrado à mão (para não contar em dobro). */
  /** Moeda do investimento; sem valor = reais. Em dólar, os valores estão em centavos de dólar. */
  currency?: string;
  counted: boolean;
  countedReason?: 'auto' | 'manual-duplicado' | 'voce';
  updatedAt: string;
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
  transfers: Transfer[];
  cryptoAssets: CryptoAsset[];
  cryptoOps: CryptoOperation[];
  marketHistory: MarketHistory[];
  imports: ImportBatch[];
  bankInvestments: BankInvestment[];
  usdHoldings: UsdHolding[];
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
    /** Fatura do cartão: vencimento e fechamento (lembretes próprios). */
    cardInvoice?: boolean;
    overdue: boolean;
    dividendAnnounced: boolean;
    dividendSoon: boolean;
    dividendReceived: boolean;
    dividendDataCom: boolean; // data-com chegando (último dia para ter direito)
    dividendChanged: boolean; // provento confirmado, alterado ou cancelado
    overBudget: boolean;
    lowBalance: boolean;
    goalReached: boolean;
    /** No dia 1, o resumo do mês que fechou. */
    monthlyReport?: boolean;
    backup: boolean;
  };
}

/**
 * Desafio financeiro. 'sem-gasto': ficar `days` dias sem gastar na categoria ('*' = qualquer gasto variável);
 * 'limite': gastar no máximo `limitCents` na categoria; 'guardar': guardar `targetCents` nos objetivos no período.
 */
export interface Challenge {
  id: string;
  kind: 'sem-gasto' | 'limite' | 'guardar';
  categoryId?: string;
  limitCents?: Cents;
  targetCents?: Cents;
  start: ISODate;
  days: number;
  createdAt: number;
}

export interface Settings {
  onboarded: boolean;
  theme: 'dark' | 'light' | 'system';
  /** Em que mês a compra no cartão conta como gasto: no da fatura (quando o dinheiro sai) ou no da compra. */
  cardMonth: 'fatura' | 'compra';
  /** Olho: esconde valores em todas as telas até tocar de novo. */
  hideValues: boolean;
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
    dividendProvider: 'auto' | 'brapi' | 'yahoo' | 'manual'; // auto: brapi no plano pago, Yahoo no gratuito
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
    nano: boolean; // usar o Gemini Nano do próprio aparelho para perguntas livres (experimental, desligado por padrão)
  };
  freedom: { yieldPct: number }; // rendimento anual que você assume para a meta de liberdade financeira
  news: { disabledSources: string[] }; // fontes de notícias desligadas pelo usuário
  /** Conexão bancária pelo Meu Pluggy (Open Finance, uso pessoal gratuito). */
  bank: {
    clientId: string; // segredo: só no cofre do aparelho
    clientSecret: string; // segredo: só no cofre do aparelho
    items: { itemId: string; label: string }[]; // um por banco conectado no Meu Pluggy
    /** Conta da Pluggy → onde os lançamentos entram no app. */
    links: Record<string, { kind: 'conta' | 'cartao' | 'ignorar'; id?: string }>;
    historyDays: number; // quanto histórico buscar na primeira vez
  };
  analysis: { ignoredDuplicates: string[] };
  /** Desafios financeiros que você aceitou (progresso calculado dos seus lançamentos reais). */
  challenges: Challenge[];
  importRules: { pattern: string; categoryId: string }[]; // "descrição contém" → categoria, aprendido nas importações // pares "idA|idB" que o usuário disse não serem cobrança em dobro
}
