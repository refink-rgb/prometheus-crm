import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { getRevisionsByAsset } from '@/lib/revisions'
import { easternToday } from '@/lib/eastern'
import type { TrackedCampaign, LpTracking, FunnelDailyRow, LpAdMatch } from '@/lib/results'
import type { Project, Brand, CreativeAsset, ProjectComment, BrandDna, ProjectImage, Journey, BrandComment, BrandDocument, ProjectBrief } from '@/lib/types'
import PreviewProjectView, { type BrandLandingPage } from '@/components/preview/PreviewProjectView'

// PREVIEW ROUTE — deliberately not in the sidebar nav.
//
// This renders the editors' proposed tabbed layout against REAL data so the
// structure can be judged before anything is changed on the live project page.
//
// It is NOT read-only any more. The review workspace writes for real — statuses,
// client visibility, published versions, revision uploads all hit the same rows
// the live app reads. The banner in the view says which controls are live and
// which are still inert; keep it accurate.
// Deleting this folder + src/components/preview removes the whole experiment.
// Matches the page this replaces. AI revision actions (gpt-image-2) run 60-90s,
// fetchProductThumbnails walks a storefront sequentially, and Drive sync can be
// slow on a big folder — all of them are Server Actions invoked FROM this page,
// so the page's own limit is what governs them. Without it they are killed at
// the platform default and the work is lost after being paid for.
// A server component renders once per request, so reading the clock here is
// the point, not an impurity: the client needs server time to judge whether a
// brief's AI read (stamped with server time) is stale.
const serverClock = () => Date.now()

