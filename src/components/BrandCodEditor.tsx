'use client'

// Cost-of-delivery editor. One value per brand — it's a property of the
// business, not of a marketing moment — so editing it here changes contribution
// margin everywhere that brand appears.
//
// The two modes exist because agencies quote cost of delivery both ways, and
// picking the wrong one silently rescales every margin figure on the page. The
// component states the formula it will apply, so a wrong mode is visible before
// it's saved rather than after someone quotes the number.

import { useState } from 'react'
import { setBrandCod } from '@/lib/results-actions'
import SubmitButton from '@/components/SubmitButton'
import {
  formatCents,
  formatRoas,
  breakEvenRoas,
  type BrandCod,
  type CodMode,
} from '@/lib/results'

export default function BrandCodEditor({
  brandId,
  brandName,
  cod,
  canEdit,
}: {
  brandId: string
  brandName: string
  cod: BrandCod
  canEdit: boolean
}) {
  const [mode, setMode] = useState<CodMode>(cod.cod_mode)
  const [value, setValue] = useState<string>(cod.cod_value === null ? '' : String(cod.cod_value))
  const [open, setOpen] = useState(false)

  const parsed = value.trim() === '' ? null : Number(value.replace(/[$%,\s]/g, ''))
  const preview: BrandCod = {
    cod_value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    cod_mode: mode,
  }
  const be = breakEvenRoas(preview)

  const configured = cod.cod_value !== null

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
          }}>
            Cost of delivery · {brandName}
          </div>
          {configured ? (
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {cod.cod_mode === 'percent'
                ? `${cod.cod_value}% of revenue`
                : `${formatCents(Math.round((cod.cod_value as number) * 100))} per order`}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 460 }}>
              Not set — contribution margin shows as <strong>—</strong> until it is. It is deliberately
              not assumed to be zero, which would report gross profit as if delivery were free.
            </div>
          )}
          {configured && breakEvenRoas(cod) !== null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Break-even ROAS <strong>{formatRoas(breakEvenRoas(cod))}</strong> — below this, the
              campaign loses money.
            </div>
          )}
        </div>
        {canEdit && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : configured ? 'Edit' : 'Set COD'}
          </button>
        )}
      </div>

      {open && canEdit && (
        <form action={setBrandCod} style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border)' }}>
          <input type="hidden" name="brand_id" value={brandId} />

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 150 }}>
              <label htmlFor="cod_mode" style={LABEL}>How is it quoted?</label>
              <select
                id="cod_mode"
                name="cod_mode"
                value={mode}
                onChange={e => setMode(e.target.value as CodMode)}
                style={INPUT}
              >
                <option value="percent">Percent of revenue</option>
                <option value="per_order">Dollars per order</option>
              </select>
            </div>
            <div style={{ minWidth: 130 }}>
              <label htmlFor="cod_value" style={LABEL}>
                {mode === 'percent' ? 'Percent' : 'Per order'}
              </label>
              <input
                id="cod_value"
                name="cod_value"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={mode === 'percent' ? '35' : '18.50'}
                style={INPUT}
              />
            </div>
            <SubmitButton className="btn-primary btn-sm" pendingText="Saving…">
              Save
            </SubmitButton>
          </div>

          {/* The formula, spelled out with the values just entered. A wrong
              mode is far easier to catch here than in a margin number three
              screens away. */}
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 'var(--space-3)', lineHeight: 1.6 }}>
            {preview.cod_value === null ? (
              <>Leave blank and save to clear it — contribution margin goes back to <strong>—</strong>.</>
            ) : mode === 'percent' ? (
              <>
                CM = revenue − ({preview.cod_value}% × revenue) − ad spend.
                {be !== null && <> Break-even ROAS becomes <strong>{formatRoas(be)}</strong>.</>}
              </>
            ) : (
              <>
                CM = revenue − ({formatCents(Math.round(preview.cod_value * 100))} × purchases) − ad spend.
                {' '}Days with no purchase count contribute no delivery cost.
              </>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            Applies to every campaign for {brandName}, historical days included — it is recomputed at
            render, never stored on the daily rows.
          </div>
        </form>
      )}
    </div>
  )
}

const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3, display: 'block',
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '6px 9px',
  fontSize: 13,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
}
