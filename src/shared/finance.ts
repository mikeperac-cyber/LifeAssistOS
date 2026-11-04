export const FINANCE_CATEGORIES = [
  'salary',
  'freelance',
  'interest',
  'investment',
  'gift',
  'refund',
  'housing',
  'utilities',
  'groceries',
  'transport',
  'healthcare',
  'dining',
  'education',
  'subscriptions',
  'shopping',
  'travel',
  'taxes',
  'fees',
  'other'
] as const

export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number]

export const INCOME_CATEGORIES: readonly FinanceCategory[] = [
  'salary', 'freelance', 'interest', 'investment', 'gift', 'refund', 'other'
]

export const EXPENSE_CATEGORIES: readonly FinanceCategory[] = [
  'housing', 'utilities', 'groceries', 'transport', 'healthcare', 'dining',
  'education', 'subscriptions', 'shopping', 'travel', 'taxes', 'fees', 'other'
]

export const FINANCE_CATEGORY_LABELS: Record<FinanceCategory, string> = {
  salary: 'Salary',
  freelance: 'Freelance',
  interest: 'Interest',
  investment: 'Investment',
  gift: 'Gift',
  refund: 'Refund',
  housing: 'Housing',
  utilities: 'Utilities',
  groceries: 'Groceries',
  transport: 'Transport',
  healthcare: 'Healthcare',
  dining: 'Dining',
  education: 'Education',
  subscriptions: 'Subscriptions',
  shopping: 'Shopping',
  travel: 'Travel',
  taxes: 'Taxes',
  fees: 'Fees',
  other: 'Other'
}
