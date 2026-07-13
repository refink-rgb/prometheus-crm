import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Brand, PipelineStatus } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER } from '@/lib/types'

function calcMonths(startDate: string): number {
  const start = new Date(startDate)
  const now = new Date()
  return Math.max(0,
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) + 1
  )
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

const BD_COLORS: Record<PipelineStatus, string> = {
  intro_contact:  'var(--bd-intro)',
  discovery_call: 'var(--bd-discovery)',
  offer_prep:     'var(--bd-offer)',
  active:         'var(--bd-active)',
}

export default async function FinancialsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!canEdit(user?.email)) {
    redirect('/')
  }

  // Financials only reads these fields — avoid pulling large TEXT columns
  // (onboarding_transcript, brand_notes, client_token, etc.) on this page.
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, is_active, is_trial, monthly_retainer, start_date, pipeline_status')
    .order('monthly_retainer', { ascending: false, nullsFirst: false })

  const allBrands = (brands ?? []) as Pick<Brand, 'id' | 'name' | 'is_active' | 'is_trial' | 'monthly_retainer' | 'start_date' | 'pipeline_status'>[]
  const billableClients = allBrands
    .filter(b => (b.monthly_retainer ?? 0) > 0)
    .sort((a, b) => (b.monthly_retainer ?? 0) - (a.monthly_retainer ?? 0))
  const activeClients = billableClients.filter(b => b.is_active)

  const mrr = activeClients.reduce((sum, b) => sum + (b.monthly_retainer ?? 0), 0)
  const revenueToDate = activeClients.reduce((sum, b) => {
    if (!b.start_date) return sum
    return sum + calcMonths(b.start_date) * (b.monthly_retainer ?? 0)
  }, 0)

  const now = new Date()
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // BD pipeline value grouped by stage
  const bdStages = PIPELINE_STATUS_ORDER.map(status => {
    const brandsInStage = allBrands.filter(b => b.pipeline_status === status)
    const potentialMRR = brandsInStage.reduce((sum, b) => sum + (b.monthly_retainer ?? 0), 0)
    return { status, brands: brandsInStage, potentialMRR }
  })

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Financials
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {monthLabel}
        </p>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
        <FinKPI label="Monthly Recurring Revenue" value={fmtCurrency(mrr)} sub={`${activeClients.length} active client${activeClients.length !== 1 ? 's' : ''}`} tone="accent" />
        <FinKPI label="Revenue to Date" value={fmtCurrency(revenueToDate)} sub={revenueToDate > 0 ? 'based on retainer start dates' : 'set start dates on each brand'} />
        <FinKPI label="Next Month Forecast" value={fmtCurrency(mrr)} sub="based on current retainers" />
      </div>

      {/* Client Revenue Table */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
          Client Revenue
        </h2>

        {billableClients.length === 0 ? (
          <div style={{ padding: '24px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
            No retainers set yet — open a brand and fill in Monthly Retainer + Start Date.
          </div>
        ) : (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px 100px', gap: 16, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
              {['Brand', 'Billing Status', 'MRR', 'Started'].map(col => (
                <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{col}</span>
              ))}
            </div>
            {billableClients.map((b, i) => {
              const statusPill = b.is_trial
                ? { label: 'Trial',    color: 'var(--warning)' }
                : b.is_active
                  ? { label: 'Active',   color: 'var(--success)' }
                  : { label: 'Inactive', color: 'var(--danger)' }
              return (
                <div key={b.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 120px 100px',
                  gap: 16,
                  padding: '12px 20px',
                  borderBottom: i < billableClients.length - 1 ? '1px solid var(--border)' : 'none',
                  alignItems: 'center',
                  opacity: b.is_active ? 1 : 0.55,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: statusPill.color,
                    background: `color-mix(in srgb, ${statusPill.color} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${statusPill.color} 30%, transparent)`,
                    padding: '2px 10px', borderRadius: 20, width: 'fit-content',
                  }}>
                    {statusPill.label}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {fmtCurrency(b.monthly_retainer ?? 0)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {b.start_date
                      ? new Date(b.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                      : '—'}
                  </span>
                </div>
              )
            })}
            {/* Total row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 140px 120px 100px',
              gap: 16,
              padding: '14px 20px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-raised)',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Total MRR
              </span>
              <span />
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>
                {fmtCurrency(mrr)}
              </span>
              <span />
            </div>
          </div>
        )}
      </section>

      {/* BD Pipeline Value */}
      <section>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
          BD Pipeline Value
        </h2>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 160px', gap: 16, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
            {['Stage', 'Brands', 'Potential MRR'].map(col => (
              <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{col}</span>
            ))}
          </div>
          {bdStages.map((s, i) => {
            const color = BD_COLORS[s.status]
            return (
              <div key={s.status} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 100px 160px',
                gap: 16,
                padding: '12px 20px',
                borderBottom: i < bdStages.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}>
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color,
                  letterSpacing: '0.04em',
                }}>
                  {PIPELINE_STATUS_LABELS[s.status]}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {s.brands.length}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: s.potentialMRR > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {fmtCurrency(s.potentialMRR)}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function FinKPI({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'accent'
}) {
  const bg = tone === 'accent' ? 'color-mix(in srgb, var(--accent) 8%, var(--surface-1))' : 'var(--surface-1)'
  const border = tone === 'accent' ? 'color-mix(in srgb, var(--accent) 30%, var(--border))' : 'var(--border)'
  const color = tone === 'accent' ? 'var(--accent)' : 'var(--text-primary)'
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: '16px 20px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>
      )}
    </div>
  )
}
