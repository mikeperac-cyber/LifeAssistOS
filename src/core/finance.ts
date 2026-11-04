import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { FINANCE_CATEGORIES } from '../shared/finance'
import type { FinanceCategory } from '../shared/finance'
import type {
  FinanceCategoryTotal,
  FinanceCurrencyTotals,
  FinanceDirection,
  FinanceReport,
  FinanceTransaction,
  FinanceTransactionInput
} from '../shared/types'

interface TransactionRow {
  id: string
  direction: FinanceDirection
  amount_minor: number
  currency: string
  fraction_digits: number
  category: FinanceCategory
  merchant: string
  note: string
  occurred_at: string
  created_at: string
}

interface TotalsRow {
  currency: string
  fraction_digits: number
  income_minor: number
  expense_minor: number
  transaction_count: number
}

interface CategoryRow {
  direction: FinanceDirection
  category: FinanceCategory
  currency: string
  fraction_digits: number
  amount_minor: number
  transaction_count: number
}

export class FinanceStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) {
    this.db = new DatabaseSync(file)
  }

  async init(): Promise<void> {
    if (this.closed) {
      this.db = new DatabaseSync(this.file)
      this.closed = false
    }
    await mkdir(path.dirname(this.dbPath), { recursive: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL,
        fraction_digits INTEGER NOT NULL CHECK (fraction_digits BETWEEN 0 AND 4),
        category TEXT NOT NULL,
        merchant TEXT NOT NULL,
        note TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS transactions_occurred_at ON transactions(occurred_at);
    `)
  }

  private get dbPath(): string {
    const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ? path.dirname(row.file) : process.cwd()
  }

  add(input: FinanceTransactionInput): FinanceTransaction {
    const direction = input.direction
    if (direction !== 'income' && direction !== 'expense') throw new Error('Choose income or expense.')

    const currency = input.currency.trim().toUpperCase()
    const fractionDigits = currencyFractionDigits(currency)
    const amountMinor = parseAmount(input.amount, fractionDigits)
    const category = input.category
    if (!FINANCE_CATEGORIES.includes(category)) throw new Error('Choose a valid finance category.')

    const occurredAt = input.occurredAt ? parseDate(input.occurredAt) : new Date().toISOString()
    const merchant = (input.merchant ?? '').trim().slice(0, 160)
    const note = (input.note ?? '').trim().slice(0, 1000)
    const transaction: FinanceTransaction = {
      id: randomUUID(),
      direction,
      amountMinor,
      currency,
      fractionDigits,
      category,
      merchant,
      note,
      occurredAt,
      createdAt: new Date().toISOString()
    }

    this.db.prepare(`
      INSERT INTO transactions (
        id, direction, amount_minor, currency, fraction_digits, category,
        merchant, note, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transaction.id,
      transaction.direction,
      transaction.amountMinor,
      transaction.currency,
      transaction.fractionDigits,
      transaction.category,
      transaction.merchant,
      transaction.note,
      transaction.occurredAt,
      transaction.createdAt
    )

    return transaction
  }

  report(period: 'week' | 'month', now = new Date()): FinanceReport {
    const starts = periodStart(period, now)
    const endsAt = now.toISOString()

    const totalsRows = this.db.prepare(`
      SELECT
        currency,
        fraction_digits,
        SUM(CASE WHEN direction = 'income' THEN amount_minor ELSE 0 END) AS income_minor,
        SUM(CASE WHEN direction = 'expense' THEN amount_minor ELSE 0 END) AS expense_minor,
        COUNT(*) AS transaction_count
      FROM transactions
      WHERE occurred_at >= ? AND occurred_at <= ?
      GROUP BY currency, fraction_digits
      ORDER BY currency
    `).all(starts.toISOString(), endsAt) as unknown as TotalsRow[]

    const categoryRows = this.db.prepare(`
      SELECT direction, category, currency, fraction_digits,
             SUM(amount_minor) AS amount_minor, COUNT(*) AS transaction_count
      FROM transactions
      WHERE occurred_at >= ? AND occurred_at <= ?
      GROUP BY direction, category, currency, fraction_digits
      ORDER BY currency, direction, amount_minor DESC
    `).all(starts.toISOString(), endsAt) as unknown as CategoryRow[]

    const recentRows = this.db.prepare(`
      SELECT * FROM transactions
      WHERE occurred_at >= ? AND occurred_at <= ?
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT 50
    `).all(starts.toISOString(), endsAt) as unknown as TransactionRow[]

    const totals: FinanceCurrencyTotals[] = totalsRows.map((row) => ({
      currency: row.currency,
      fractionDigits: row.fraction_digits,
      incomeMinor: row.income_minor,
      expenseMinor: row.expense_minor,
      netMinor: row.income_minor - row.expense_minor,
      transactionCount: row.transaction_count
    }))
    const byCategory: FinanceCategoryTotal[] = categoryRows.map((row) => ({
      direction: row.direction,
      category: row.category,
      currency: row.currency,
      fractionDigits: row.fraction_digits,
      amountMinor: row.amount_minor,
      transactionCount: row.transaction_count
    }))

    return {
      period,
      startsAt: starts.toISOString(),
      endsAt,
      totals,
      byCategory,
      recent: recentRows.map(fromRow)
    }
  }

  async backupTo(file: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    await backup(this.db, file)
  }

  exportCsv(): string {
    const rows = this.db
      .prepare('SELECT * FROM transactions ORDER BY occurred_at DESC, created_at DESC')
      .all() as unknown as TransactionRow[]

    const header = 'direction,amount,currency,category,merchant,note,occurredAt'
    const lines = rows.map((row) => {
      const amount = formatMinorAmount(row.amount_minor, row.fraction_digits)
      return [
        escapeCsvCell(row.direction),
        escapeCsvCell(amount),
        escapeCsvCell(row.currency),
        escapeCsvCell(row.category),
        escapeCsvCell(row.merchant),
        escapeCsvCell(row.note),
        escapeCsvCell(row.occurred_at)
      ].join(',')
    })
    return [header, ...lines].join('\n') + '\n'
  }

  importCsv(rawCsv: string): number {
    const rows = parseCsvRows(rawCsv).filter((row) => row.some((cell) => cell.trim().length > 0))
    if (rows.length === 0) return 0

    let startIndex = 0
    if (rows[0][0]?.replace(/^\uFEFF/, '').trim().toLowerCase() === 'direction') {
      startIndex = 1
    }

    let count = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (let i = startIndex; i < rows.length; i += 1) {
        const cells = rows[i]
        if (cells.length < 4) {
          throw new Error(`CSV row ${i + 1} must include the four required columns: direction, amount, currency, and category.`)
        }
        if (cells.length > 7) throw new Error(`CSV row ${i + 1} has more than seven columns.`)
        const [direction, amount, currency, category, merchant, note, occurredAt] = cells
        this.add({
          direction: direction as FinanceDirection,
          amount,
          currency,
          category: category as FinanceCategory,
          merchant: merchant || undefined,
          note: note || undefined,
          occurredAt: occurredAt || undefined
        })
        count += 1
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the row validation error. */ }
      throw error
    }
    return count
  }

  close(): void {
    if (!this.closed) {
      this.db.close()
      this.closed = true
    }
  }
}