export default async function ProjectPage({ projectId }: { projectId: string }) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) redirect('/')

  const { data: projectRaw } = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (!projectRaw) notFound()
  const p = projectRaw as Project

  // One batch — everything keys off ids we already have.
  const [
    { data: brand },
    { data: assetsRaw },
    { data: commentsRaw },
    { data: imagesRaw },
    { data: dnaRaw },
    { data: journey },
    { data: brandJourneysRaw },
    { data: trackedCampaignsRaw },
    { data: brandLandingPagesRaw },
    { data: brandCommentsRaw },
    { data: brandDocumentsRaw },
    { data: projectBriefsRaw },
    profiles,
  ] = await Promise.all([
    supabase.from('brands').select('id, name, brand_notes, ai_sensitivity, brand_guidelines').eq('id', p.brand_id).single(),
    // ALL assets, hidden included. The page it replaces did the same. Filtering
    // here removed hidden creatives from the only screen that can un-hide them,
    // which turned a reversible soft-delete into a permanent one.
    supabase.from('creative_assets').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('project_comments').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('project_images').select('id, storage_url').eq('project_id', projectId),
    supabase.from('brand_dna').select('*').eq('brand_id', p.brand_id).eq('is_active', true).maybeSingle(),
    // Only for the brief export — the live page names the journey, so the
    // preview's copy has to as well or the two briefs differ.
    p.journey_id
      ? supabase.from('journeys').select('name').eq('id', p.journey_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // The edit form needs every journey for the brand, not just this project's.
    supabase.from('journeys').select('*').eq('brand_id', p.brand_id).order('created_at', { ascending: true }),
    // Same tolerant select the live page uses — the table may not exist yet.
    supabase
      .from('tracked_campaigns')
      .select('id, project_id, brand_id, meta_ad_account_id, meta_campaign_id, campaign_name, meta_adset_id, adset_name, moment_group_id, moment_group_label, launched_on, ended_on, created_at')
      .eq('project_id', projectId)
      .order('launched_on', { ascending: false }),
    // Every landing page this brand has. Cheap — one indexed brand_id lookup
    // over a 66-row table — and it is what turns the LP tab from "this page"
    // into "every page we have built for them".
    supabase
      .from('projects')
      .select('id, name, offer, lp_url, due_date, lp_stage')
      .eq('brand_id', p.brand_id)
      .not('lp_url', 'is', null)
      .order('due_date', { ascending: false, nullsFirst: false }),
    // The brand's context thread. Brand-level, so it is the same on every one of
    // this client's projects.
    supabase
      .from('brand_comments')
      .select('*')
      .eq('brand_id', p.brand_id)
      .order('created_at', { ascending: false }),
    // The brand's own files. Tolerant of the migration not having run yet:
    // supabase-js returns { data: null, error } rather than throwing, so the
    // panel renders its empty state instead of taking the page down.
    supabase
      .from('brand_documents')
      .select('*')
      .eq('brand_id', p.brand_id)
      .order('created_at', { ascending: false }),
    // The project's creative brief files. Tolerant of the migration not having
    // run: { data: null, error } becomes an empty list, never a crashed page.
    supabase
      .from('project_briefs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    getCachedProfiles(),
  ])

  const assets = (assetsRaw ?? []) as CreativeAsset[]
  const revisionsByAsset = await getRevisionsByAsset(supabase, assets.map(a => a.id))

  // Same idiom as /results/page.tsx: captured once per request, drives the
  // freshness stamp.
  const nowMs = new Date().getTime()

  // Results tab data (20260915_add_lp_results.sql). Sequential on purpose:
  // matches/daily rows key off the tracking row's id and account. Tolerant of
  // the migration not having run — supabase-js returns { data: null, error }
  // rather than throwing, and the tab renders its opt-in state.
  const { data: lpTrackingRaw } = await supabase
    .from('lp_tracking')
    .select('id, project_id, brand_id, meta_ad_account_id, lp_url, launched_on, ended_on, created_at')
    .eq('project_id', projectId)
    .maybeSingle()
  const lpTracking = (lpTrackingRaw ?? null) as LpTracking | null

  // Separate, tolerant read: the column arrives with migration
  // 20260915_lp_tracking_ux.sql, and selecting a missing column errors the
  // whole query — this one failing must not take the brand header down.
  const { data: brandAcctRaw } = await supabase
    .from('brands')
    .select('meta_ad_account_id')
    .eq('id', p.brand_id)
    .maybeSingle()
  const brandAdAccount = (brandAcctRaw as { meta_ad_account_id: string | null } | null)?.meta_ad_account_id ?? null

  const FUNNEL_COLUMNS =
    'stat_date, spend_cents, revenue_cents, purchases, impressions, link_clicks, ' +
    'initiate_checkouts, landing_page_views, source, warnings, reported_at'

  const [{ data: lpAdMatchesRaw }, { data: lpDailyRaw }, { data: accountDailyRaw }] = lpTracking
    ? await Promise.all([
        supabase
          .from('lp_ad_matches')
          .select('id, lp_tracking_id, meta_ad_id, ad_name, meta_campaign_id, campaign_name, meta_adset_id, adset_name, destination_url, status, source, first_seen_at')
          .eq('lp_tracking_id', lpTracking.id)
          .order('first_seen_at', { ascending: true }),
        supabase
          .from('lp_daily_results')
          .select(FUNNEL_COLUMNS)
          .eq('lp_tracking_id', lpTracking.id)
          .order('stat_date', { ascending: true }),
        // Bounded to the tracking window so the rest-of-account comparison
        // covers the same days as the LP's own rows. No launch date yet =
        // no window = nothing to compare (daily rows can't exist either).
        lpTracking.launched_on
          ? supabase
              .from('account_daily_results')
              .select(FUNNEL_COLUMNS)
              .eq('meta_ad_account_id', lpTracking.meta_ad_account_id)
              .gte('stat_date', lpTracking.launched_on)
              .order('stat_date', { ascending: true })
          : Promise.resolve({ data: null }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  return (
    <PreviewProjectView
      project={p}
      brand={brand as Brand}
      assets={assets}
      comments={(commentsRaw ?? []) as ProjectComment[]}
      images={(imagesRaw ?? []) as ProjectImage[]}
      dna={(dnaRaw ?? null) as BrandDna | null}
      revisionsByAsset={revisionsByAsset}
      lpEditorName={profiles.find(x => x.id === p.lp_editor_id)?.full_name ?? null}
      creativeEditorName={profiles.find(x => x.id === p.creative_editor_id)?.full_name ?? null}
      journeyName={(journey as { name: string } | null)?.name ?? null}
      journeys={(brandJourneysRaw ?? []) as Journey[]}
      brandLandingPages={(brandLandingPagesRaw ?? []) as BrandLandingPage[]}
      brandComments={(brandCommentsRaw ?? []) as BrandComment[]}
      brandDocuments={(brandDocumentsRaw ?? []) as BrandDocument[]}
      projectBriefs={(projectBriefsRaw ?? []) as ProjectBrief[]}
      serverNow={serverClock()}
      currentUserId={user.id}
      profiles={profiles}
      campaigns={(trackedCampaignsRaw ?? []) as unknown as TrackedCampaign[]}
      todayIso={easternToday()}
      authorName={profiles.find(x => x.email.toLowerCase() === (user.email ?? '').toLowerCase())?.full_name || user.email || 'Unknown'}
      lpTracking={lpTracking}
      lpAdMatches={(lpAdMatchesRaw ?? []) as unknown as LpAdMatch[]}
      lpDaily={(lpDailyRaw ?? []) as unknown as FunnelDailyRow[]}
      accountDaily={((accountDailyRaw ?? []) as unknown as FunnelDailyRow[])
        // The comparison must cover the same window as the LP's rows, so an
        // ended tracking's account series stops at the end date too.
        .filter(r => !lpTracking?.ended_on || r.stat_date <= lpTracking.ended_on)}
      nowMs={nowMs}
      brandAdAccount={brandAdAccount}
    />
  )
}
