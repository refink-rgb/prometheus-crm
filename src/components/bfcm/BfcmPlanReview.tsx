'use client'

import { type ReactNode } from 'react'
import { type Brand, type PlanSnapshot, type StageOffer } from '@/lib/bfcm/model'
import { phaseAllocation } from '@/lib/bfcm/phase-allocation'
import type { MotionReference } from '@/lib/bfcm/content'
import styles from './BfcmPlanReview.module.css'

type ReviewFile = { id: string; name: string }
export type BfcmPlanReviewProps = {
  brand: Brand
  snapshot: PlanSnapshot
  motionReferences: MotionReference[]
  files: ReviewFile[]
  busy: boolean
  downloadFile: (file: ReviewFile) => void | Promise<void>
}

function httpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

/** React text nodes preserve the exact supplied text; only HTTP(S) URLs become links. */
function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const pattern = /https?:\/\/[^\s<>"']+/gi
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index!
    const candidate = match[0].replace(/[.,;:!?)}\]]+$/, '')
    parts.push(text.slice(cursor, start))
    parts.push(httpUrl(candidate)
      ? <a key={start} href={candidate} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{candidate}</a>
      : candidate)
    // Punctuation removed from a URL remains verbatim in the following text node.
    cursor = start + candidate.length
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

function TextValue({ value }: { value: string }) {
  return value ? <span className={styles.verbatim}><LinkedText text={value}/></span> : <span className={styles.muted}>Not provided</span>
}

function OfferReview({ offer, title, inactive = false }: { offer: StageOffer; title: string; inactive?: boolean }) {
  return <section className={styles.offer} aria-label={title}>
    <h4>{title}</h4>
    {inactive && <p className={styles.notice}>Retained information only — this phase is inactive and is not applied to the plan.</p>}
    <dl className={styles.fields}>
      <dt>Offer</dt><dd><TextValue value={offer.offer}/></dd>
      <dt>Start date</dt><dd><TextValue value={offer.startDate}/></dd>
      <dt>End date</dt><dd><TextValue value={offer.endDate}/></dd>
      <dt>Included products / collections</dt><dd>{offer.sitewide ? 'Sitewide' : <TextValue value={offer.included}/>}</dd>
      <dt>Exclusions</dt><dd>{offer.hasExclusions ? <TextValue value={offer.exclusions}/> : 'No exclusions'}</dd>
    </dl>
    {offer.sitewide && offer.included && <div className={styles.retained}><strong>Retained inclusions — not applied (sitewide selected)</strong><p className={styles.verbatim}><LinkedText text={offer.included}/></p></div>}
    {!offer.hasExclusions && offer.exclusions && <div className={styles.retained}><strong>Retained exclusions — not applied (exclusions disabled)</strong><p className={styles.verbatim}><LinkedText text={offer.exclusions}/></p></div>}
  </section>
}

