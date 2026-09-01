'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadRevisionFile } from '@/lib/upload-revision'
import { matchRevisionsToAssets, type MatchableAsset } from '@/lib/asset-match'

// Bulk revision upload. An editor fixes a batch in Photoshop and re-exports it
// under the original names; this maps each file back onto the asset it revises.
//
// Nothing uploads until the plan is confirmed. A revision lands on top of a
// creative the client may already have approved, so a wrong match is expensive
// and an unmatched file is cheap — the matcher stays conservative and anything
// it is not certain about is shown to a person instead of guessed at.

type Plan = {
  matched: Array<{ file: File; asset: MatchableAsset }>
  ambiguous: Array<{ file: File; candidates: MatchableAsset[]; chosen: string | null }>
  unmatched: File[]
}

const box: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 12,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 0',
  borderBottom: '1px solid var(--border)',
}

export default function BulkRevisionUpload({
  projectId, brandId, assets,
}: {
  projectId: string
  brandId: string
  assets: MatchableAsset[]
}) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<string[]>([])
  const [done, setDone] = useState<number | null>(null)

  function buildPlan(files: File[]) {
    setFailures([]); setDone(null)
    const r = matchRevisionsToAssets(files, assets)
    setPlan({
      matched: r.matched,
      ambiguous: r.ambiguous.map(a => ({ ...a, chosen: null })),
      unmatched: r.unmatched,
    })
  }

  // Everything the confirm button will actually send: clean hits plus any
  // ambiguity a person has since resolved.
  const queue = useMemo(() => {
    if (!plan) return []
    const resolved = plan.ambiguous
      .filter(a => a.chosen)
      .map(a => ({ file: a.file, asset: a.candidates.find(c => c.id === a.chosen)! }))
    return [...plan.matched, ...resolved]
  }, [plan])

  async function upload() {
    if (!queue.length) return
    setBusy(true); setFailures([]); setProgress({ done: 0, total: queue.length })
    const failed: string[] = []
    // Sequential: each upload writes a revision row, and a burst of parallel
    // writes against the same project is not worth the seconds it would save.
    for (let i = 0; i < queue.length; i++) {
      const { file, asset } = queue[i]
      try {
        const r = await uploadRevisionFile(file, asset.id, projectId, brandId)
        if (!r.ok) failed.push(`${file.name}: ${r.error}`)
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`)
      }
      setProgress({ done: i + 1, total: queue.length })
    }
    setFailures(failed)
    setDone(queue.length - failed.length)
    setBusy(false)
    setPlan(null)
    setProgress(null)
    router.refresh()
  }

  return (
    <div style={box}>
      {/* One compact row when idle. This is an occasional action, and as a
          full-width dashed panel it pushed the creatives themselves below the
          fold on every visit. The explanation moves to the point of use — it is
          only useful once you are looking at a plan. */}
      {!plan && (
        <label style={{ textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 8, cursor: busy ? 'wait' : 'pointer',
        }}>
          <input
            type="file" accept="image/*" multiple disabled={busy} style={{ display: 'none' }}
            onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) buildPlan(f) }}
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Upload a batch of revisions</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Re-export under the original filenames — each is matched to the creative it replaces.
          </span>
          <span style={{
            marginLeft: 'auto', flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '4px 12px',
            borderRadius: 6, border: '1px solid var(--border-strong)', color: 'var(--text-secondary)',
          }}>Choose files</span>
        </label>
      )}

      {done !== null && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', marginTop: 8 }}>
          {done} revision{done === 1 ? '' : 's'} uploaded. Each is now the latest edit — the client keeps
          seeing the published version until you send it.
        </div>
      )}

      {plan && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            Check the plan before uploading — nothing has been sent yet
          </div>
          {plan.matched.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>
                {plan.matched.length} matched
              </div>
              {plan.matched.map(m => (
                <div key={m.file.name} style={rowStyle}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.file.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{m.asset.name}</span>
                </div>
              ))}
            </div>
          )}

          {plan.ambiguous.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', marginBottom: 4 }}>
                {plan.ambiguous.length} need a choice
              </div>
              {plan.ambiguous.map((a, i) => (
                <div key={a.file.name} style={rowStyle}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file.name}</span>
                  <select
                    value={a.chosen ?? ''}
                    onChange={e => setPlan(p => p && ({
                      ...p,
                      ambiguous: p.ambiguous.map((x, j) => j === i ? { ...x, chosen: e.target.value || null } : x),
                    }))}
                    style={{ flex: 1, fontSize: 11 }}
                  >
                    <option value="">Skip this file</option>
                    {a.candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {plan.unmatched.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
                {plan.unmatched.length} unmatched — these will be skipped
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                No creative in this project has that filename. If it is a brand-new ad rather than a fix,
                add it with the normal upload instead.
              </div>
              {plan.unmatched.map(f => (
                <div key={f.name} style={{ ...rowStyle, color: 'var(--text-muted)' }}>{f.name}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button
              onClick={upload}
              disabled={busy || queue.length === 0}
              style={{
                padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: busy || !queue.length ? 'not-allowed' : 'pointer',
                border: '1px solid var(--accent)', background: queue.length ? 'var(--accent-muted)' : 'transparent',
                color: queue.length ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {busy && progress
                ? `Uploading ${progress.done} of ${progress.total}…`
                : `Upload ${queue.length} revision${queue.length === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => setPlan(null)} disabled={busy} style={{ padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {failures.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#EF4444' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{failures.length} failed</div>
          {failures.map(f => <div key={f}>{f}</div>)}
        </div>
      )}
    </div>
  )
}