function formatMinorAmount(amountMinor: number, fractionDigits: number): string {
  if (fractionDigits === 0) return String(amountMinor)
  const factor = 10 ** fractionDigits
  const whole = Math.floor(amountMinor / factor)
  const frac = String(amountMinor % factor).padStart(fractionDigits, '0')
  return `${whole}.${frac}`
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i]
    if (inQuotes) {
      if (ch === '"' && csv[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(current)
      current = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1
      cells.push(current)
      rows.push(cells)
      cells = []
      current = ''
    } else {
      current += ch
    }
  }
  if (inQuotes) throw new Error('CSV contains an unterminated quoted field.')
  if (cells.length > 0 || current.length > 0) {
    cells.push(current)
    rows.push(cells)
  }
  return rows
}

export function currencyFractionDigits(currency: string): number {
  const normalized = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('Use a three-letter ISO currency code, such as TRY, EUR, or USD.')
  let digits: number
  try {
    digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalized
    }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    throw new Error(`"${normalized}" is not a supported currency code.`)
  }
  if (digits > 4) throw new Error('That currency has unsupported precision.')
  return digits
}

export function parseAmount(input: string, fractionDigits: number): number {
  const value = input.trim()
  const match = /^(\d{1,14})(?:\.(\d{1,8}))?$/.exec(value)
  if (!match) throw new Error('Enter a positive amount using digits and a decimal point, without separators.')

  const whole = BigInt(match[1])
  const fraction = match[2] ?? ''
  if (fraction.length > fractionDigits && /[1-9]/.test(fraction.slice(fractionDigits))) {
    throw new Error(`This currency supports at most ${fractionDigits} decimal places.`)
  }
  const fractionValue = BigInt((fraction.slice(0, fractionDigits) || '').padEnd(fractionDigits, '0') || '0')
  const multiplier = 10n ** BigInt(fractionDigits)
  const amountMinor = whole * multiplier + fractionValue

  if (amountMinor <= 0n || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Enter an amount greater than zero and within the supported range.')
  }
  return Number(amountMinor)
}

function periodStart(period: 'week' | 'month', now: Date): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'month') {
    start.setDate(1)
  } else {
    const daysSinceMonday = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - daysSinceMonday)
  }
  return start
}

function parseDate(input: string): string {
  const date = new Date(input)
  if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid transaction date and time.')
  return date.toISOString()
}

function fromRow(row: TransactionRow): FinanceTransaction {
  return {
    id: row.id,
    direction: row.direction,
    amountMinor: row.amount_minor,
    currency: row.currency,
    fractionDigits: row.fraction_digits,
    category: row.category,
    merchant: row.merchant,
    note: row.note,
    occurredAt: row.occurred_at,
    createdAt: row.created_at
  }
}
