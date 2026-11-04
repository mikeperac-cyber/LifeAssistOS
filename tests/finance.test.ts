import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FinanceStore, parseAmount } from '../src/core/finance'

let dir = ''
let file = ''
let finance: FinanceStore

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-finance-'))
  file = path.join(dir, 'finance.sqlite')
  finance = new FinanceStore(file)
  await finance.init()
})

afterEach(async () => {
  finance.close()
  await rm(dir, { recursive: true, force: true })
})

describe('FinanceStore', () => {
  it('records categorized income and expenses and aggregates by currency', () => {
    finance.add({
      direction: 'income', amount: '1200.00', currency: 'TRY', category: 'salary',
      merchant: 'Employer', occurredAt: '2026-11-10T09:00:00Z'
    })
    finance.add({
      direction: 'expense', amount: '52.75', currency: 'TRY', category: 'groceries',
      merchant: 'Market', note: 'Weekly shop', occurredAt: '2026-11-11T12:00:00Z'
    })
    finance.add({
      direction: 'expense', amount: '10.00', currency: 'USD', category: 'subscriptions',
      occurredAt: '2026-11-12T12:00:00Z'
    })

    const report = finance.report('month', new Date('2026-11-15T12:00:00Z'))
    expect(report.period).toBe('month')
    expect(report.totals).toEqual([
      expect.objectContaining({ currency: 'TRY', incomeMinor: 120000, expenseMinor: 5275, netMinor: 114725 }),
      expect.objectContaining({ currency: 'USD', incomeMinor: 0, expenseMinor: 1000, netMinor: -1000 })
    ])
    expect(report.byCategory).toHaveLength(3)
    expect(report.recent[1].merchant).toBe('Market')
    expect(report.recent[1].note).toBe('Weekly shop')
  })

  it('uses the current Monday as the start of a weekly report', () => {
    finance.add({
      direction: 'income', amount: '1', currency: 'EUR', category: 'other',
      occurredAt: '2026-11-07T12:00:00Z'
    })
    finance.add({
      direction: 'income', amount: '2', currency: 'EUR', category: 'other',
      occurredAt: '2026-11-10T12:00:00Z'
    })

    const report = finance.report('week', new Date('2026-11-15T12:00:00Z'))
    expect(report.totals[0].incomeMinor).toBe(200)
    expect(report.recent).toHaveLength(1)
  })

  it('preserves exact minor units and validates precision/currency', () => {
    expect(parseAmount('1.2300', 2)).toBe(123)
    expect(parseAmount('150', 0)).toBe(150)
    expect(() => parseAmount('1.001', 2)).toThrow(/decimal places/)
    expect(() => parseAmount('-3.00', 2)).toThrow(/positive amount/)
    expect(() => finance.add({
      direction: 'expense', amount: '1.00', currency: 'NOPE', category: 'other'
    })).toThrow(/three-letter ISO currency/)
  })

  it('persists the ledger across restarts', async () => {
    finance.add({ direction: 'expense', amount: '3.25', currency: 'EUR', category: 'dining' })
    finance.close()

    finance = new FinanceStore(file)
    await finance.init()
    expect(finance.report('month').totals[0].expenseMinor).toBe(325)
  })

  it('creates missing parent directories before opening a new database', async () => {
    const nested = new FinanceStore(path.join(dir, 'nested', 'deeper', 'finance.sqlite'))
    try {
      await nested.init()
      nested.add({ direction: 'income', amount: '1.00', currency: 'USD', category: 'other' })
      expect(nested.report('month').totals[0].incomeMinor).toBe(100)
    } finally {
      nested.close()
    }
  })

  it('exports transactions to CSV and imports them into another ledger', async () => {
    finance.add({
      direction: 'income',
      amount: '450.50',
      currency: 'EUR',
      category: 'salary',
      merchant: 'LB English, Ltd.',
      note: 'Autumn term "bonus"\nPaid in full',
      occurredAt: '2026-11-01T10:00:00.000Z'
    })
    const csv = finance.exportCsv()
    expect(csv).toContain('direction,amount,currency,category,merchant,note,occurredAt')
    expect(csv).toContain('"LB English, Ltd."')

    const secondFile = path.join(dir, 'second-finance.sqlite')
    const second = new FinanceStore(secondFile)
    await second.init()
    try {
      const imported = second.importCsv(csv)
      expect(imported).toBe(1)
      const report = second.report('month', new Date('2026-11-15T12:00:00Z'))
      expect(report.totals[0]).toMatchObject({
        currency: 'EUR',
        incomeMinor: 45050
      })
      expect(report.recent[0].merchant).toBe('LB English, Ltd.')
      expect(report.recent[0].note).toBe('Autumn term "bonus"\nPaid in full')
    } finally {
      second.close()
    }
  })

  it('does not partially import a CSV when a later row is invalid', () => {
    const csv = [
      'direction,amount,currency,category,merchant,note,occurredAt',
      'expense,12.50,USD,groceries,Market,Valid row,2026-11-01T10:00:00.000Z',
      'income,20.00,NOPE,salary,Employer,Invalid currency,2026-11-02T10:00:00.000Z'
    ].join('\n')

    expect(() => finance.importCsv(csv)).toThrow(/three-letter ISO currency code/i)
    expect(finance.report('month', new Date('2026-11-15T12:00:00Z')).totals).toEqual([])
  })

  it('rejects truncated non-empty CSV rows instead of silently skipping them', () => {
    const csv = [
      'direction,amount,currency,category,merchant,note,occurredAt',
      'expense,12.50,USD,groceries,Market,Valid row,2026-11-01T10:00:00.000Z',
      'income,20.00,EUR'
    ].join('\n')

    expect(() => finance.importCsv(csv)).toThrow(/row 3.*four required columns/i)
    expect(finance.report('month', new Date('2026-11-15T12:00:00Z')).totals).toEqual([])
  })
})
