import { notFound } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canViewMomentCodes } from '@/lib/permissions'
import CodesTable, { type CodeRow } from '@/components/CodesTable'

// The master list of moment codes: brand, project, code.
//
// Management-only. Not because the codes are secret — they are typed into ad
// names in Meta all day — but because this page exists to audit coverage, and
// an editor seeing a list of every brand's every moment is noise they did not
// ask for.

export default async function CodesPage() {
  const user = await getCachedUser()
  // notFound, not a redirect: a 404 does not confirm the page exists.
  if (!canViewMomentCodes(user?.email)) notFound()

  const supabase = await createClient()
  const { data } = await supabase
    .from('projects')
    .select('id, name, moment_code, due_date, is_complete, brand_id, brands!inner(name)')
    .order('due_date', { ascending: false })

  const rows: CodeRow[] = (data ?? []).map(p => {
    const b = p.brands as unknown as { name: string } | { name: string }[]
    return {
      id: p.id,
      brandId: p.brand_id,
      brand: (Array.isArray(b) ? b[0]?.name : b?.name) ?? '—',
      project: p.name,
      code: p.moment_code,
      due: p.due_date,
      complete: p.is_complete,
    }
  })

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
        Moment codes
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, maxWidth: '70ch' }}>
        One code per project. Media buyers paste it into the ad set name and every ad name,
        which makes the whole moment findable in Ads Manager with one search.
      </p>
      <CodesTable rows={rows} />
    </div>
  )
}
