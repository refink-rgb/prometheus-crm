'use client'

import { useRef, useState } from 'react'
import { generateMarketingReport, deleteMarketingReport } from '@/lib/marketing-actions'
import { extractReportFromCaseStudy } from '@/lib/case-study-import'
import { buildSlackMessage } from '@/lib/slackMessage'
import type { CaseStudy } from '@/data/case-studies/types'
import { caseStudyToInputs, type ReportInputs } from '@/data/case-studies/buildReport'
import MomentReportForm from './MomentReportForm'

export default function GenerateReportPanel({
  projectId,
  projectName,
  creativeCount,
  existingToken,
  existingUpdatedAt,
  existingData = null,
}: {
  projectId: string
  projectName: string
  creativeCount: number
  existingToken: string | null
  existingUpdatedAt: string | null
  existingData?: CaseStudy | null
}) {
  const [token, setToken] = useState<string | null>(existingToken)
  const [data, setData] = useState<CaseStudy | null>(existingData)
  const [mode, setMode] = useState<'idle' | 'form'>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'url' | 'slack' | null>(null)
  // Slots extracted from an uploaded case study, used to seed the form.
  const [imported, setImported] = useState<ReportInputs | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Parse the .docx in the browser (mammoth) and send only the text to the
  // server for structuring, so no file upload handling is needed.
  async function handleFile(file: File | undefined) {
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const mammoth = await import('mammoth/mammoth.browser')
      const buf = await file.arrayBuffer()
      const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
      const inputs = await extractReportFromCaseStudy(value)
      setImported(inputs)
      setMode('form')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that document.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const path = token ? `/showcase/${token}` : null
  const fullUrl = path && typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
  const slackText = token && data ? buildSlackMessage({ ...data, slug: token }, fullUrl ?? path!) : null

  async function handleSubmit(inputs: ReportInputs) {
    setSubmitting(true)
    setError(null)
    try {
      const { token: t, caseStudy } = await generateMarketingReport(projectId, inputs)
      setToken(t)
      setData(caseStudy)
      setMode('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate the report.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remove this report? The public link will stop working.')) return
    setSubmitting(true)
    try {
      await deleteMarketingReport(projectId)
      setToken(null)
      setData(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove the report.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copy(kind: 'url' | 'slack', text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2500)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{projectName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {token
              ? `Report live${existingUpdatedAt ? ` · updated ${new Date(existingUpdatedAt).toLocaleDateString()}` : ''}`
              : `${creativeCount} creative${creativeCount === 1 ? '' : 's'} · no report yet`}
          </div>
        </div>
        {mode === 'idle' && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            {token ? (
              <>
                <button className="btn-secondary btn-sm" onClick={() => setMode('form')} disabled={submitting}>
                  Edit / regenerate
                </button>
                <button className="btn-danger btn-sm" onClick={handleDelete} disabled={submitting}>
                  Remove
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => setMode('form')} style={{ fontSize: 13 }}>
                Generate marketing moment report
              </button>
            )}
            {/* Import path: hand it the written case study and it fills the form. */}
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
              className="btn-secondary btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={importing || submitting}
              title="Upload the case study .docx and it fills the report for you"
            >
              {importing ? 'Reading…' : '⬆ From case study (.docx)'}
            </button>
          </div>
        )}
      </div>

      {mode === 'idle' && error && (
        <div style={{ marginTop: 'var(--space-3)', color: 'var(--danger)', fontSize: 13 }}>{error}</div>
      )}

      {/* Result: link + slack message */}
      {mode === 'idle' && token && path && (
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' }}>
              {path}
            </div>
            <a href={path} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" style={{ flexShrink: 0 }}>
              Open ↗
            </a>
            <button className="btn-primary" style={{ fontSize: 13, flexShrink: 0, padding: '8px 16px' }} onClick={() => copy('url', fullUrl ?? path)}>
              {copied === 'url' ? '✓ Copied!' : 'Copy link'}
            </button>
          </div>

          {slackText && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Slack message
                </span>
                <button className="btn-secondary btn-sm" onClick={() => copy('slack', slackText)}>
                  {copied === 'slack' ? '✓ Copied!' : 'Copy message'}
                </button>
              </div>
              <pre style={{ margin: 0, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-3)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.5 }}>
                {slackText}
              </pre>
            </div>
          )}
        </div>
      )}

      {mode === 'form' && (
        <MomentReportForm
          key={imported ? 'imported' : 'manual'}
          initial={imported ?? (data ? caseStudyToInputs(data) : undefined)}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => {
            setMode('idle')
            setError(null)
            setImported(null)
          }}
        />
      )}
    </div>
  )
}
