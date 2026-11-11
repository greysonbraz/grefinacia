import type { Category } from './types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'moradia', name: 'Moradia', icon: 'Home', type: 'expense' },
  { id: 'contas', name: 'Contas (luz, água, internet)', icon: 'Zap', type: 'expense' },
  { id: 'mercado', name: 'Mercado', icon: 'ShoppingCart', type: 'expense' },
  { id: 'alimentacao', name: 'Alimentação fora', icon: 'Utensils', type: 'expense' },
  { id: 'transporte', name: 'Transporte', icon: 'Car', type: 'expense' },
  { id: 'saude', name: 'Saúde', icon: 'HeartPulse', type: 'expense' },
  { id: 'educacao', name: 'Educação', icon: 'GraduationCap', type: 'expense' },
  { id: 'lazer', name: 'Lazer', icon: 'Gamepad2', type: 'expense' },
  { id: 'assinaturas', name: 'Assinaturas', icon: 'Repeat', type: 'expense' },
  { id: 'compras', name: 'Compras', icon: 'ShoppingBag', type: 'expense' },
  { id: 'vestuario', name: 'Vestuário', icon: 'Shirt', type: 'expense' },
  { id: 'impostos', name: 'Impostos e taxas', icon: 'Landmark', type: 'expense' },
  { id: 'dividas', name: 'Dívidas e empréstimos', icon: 'HandCoins', type: 'expense' },
  { id: 'juros', name: 'Juros e encargos', icon: 'Percent', type: 'expense' },
  { id: 'presentes', name: 'Presentes e doações', icon: 'Gift', type: 'expense' },
  { id: 'outros_gasto', name: 'Outros', icon: 'CircleEllipsis', type: 'expense' },
  { id: 'salario', name: 'Salário', icon: 'Banknote', type: 'income' },
  { id: 'hora_extra', name: 'Horas extras', icon: 'Clock', type: 'income' },
  { id: 'adicionais', name: 'Adicionais', icon: 'PlusCircle', type: 'income' },
  { id: 'dividendos', name: 'Dividendos e rendimentos', icon: 'Coins', type: 'income' },
  { id: 'outros_rend', name: 'Outros rendimentos', icon: 'Wallet', type: 'income' },
];

export const KIND_LABEL: Record<string, string> = {
  salario: 'Salário',
  hora_extra: 'Horas extras',
  adicional: 'Adicional',
  outro_rendimento: 'Outro rendimento',
  fixa: 'Despesa fixa',
  variavel: 'Despesa variável',
  cartao: 'Compra no cartão',
  parcelada: 'Conta parcelada',
  assinatura: 'Assinatura',
};

export const KIND_DEFAULT_CATEGORY: Record<string, string> = {
  salario: 'salario',
  hora_extra: 'hora_extra',
  adicional: 'adicionais',
  outro_rendimento: 'outros_rend',
  fixa: 'moradia',
  variavel: 'mercado',
  cartao: 'compras',
  parcelada: 'compras',
  assinatura: 'assinaturas',
};

export const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Cartão de crédito',
  dinheiro: 'Dinheiro',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  outro: 'Outro',
};

/** Despesas que comprometem o orçamento todo mês (usadas no plano salarial). */
export const COMMITMENT_KINDS = ['fixa', 'assinatura', 'parcelada'];
