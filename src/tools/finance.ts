import { z } from 'zod'
import { FINANCE_CATEGORIES } from '../shared/finance'
import type { FinanceReport, FinanceTransaction, FinanceTransactionInput, ToolDef } from '../shared/types'
import { currencyFractionDigits, parseAmount, type FinanceStore } from '../core/finance'

const transactionInput = z.object({
  direction: z.enum(['income', 'expense']),
  amount: z.string().trim().regex(/^\d{1,14}(?:\.\d{1,8})?$/).describe('Decimal amount as text, for example "12.50".'),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).describe('Three-letter ISO currency code. Ask if it is not clear.'),
  category: z.enum(FINANCE_CATEGORIES),
  merchant: z.string().max(160).optional(),
  note: z.string().max(1000).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional()
})

const reportInput = z.object({ period: z.enum(['week', 'month']) })

export function createFinanceTools(store: FinanceStore): ToolDef<any, any>[] {
  const record: ToolDef<FinanceTransactionInput, FinanceTransaction> = {
    name: 'record_transaction',
    description:
      'Record an income or expense in the local ledger. Use only details stated by the user; ask for the currency/category if unclear. Recording always requires approval.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: transactionInput,
    scope(args) {
      const digits = currencyFractionDigits(args.currency)
      parseAmount(args.amount, digits)
      return { kind: 'none' }
    },
    async preview(args) {
      const direction = args.direction === 'income' ? 'Income' : 'Expense'
      const note = args.note?.trim() ? `\nNote: ${args.note.trim()}` : ''
      const merchant = args.merchant?.trim() ? `\nMerchant: ${args.merchant.trim()}` : ''
      return `${direction}: ${args.amount} ${args.currency.toUpperCase()}\nCategory: ${args.category}\nDate: ${args.occurredAt ?? 'now'}${merchant}${note}\n\nThis updates only the local ledger; no money will be moved.`
    },
    async run(args, context) {
      if (context.signal.aborted) throw new Error('The finance entry was cancelled.')
      return store.add(args)
    }
  }

  const report: ToolDef<{ period: 'week' | 'month' }, FinanceReport> = {
    name: 'finance_report',
    description:
      'Summarize local income and expenses for the current week or month, grouped by currency and category. Does not use bank accounts or move money.',
    risk: 'read',
    input: reportInput,
    async run(args) {
      return store.report(args.period)
    }
  }

  return [record, report]
}
