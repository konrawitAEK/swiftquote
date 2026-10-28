import { describe, expect, it } from 'vitest'
import { formatMargin, formatSignedMoney, isLoss, margin, profitLine } from './measures'

describe('dashboard margin', () => {
  it('is "—" when cost + profit is 0 (no costed lines)', () => {
    expect(margin({ cost: 0, profit: 0 })).toBeNull()
    expect(formatMargin({ cost: 0, profit: 0 })).toBe('—')
    expect(profitLine({ cost: 0, profit: 0 })).toBe('Profit ฿0.00 · — margin')
  })

  it('is "—" when a loss cancels the cost exactly', () => {
    expect(formatMargin({ cost: 100, profit: -100 })).toBe('—')
  })

  it('is profit / (cost + profit)', () => {
    expect(margin({ cost: 750, profit: 250 })).toBe(0.25)
    expect(formatMargin({ cost: 750, profit: 250 })).toBe('25.0%')
    expect(profitLine({ cost: 750, profit: 250 })).toBe('Profit ฿250.00 · 25.0% margin')
  })

  it('shows a negative profit with a minus sign', () => {
    const m = { cost: 150, profit: -50 }
    expect(isLoss(m)).toBe(true)
    expect(formatMargin(m)).toBe('−50.0%')
    expect(formatSignedMoney(-50)).toBe('−฿50.00')
    expect(profitLine(m)).toBe('Profit −฿50.00 · −50.0% margin')
    expect(isLoss({ profit: 0 })).toBe(false)
  })

  it('rounds to one decimal place, half up', () => {
    expect(formatMargin({ cost: 2, profit: 1 })).toBe('33.3%')
    expect(formatMargin({ cost: 1, profit: 2 })).toBe('66.7%')
    expect(formatMargin({ cost: 87655, profit: 12345 })).toBe('12.3%')
    expect(formatMargin({ cost: 87645, profit: 12355 })).toBe('12.4%')
    expect(formatMargin({ cost: 1999, profit: 1 })).toBe('0.1%')
    expect(formatMargin({ cost: 0, profit: 500 })).toBe('100.0%')
  })

  it('drops the minus sign when a tiny loss rounds to zero', () => {
    expect(formatMargin({ cost: 100001, profit: -1 })).toBe('0.0%')
  })
})