/** A read-only view of precisely the supplied snapshot, including historical versions. */
export default function BfcmPlanReview({ brand, snapshot, motionReferences, files, busy, downloadFile }: BfcmPlanReviewProps) {
  const phases = phaseAllocation(snapshot)
  const { prePercent } = phases
  const globalApproval = snapshot.approvedCopiesRevision !== null && snapshot.approvedCopiesRevision === snapshot.copyRevision
  const fileIds = snapshot.fileIds ?? []
  const notes = snapshot.notes ?? ''
  const sources = { 'BF anterior': 'Previous BF', Recente: 'Recent', Nova: 'New' } as const

  return <div className={styles.review}>
    <section className={styles.section} aria-label="Creative allocation">
      <h3>Creative allocation</h3>
      <p className={styles.muted}>Based on the plan’s phase split.</p>
      <div className={styles.columns}>
        {phases.groups.map(group => <div className={styles.group} key={group.id}>
          <h4>{group.label}</h4>
          <table className={styles.phaseTable} aria-label={`${group.label} phase allocation`}>
            <thead><tr><th scope="col">Type</th><th scope="col">Pre-BF</th><th scope="col">BF</th><th scope="col">Total</th></tr></thead>
            <tbody>{group.rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{row.pre}</td><td>{row.bf}</td><td>{row.total}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">{group.label} subtotal</th><td>{group.pre}</td><td>{group.bf}</td><td>{group.total}</td></tr></tfoot>
          </table>
        </div>)}
      </div>
      <table className={styles.phaseTable} aria-label="Total phase allocation">
        <thead><tr><th scope="col">Allocation</th><th scope="col">Pre-BF · {prePercent}%</th><th scope="col">BF · {100 - prePercent}%</th><th scope="col">Total</th></tr></thead>
        <tbody><tr><th scope="row">Total allocated</th><td>{phases.pre}</td><td>{phases.bf}</td><td>{phases.total}</td></tr></tbody>
      </table>
      <p className={styles.muted}>Current contract limit: {brand.cap}</p>
    </section>

    <section className={styles.section} aria-label="Planned offers">
      <h3>Planned offers</h3>
      {snapshot.noPreBf && <p className={styles.notice}><strong>No pre-Black Friday promotion.</strong> All allocated creatives are assigned to Black Friday.</p>}
      <div className={styles.columns}>
        {!snapshot.noPreBf && <OfferReview title="Pre-Black Friday" offer={snapshot.offers.pre}/>}
        <OfferReview title="Black Friday" offer={snapshot.offers.bf}/>
      </div>
      {snapshot.noPreBf && <details className={styles.details}><summary>Retained pre-BF inputs — inactive</summary><p className={styles.muted}>Saved split: {snapshot.prePercent}% pre-BF / {100 - snapshot.prePercent}% Black Friday. Effective split: 0% / 100%.</p><OfferReview title="Pre-Black Friday (inactive)" offer={snapshot.offers.pre} inactive/></details>}
    </section>

    <section className={styles.section} aria-label="Plan copy">
      <h3>Copy</h3>
      {snapshot.useClientCopy ? <div className={styles.notice}><strong>Client-provided copy</strong><p>CRM copy lines and their approvals are not used in this plan.</p></div> : <>
        <p className={styles.notice}><strong>Copy approval: {globalApproval ? 'Confirmed' : 'Not confirmed'}</strong></p>
        <ol className={styles.copies}>{snapshot.copies.map((copy, index) => {
          const approval = snapshot.approvedCopyIds === undefined ? 'Approval not recorded' : snapshot.approvedCopyIds.includes(copy.id) ? 'Approved' : 'Not approved'
          return <li key={copy.id} className={styles.copy}><span className={styles.copyNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><p className={styles.verbatim}>{copy.text ? <LinkedText text={copy.text}/> : <span className={styles.muted}>No copy text provided</span>}</p><div className={styles.tags}><span>{sources[copy.source]}</span><span>{approval}</span></div></div></li>
        })}</ol>
      </>}
    </section>

    <section className={styles.section} aria-label="Notes and files">
      <h3>Notes &amp; files</h3>
      <h4>Notes</h4>
      {notes ? <p className={styles.verbatim}><LinkedText text={notes}/></p> : <p className={styles.muted}>No notes recorded.</p>}
      <h4 className={styles.spaced}>Files</h4>
      {fileIds.length ? <ul className={styles.files}>{fileIds.map(id => {
        const file = files.find(item => item.id === id)
        return <li key={id}><div>{file ? <span className={styles.verbatim}>{file.name}</span> : <strong>File metadata unavailable</strong>}{!file && <small className={styles.fileId}>ID: {id}</small>}</div>{file ? <button type="button" disabled={busy} onClick={() => void downloadFile(file)} aria-label={`Download ${file.name}`}>Download</button> : <span className={styles.muted}>Download unavailable</span>}</li>
      })}</ul> : <p className={styles.muted}>No files attached to this version.</p>}
    </section>

    <section className={styles.section} aria-label="Motion and audio references">
      <h3>Motion &amp; audio</h3>
      <dl className={styles.fields}><dt>Voiceover</dt><dd>{snapshot.voiceover ? 'Allowed' : 'Not allowed'}</dd><dt>Sound effects (SFX)</dt><dd>{snapshot.sfx ? 'Allowed' : 'Not allowed'}</dd></dl>
      <h4 className={styles.spaced}>Selected references</h4>
      {snapshot.motionIds.length ? <ul className={styles.references}>{snapshot.motionIds.map(id => {
        const reference = motionReferences.find(item => item.id === id)
        if (!reference) return <li className={styles.reference} key={id}><strong>Reference unavailable</strong><p className={styles.fileId}>ID: {id}</p><p className={styles.muted}>No reference metadata or video link is available for this selection.</p></li>
        return <li className={styles.reference} key={id}>
          {httpUrl(reference.thumbnailUrl) ? <>
            {/* Verified external reference thumbnails deliberately bypass the application image proxy. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={reference.thumbnailUrl} alt={reference.title} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>
          </> : <p className={styles.muted}>Thumbnail unavailable</p>}
          <div><h5>{reference.title}</h5><p className={styles.muted}>{reference.category} · {reference.format}</p>{httpUrl(reference.videoUrl) ? <a href={reference.videoUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Video reference<span className={styles.srOnly}>: {reference.title} (opens in a new tab)</span></a> : <span className={styles.muted}>Video reference unavailable</span>}</div>
        </li>
      })}</ul> : <p className={styles.muted}>No motion references selected.</p>}
    </section>
  </div>
}
