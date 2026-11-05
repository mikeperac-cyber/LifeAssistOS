import { useMemo, useState, type FormEvent } from 'react'
import type { FinanceReport, FinanceTransactionInput, ToolResult } from '../../../shared/types'
import {
  EXPENSE_CATEGORIES,
  FINANCE_CATEGORY_LABELS,
  INCOME_CATEGORIES,
  type FinanceCategory
} from '../../../shared/finance'

type Period = 'week' | 'month'

interface FinanceViewProps {
  report: FinanceReport | null
  period: Period
  loading: boolean
  disabled: boolean
  onPeriodChange: (period: Period) => void
  onRefresh: () => void
  onAdd: (input: FinanceTransactionInput) => Promise<ToolResult>
}

export function FinanceView({
  report,
  period,
  loading,
  disabled,
  onPeriodChange,
  onRefresh,
  onAdd
}: FinanceViewProps): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false)
  const [direction, setDirection] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [category, setCategory] = useState<FinanceCategory>('other')
  const [merchant, setMerchant] = useState('')
  const [note, setNote] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const categories = direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const categoryTotals = useMemo(() => report?.byCategory ?? [], [report])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const input: FinanceTransactionInput = {
      direction,
      amount: amount.trim(),
      currency: currency.trim().toUpperCase(),
      category,
      merchant: merchant.trim() || undefined,
      note: note.trim() || undefined,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined
    }

    try {
      const result = await onAdd(input)
      if (result.ok) {
        setMessage({ ok: true, text: 'Entry recorded after approval.' })
        setAmount('')
        setMerchant('')
        setNote('')
        setOccurredAt('')
      } else {
        setMessage({ ok: false, text: result.error ?? (result.denied ? 'Entry was not recorded.' : 'Could not record entry.') })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  async function exportCsv(): Promise<void> {
    setMessage(null)
    try {
      const result = await window.assist.exportFinanceCsv()
      if (result.ok && result.fileName) setMessage({ ok: true, text: `Exported ${result.fileName}.` })
      else if (!result.cancelled) setMessage({ ok: false, text: result.error ?? 'Could not export the finance ledger.' })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  }

  async function importCsv(): Promise<void> {
    setMessage(null)
    try {
      const result = await window.assist.importFinanceCsv()
      if (result.ok) {
        setMessage({ ok: true, text: `Imported ${result.imported ?? 0} transaction(s).` })
        onRefresh()
      } else if (!result.cancelled && result.error) {
        setMessage({ ok: false, text: result.error })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  }

  function setDirectionAndCategory(next: 'income' | 'expense'): void {
    setDirection(next)
    const allowed = next === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
    if (!allowed.includes(category)) setCategory(allowed[0])
  }

  return (
    <div className="finance-view">
      <section className="finance-toolbar">
        <div>
          <div className="eyebrow">LOCAL LEDGER</div>
          <h2>Income &amp; expenditure</h2>
          <p>Entries stay on this device. Reports keep currencies separate (no exchange-rate conversion). Each addition asks for approval; this does not connect to a bank or move money.</p>
        </div>
        <div className="finance-toolbar-actions">
          <select
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as Period)}
            aria-label="Reporting period"
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
          <button
            className="ghost-button"
            type="button"
            disabled={disabled}
            onClick={() => void exportCsv()}
          >
            Export CSV
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={disabled}
            onClick={() => void importCsv()}
          >
            Import CSV
          </button>
          <button className="primary-button" type="button" disabled={disabled} onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? 'Close form' : 'Add entry'}
          </button>
        </div>
      </section>

      {formOpen && (
        <form className="finance-entry-form" onSubmit={(event) => void submit(event)}>
          <div className="finance-form-grid">
            <label className="field">
              <span className="field-label">Type</span>
              <select value={direction} onChange={(event) => setDirectionAndCategory(event.target.value as 'income' | 'expense')}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Amount</span>
              <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
            </label>
            <label className="field">
              <span className="field-label">Currency</span>
              <input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="TRY / EUR / USD" />
            </label>
            <label className="field">
              <span className="field-label">Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as FinanceCategory)}>
                {categories.map((item) => <option key={item} value={item}>{FINANCE_CATEGORY_LABELS[item]}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Date and time</span>
              <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Merchant / source</span>
              <input maxLength={160} value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="Optional" />
            </label>
            <label className="field field-wide">
              <span className="field-label">Note</span>
              <input maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional details" />
            </label>
          </div>
          <div className="settings-actions">
            <button className="primary-button" type="submit" disabled={disabled || saving}>
              {saving ? 'Waiting for approval…' : 'Review entry'}
            </button>
            {message && <span className={`settings-status ${message.ok ? 'status-ok' : 'status-error'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</span>}
          </div>
        </form>
      )}

      {loading && <div className="finance-empty" role="status">Loading report…</div>}
      {!loading && report && report.totals.length === 0 && (
        <div className="finance-empty">No transactions recorded for this {period}. Add an entry or ask Mike Assist to record one.</div>
      )}

      {!loading && report && report.totals.length > 0 && (
        <>
          <div className="finance-totals">
            {report.totals.map((total) => (
              <article className="finance-total-card" key={total.currency}>
                <span className="finance-currency">{total.currency} · {total.transactionCount} entries</span>
                <div className="finance-total-row"><span>Income</span><strong className="finance-income">{money(total.incomeMinor, total.currency, total.fractionDigits)}</strong></div>
                <div className="finance-total-row"><span>Expenses</span><strong className="finance-expense">{money(total.expenseMinor, total.currency, total.fractionDigits)}</strong></div>
                <div className="finance-total-row finance-net"><span>Net</span><strong>{money(total.netMinor, total.currency, total.fractionDigits)}</strong></div>
              </article>
            ))}
          </div>

          <section className="finance-section">
            <h3>Categories</h3>
            <div className="finance-category-list">
              {categoryTotals.map((row) => (
                <div className="finance-category-row" key={`${row.direction}-${row.currency}-${row.category}`}>
                  <span className={`finance-direction-dot ${row.direction}`} />
                  <span className="finance-category-name">{FINANCE_CATEGORY_LABELS[row.category]}</span>
                  <span className="finance-category-count">{row.transactionCount}</span>
                  <strong>{money(row.amountMinor, row.currency, row.fractionDigits)}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="finance-section">
            <h3>Recent entries</h3>
            <div className="finance-transactions">
              {report.recent.map((transaction) => (
                <article className="finance-transaction" key={transaction.id}>
                  <div>
                    <strong>{FINANCE_CATEGORY_LABELS[transaction.category]}</strong>
                    <span>{[transaction.merchant, transaction.note].filter(Boolean).join(' · ') || transaction.direction}</span>
                  </div>
                  <time dateTime={transaction.occurredAt}>{new Date(transaction.occurredAt).toLocaleDateString()}</time>
                  <strong className={transaction.direction === 'income' ? 'finance-income' : 'finance-expense'}>
                    {transaction.direction === 'income' ? '+' : '−'}{money(transaction.amountMinor, transaction.currency, transaction.fractionDigits)}
                  </strong>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function money(amountMinor: number, currency: string, fractionDigits: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(amountMinor / 10 ** fractionDigits)
}
