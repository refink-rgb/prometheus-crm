import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { phaseAllocation } from './phase-allocation'
import { CATEGORIES, type Allocation } from './model'

const allocation = (values: number[]): Allocation => Object.fromEntries(CATEGORIES.map((c, i) => [c.id, values[i]])) as Allocation
const split = (values: number[], prePercent: number, noPreBf = false) => phaseAllocation({ allocation: allocation(values), prePercent, noPreBf })

test('fractional rows use stable largest remainders and reconcile to the rounded overall phase', () => {
  const result = split([1, 1, 1, 1, 1], 50)
  assert.equal(result.pre, 3)
  assert.deepEqual(result.rows.map(r => r.pre), [1, 1, 1, 0, 0])
  assert.deepEqual(result.rows.map(r => r.bf), [0, 0, 0, 1, 1])
  assert.equal(result.groups[0].pre, 3)
  assert.equal(result.groups[1].bf, 2)
})

test('highest fractional remainder wins rather than category order except on ties', () => {
  const result = split([1, 2, 3, 4, 5], 33)
  assert.deepEqual(result.rows.map(r => r.pre), [0, 1, 1, 1, 2])
  assert.equal(result.pre, 5)
  assert.equal(result.bf, 10)
})

test('all percentages, odd allocations and zero rows reconcile row, group and grand totals', () => {
  for (const values of [[0, 0, 0, 0, 0], [1, 3, 7, 11, 13], [15, 45, 100, 10, 30], [100001, 99999, 0, 17, 3]]) {
    for (let percent = 0; percent <= 100; percent++) {
      const result = split(values, percent)
      const total = values.reduce((a, b) => a + b, 0)
      assert.equal(result.pre, Math.round(total * percent / 100))
      assert.equal(result.pre + result.bf, total)
      assert.equal(result.rows.reduce((sum, r) => sum + r.pre, 0), result.pre)
      assert.equal(result.rows.reduce((sum, r) => sum + r.bf, 0), result.bf)
      assert.equal(result.groups.reduce((sum, g) => sum + g.pre, 0), result.pre)
      assert.equal(result.groups.reduce((sum, g) => sum + g.bf, 0), result.bf)
      for (const row of result.rows) {
        assert.ok(Number.isInteger(row.pre) && Number.isInteger(row.bf))
        assert.ok(row.pre >= 0 && row.bf >= 0)
        assert.equal(row.pre + row.bf, row.total)
      }
      for (const group of result.groups) {
        assert.equal(group.pre, group.rows.reduce((sum, r) => sum + r.pre, 0))
        assert.equal(group.bf, group.rows.reduce((sum, r) => sum + r.bf, 0))
        assert.equal(group.pre + group.bf, group.total)
      }
    }
  }
})

test('no pre-BF assigns every row to BF without overwriting saved split or allocations', () => {
  const snapshot = { allocation: allocation([7, 9, 13, 17, 21]), prePercent: 37, noPreBf: true }
  const before = structuredClone(snapshot)
  const result = phaseAllocation(snapshot)
  assert.equal(result.prePercent, 0)
  assert.equal(result.pre, 0)
  assert.equal(result.bf, 67)
  assert.ok(result.rows.every(r => r.pre === 0 && r.bf === r.total))
  assert.deepEqual(snapshot, before)
  assert.equal(phaseAllocation({ ...snapshot, noPreBf: false }).pre, 25)
})

test('invalid arithmetic inputs fail explicitly', () => {
  for (const percent of [-1, 101, NaN, 33.5]) assert.throws(() => split([1, 2, 3, 4, 5], percent))
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => split([count, 0, 0, 0, 0], 50))
})
