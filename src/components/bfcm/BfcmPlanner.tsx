'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LockKeyhole, UnlockKeyhole, Check, ArrowLeft, ArrowRight, Play, X } from 'lucide-react'
import { CATEGORIES, allocationLimits, isCopyApproved, approveCopies, lockDraft, reopenDraft, stageQuantities, effectivePrePercent, updateDraft, validateCopies, validateDraft, type Brand, type Draft, type DraftPatch, type StageOffer } from '@/lib/bfcm/model'
import styles from './BfcmPlanner.module.css'
import BfcmPlanReview from './BfcmPlanReview'

export type MotionReference = { id: string; title: string; category: string; format: string; thumbnailUrl: string; videoUrl: string }
export type SaveOperation = 'save' | 'approve' | 'lock' | 'reopen' | 'apply-offers' | 'approve-copy' | 'unapprove-copy' | 'regenerate-copy' | 'more-references'
export type SaveResult = { ok: true; version: number; draft?: Draft } | { ok: false; error: string }
export type BfcmFile = { id: string; name: string; size: number; contentType: string; createdAt: string }
type FileFailure = { ok: false; error: string }
export type BfcmFileActions = {
  prepare: (input: { fileName: string; contentType: string; byteSize: number }, expectedVersion: number) => Promise<{ ok: true; id: string; path: string; token: string; bucket: string; contentType: string } | FileFailure>
  finalize: (id: string, expectedVersion: number) => Promise<{ ok: true; version: number; draft: Draft; files: BfcmFile[] } | FileFailure>
  remove: (id: string, expectedVersion: number) => Promise<{ ok: true; version: number; draft: Draft; files: BfcmFile[] } | FileFailure>
  cleanup?: (expectedVersion: number) => Promise<{ ok: true; cleaned: number } | FileFailure>
  download: (id: string) => Promise<{ ok: true; url: string } | FileFailure>
}
const MAX_FILE_BYTES = 250 * 1024 * 1024
const EMPTY_FILES: BfcmFile[] = []
function fileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
type Props = { brand: Brand; initialDraft: Draft; initialVersion: number; saveAction: (draft: Draft, expectedVersion: number, operation: SaveOperation, copyId?: string) => Promise<SaveResult>; motionReferences: MotionReference[]; sourceNotice?: string; backHref?: string; initialFiles?: BfcmFile[]; initialFilesError?: string; fileActions?: BfcmFileActions; fixtureFiles?: boolean }

const ALLOCATION_GROUPS = [
  { label: 'Statics', categories: CATEGORIES.filter(c => c.id === 'textOffer' || c.id === 'refreshedStatic' || c.id === 'newStatic') },
  { label: 'Motion', categories: CATEGORIES.filter(c => c.id === 'refreshedVideo' || c.id === 'motionGraphics') },
]

function ReferencePreview({reference}:{reference:MotionReference}) {
  const [failed,setFailed]=useState(false)
  if(failed) return <div className={styles.preview} role="status" style={{display:'grid',placeItems:'center',padding:12,fontSize:12,textAlign:'center'}}>Preview unavailable. Select “Watch” to retry.</div>
  return <video className={styles.preview} aria-label={`Preview ${reference.title}`} autoPlay muted loop playsInline controls preload="metadata" poster={reference.thumbnailUrl} src={reference.videoUrl} onError={()=>setFailed(true)}/>
}

function OfferBlock({ title, offer, disabled, onChange }: {title:string; offer:StageOffer; disabled:boolean; onChange:(offer:StageOffer)=>void}) {
  const patch = (value: Partial<StageOffer>) => onChange({...offer, ...value})
  return <div className={styles.offerBlock}><h3>{title}</h3>
    <label className={styles.field}>Planned offer<input className={styles.input} value={offer.offer} disabled={disabled} placeholder="E.g., discount + offer conditions" onChange={e=>patch({offer:e.target.value})}/></label>
    <div className={styles.dates}><label className={styles.field}>Start<input className={styles.input} type="date" lang="en-US" value={offer.startDate} disabled={disabled} onChange={e=>patch({startDate:e.target.value})}/></label><label className={styles.field}>End<input className={styles.input} type="date" lang="en-US" value={offer.endDate} disabled={disabled} onChange={e=>patch({endDate:e.target.value})}/></label></div>
    <label className={styles.check}><input type="checkbox" checked={offer.sitewide} disabled={disabled} onChange={e=>patch({sitewide:e.target.checked})}/>Sitewide</label>
    {!offer.sitewide && <label className={styles.field}>Included products or collections<input className={styles.input} value={offer.included} disabled={disabled} onChange={e=>patch({included:e.target.value})} placeholder="Products, collections or links"/></label>}
    <label className={styles.check}><input type="checkbox" checked={offer.hasExclusions} disabled={disabled} onChange={e=>patch({hasExclusions:e.target.checked})}/>Has exclusions</label>
    {offer.hasExclusions && <label className={styles.field}>Exclusions<input className={styles.input} value={offer.exclusions} disabled={disabled} onChange={e=>patch({exclusions:e.target.value})} placeholder="What is excluded from this offer?"/></label>}
  </div>
}

export default function BfcmPlanner({brand, initialDraft, initialVersion, saveAction, motionReferences, sourceNotice, backHref="/bfcm-creatives", initialFiles=EMPTY_FILES, initialFilesError, fileActions, fixtureFiles=false}:Props) {
  const [draft,setDraft]=useState(initialDraft)
  const latest=useRef(initialDraft)
  const version=useRef(initialVersion)
  const savedRevision=useRef(initialDraft.revision)
  const queue=useRef<Promise<boolean>>(Promise.resolve(true))
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const [saveState,setSaveState]=useState<'saved'|'pending'|'saving'|'error'>('saved')
  const [error,setError]=useState('')
  const [step,setStep]=useState(1)
  const [busy,setBusy]=useState(false)
  const [summary,setSummary]=useState(initialDraft.status==='locked')
  const [confirmed,setConfirmed]=useState(false)
  const [showReopen,setShowReopen]=useState(false)
  const [showApplyOffers,setShowApplyOffers]=useState(false)
  const [filter,setFilter]=useState('All')
  const [playing,setPlaying]=useState<MotionReference|null>(null)
  const [playbackError,setPlaybackError]=useState(false)
  const [historyVersion,setHistoryVersion]=useState<number|null>(null)
  const [files,setFiles]=useState(initialFiles)
  const [fileError,setFileError]=useState(initialFilesError??'')
  const [fileProgress,setFileProgress]=useState('')
  const [fileStatus,setFileStatus]=useState('')
  const fileInput=useRef<HTMLInputElement|null>(null)
  const fixtureUrls=useRef(new Map<string,string>())
  const fileOperation=useRef(false)
  useEffect(()=>{const urls=fixtureUrls.current;return()=>{for(const url of urls.values())URL.revokeObjectURL(url)}},[])
  const [validationErrors,setValidationErrors]=useState<string[]>([])
  const locked=draft.status==='locked'
  const disabled=locked||busy
  const currentFiles=files.filter(file=>draft.fileIds?.includes(file.id))
  const visibleIds=draft.visibleMotionIds?.length?draft.visibleMotionIds:motionReferences.slice(0,10).map(ref=>ref.id)
  const refs=visibleIds.map(id=>motionReferences.find(ref=>ref.id===id)).filter((ref):ref is MotionReference=>!!ref)
  const approvedCount=draft.copies.filter(copy=>isCopyApproved(draft,copy.id)).length
  const moreReferencesAvailable=motionReferences.some(ref=>!visibleIds.includes(ref.id))
  const categories=['All',...new Set(refs.map(r=>r.category))]
  const total=CATEGORIES.reduce((sum,c)=>sum+draft.allocation[c.id],0)
  const prePercent=effectivePrePercent(draft)
  const split=stageQuantities(brand.cap,prePercent)
  const groupLimits=allocationLimits(brand)
  const allocationGroups=ALLOCATION_GROUPS.map(group=>({
    ...group,
    subtotal:group.categories.reduce((sum,c)=>sum+draft.allocation[c.id],0),
    cap:groupLimits?(group.label==='Statics'?groupLimits.static:groupLimits.motion):null,
  }))

  const persist=useCallback((value:Draft, operation:SaveOperation='save', copyId?:string):Promise<boolean>=> {
    const task=async()=>{
      if(operation==='save' && value.revision<=savedRevision.current) return true
      setSaveState('saving')
      try {
        const result=await saveAction(value,version.current,operation,copyId)
        if(!result.ok) throw new Error(result.error)
        version.current=result.version
        const saved=result.draft??value
        savedRevision.current=saved.revision
        if(operation!=='save' && result.draft) {latest.current=result.draft;setDraft(result.draft)}
        setSaveState(latest.current.revision===savedRevision.current?'saved':'pending')
        setError('')
        return true
      }catch(e){setSaveState('error');setError(e instanceof Error?e.message:'Could not save. Please try again.');return false}
    }
    queue.current=queue.current.then(task,task)
    return queue.current
  },[saveAction])

  const flush=useCallback(async()=>{if(timer.current){clearTimeout(timer.current);timer.current=null} return persist(latest.current)},[persist])
  const edit=(patch:DraftPatch)=>{
    try{const next=updateDraft(latest.current,patch); latest.current=next;setDraft(next);setSaveState('pending');setError('');setConfirmed(false)
      if(timer.current)clearTimeout(timer.current)
      timer.current=setTimeout(()=>{timer.current=null;void persist(latest.current)},800)
    }catch(e){setError(e instanceof Error?e.message:'Could not update the plan.')}
  }
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(fileOperation.current||latest.current.revision!==savedRevision.current){event.preventDefault();event.returnValue=''}}
    window.addEventListener('beforeunload',warn)
    return()=>{window.removeEventListener('beforeunload',warn);if(timer.current)clearTimeout(timer.current)}
  },[])
  useEffect(()=>{
    const intercept=(event:MouseEvent)=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||(!fileOperation.current&&latest.current.revision===savedRevision.current))return
      const anchor=(event.target as Element).closest?.('a[href]') as HTMLAnchorElement|null
      if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download')||anchor.origin!==window.location.origin)return
      event.preventDefault();event.stopPropagation()
      if(fileOperation.current){setFileError('Wait for the file operation to finish before leaving.');return}
      void flush().then(ok=>{if(ok)window.location.assign(anchor.href)})
    }
    document.addEventListener('click',intercept,true)
    return()=>document.removeEventListener('click',intercept,true)
  },[flush])
  useEffect(()=>{
    if(!playing&&!showReopen&&!showApplyOffers)return
    const previous=document.activeElement as HTMLElement|null
    const dialog=document.querySelector<HTMLElement>('[data-bfcm-dialog]')
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),video[controls],a[href],input:not([disabled])')??[])
    focusable()[0]?.focus()
    const close=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!busy){setPlaying(null);setShowReopen(false);setShowApplyOffers(false)}
      if(event.key==='Tab'){
        const items=focusable(),first=items[0],last=items[items.length-1]
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    }
    window.addEventListener('keydown',close)
    return()=>{window.removeEventListener('keydown',close);previous?.focus()}
  },[playing,showReopen,showApplyOffers,busy])

  async function go(next:number){
    setValidationErrors([])
    setBusy(true);if(await flush()){if(next<4)setStep(next);setSummary(next===4);setError('')}setBusy(false)
  }
  async function transition(operation:Exclude<SaveOperation,'save'>, copyId?:string){
    if(operation==='lock'){
      const requirements=[...validateDraft(brand,latest.current),...(!confirmed?['Confirm this plan’s offers, quantities, copy lines and references.']:[])]
      setValidationErrors(requirements)
      if(requirements.length)return
    }
    setBusy(true)
    try{
      if(!(await flush()))return
      const before=latest.current
      const next=operation==='approve'?approveCopies(before):operation==='lock'?lockDraft(brand,before,confirmed):operation==='reopen'?reopenDraft(before,true):before
      if(await persist(before,operation,copyId)){
        // The server may return its authoritative version (including lock time).
        if(latest.current===before){latest.current=next;setDraft(next);savedRevision.current=next.revision;setSaveState('saved')}
        if(operation==='apply-offers')setShowApplyOffers(false)
        if(operation==='more-references')setFilter('All')
        if(operation==='approve'){setStep(3);setSummary(false)}
        if(operation==='lock')setSummary(true)
        if(operation==='reopen'){setShowReopen(false);setSummary(false);setStep(1);setConfirmed(false)}
      }
    }catch(e){setError(e instanceof Error?e.message:'Could not complete this action.')}finally{setBusy(false)}
  }
  function adoptFileResult(result:{version:number;draft:Draft;files:BfcmFile[]}) {
    version.current=result.version;latest.current=result.draft;savedRevision.current=result.draft.revision
    setDraft(result.draft);setFiles(result.files);setSaveState('saved');setConfirmed(false)
  }
  async function uploadFiles(selected:File[]) {
    if(!selected.length||disabled||fileOperation.current||(!fileActions&&!fixtureFiles))return
    fileOperation.current=true;setBusy(true);setFileError('');setFileStatus('')
    const failures:string[]=[]
    try {
      if(!(await flush()))return
      for(let index=0;index<selected.length;index++) {
        const file=selected[index]
        if(file.size===0||file.size>MAX_FILE_BYTES){failures.push(`${file.name}: choose a non-empty file up to 250 MB.`);continue}
        try {
          if(fixtureFiles) {
            const id=crypto.randomUUID(),url=URL.createObjectURL(file)
            const next={...latest.current,fileIds:[...(latest.current.fileIds??[]),id],revision:latest.current.revision+1}
            if(!(await persist(next))){URL.revokeObjectURL(url);throw new Error('Could not save this fixture file.')}
            latest.current=next;setDraft(next);setSaveState('saved')
            fixtureUrls.current.set(id,url)
            setFiles(previous=>[...previous,{id,name:file.name,size:file.size,contentType:file.type||'application/octet-stream',createdAt:new Date().toISOString()}])
            continue
          }
          if(!fileActions)throw new Error('File uploads are unavailable.')
          setFileProgress(`Preparing ${index+1} of ${selected.length}: ${file.name}`)
          const prepared=await fileActions.prepare({fileName:file.name,contentType:file.type||'application/octet-stream',byteSize:file.size},version.current)
          if(!prepared.ok)throw new Error(prepared.error)
          setFileProgress(`Uploading ${index+1} of ${selected.length}: ${file.name}`)
          const {createClient}=await import('@/lib/supabase/client')
          const body=new File([file],file.name,{type:prepared.contentType})
          const {error:uploadError}=await createClient().storage.from(prepared.bucket).uploadToSignedUrl(prepared.path,prepared.token,body,{contentType:prepared.contentType,upsert:false})
          if(uploadError)throw new Error('Upload failed. Please try again.')
          setFileProgress(`Saving ${index+1} of ${selected.length}: ${file.name}`)
          const finalized=await fileActions.finalize(prepared.id,version.current)
          if(!finalized.ok)throw new Error(finalized.error)
          adoptFileResult(finalized)
        }catch(cause){failures.push(`${file.name}: ${cause instanceof Error?cause.message:'Could not upload this file.'}`)}
      }
      setFileError(failures.join(' '))
    }finally{fileOperation.current=false;setBusy(false);setFileProgress('');if(fileInput.current)fileInput.current.value=''}
  }
  async function downloadFile(file:Pick<BfcmFile,'id'|'name'>) {
    if(busy||fileOperation.current)return
    fileOperation.current=true;setBusy(true);setFileError('');setFileStatus('')
    try {
      if(!(await flush()))return
      const result=fixtureFiles?{ok:true as const,url:fixtureUrls.current.get(file.id)??''}:await fileActions?.download(file.id)
      if(!result?.ok||!result.url)throw new Error(result&&!result.ok?result.error:'File download is unavailable.')
      const anchor=document.createElement('a');anchor.href=result.url;anchor.download=file.name;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.click()
    }catch(cause){setFileError(cause instanceof Error?cause.message:'Could not download this file.')}finally{fileOperation.current=false;setBusy(false)}
  }
  async function removeFile(file:BfcmFile) {
    if(disabled||fileOperation.current||!window.confirm(`Remove “${file.name}” from the current plan? Files in saved versions remain available.`))return
    fileOperation.current=true;setBusy(true);setFileError('');setFileStatus('')
    try {
      if(!(await flush()))return
      if(fixtureFiles){const next={...latest.current,fileIds:(latest.current.fileIds??[]).filter(id=>id!==file.id),revision:latest.current.revision+1};if(!(await persist(next)))throw new Error('Could not remove this fixture file.');latest.current=next;setDraft(next);setSaveState('saved');return}
      const result=await fileActions?.remove(file.id,version.current)
      if(!result?.ok)throw new Error(result&&!result.ok?result.error:'File removal is unavailable.')
      adoptFileResult(result)
    }catch(cause){setFileError(cause instanceof Error?cause.message:'Could not remove this file.')}finally{fileOperation.current=false;setBusy(false)}
  }
  async function clearExpiredUploads() {
    if(disabled||fileOperation.current||!fileActions?.cleanup||!window.confirm('Clear incomplete uploads older than 130 minutes? Uploaded files and saved versions will not change.'))return
    fileOperation.current=true;setBusy(true);setFileError('');setFileStatus('')
    try {
      if(!(await flush()))return
      setFileProgress('Clearing expired uploads…')
      const result=await fileActions.cleanup(version.current)
      if(!result.ok)throw new Error(result.error)
      setFileStatus(`Cleared ${result.cleaned} expired ${result.cleaned===1?'upload':'uploads'}.`)
    }catch(cause){setFileError(cause instanceof Error?cause.message:'Could not clear expired uploads.')}finally{fileOperation.current=false;setBusy(false);setFileProgress('')}
  }
  function review(){void go(4)}

  return <main lang="en" className={styles.root}><div className={styles.wrap}>
    <div className={styles.topline}><Link className={styles.back} href={backHref} onClick={async e=>{if(latest.current.revision!==savedRevision.current){e.preventDefault();setError('Save your changes before returning to the list.')}}}><ArrowLeft size={13} style={{display:'inline',verticalAlign:'middle'}}/> BFCM Creatives</Link><div className={`${styles.save} ${saveState==='saved'?styles.saved:''}`} role="status">{saveState==='saved'?<><Check size={13}/>Saved to CRM</>:saveState==='saving'?'Saving…':saveState==='error'?'Not saved':'Unsaved changes'}{saveState==='error'&&<button className={styles.tinyButton} disabled={busy} onClick={()=>void flush()}>Try again</button>}</div></div>
    <header style={{marginTop:28}}><h1 className={styles.heading}>{brand.name}</h1><p className={styles.subtle}>{brand.cap} creatives</p></header>
    <nav className={styles.steps} aria-label="Plan steps">{['Offers & quantity','Copy','Motion & audio','Review'].map((label,i)=><button className={styles.step} key={label} aria-current={(summary?i===3:step===i+1)?'step':undefined} disabled={busy} onClick={()=>void go(i+1)}><span>{i+1}</span>{label}</button>)}</nav>
    {error&&<div className={styles.error} role="alert">{error}</div>}
    {validationErrors.length>0&&<div className={styles.error} role="alert"><strong>Complete the following before confirming:</strong><ul>{validationErrors.map(requirement=><li key={requirement}>{requirement}</li>)}</ul></div>}
    {locked&&<div className={styles.locked}><strong><LockKeyhole size={16} style={{display:'inline',verticalAlign:'middle'}}/> BFCM plan locked</strong><p style={{fontSize:13,marginTop:6}}>Version {draft.history.length} confirmed. Reopen the plan explicitly to make changes.</p></div>}
    {!summary&&step===1&&<>
      <section className={styles.panel}><h2>Offers</h2><label className={styles.check}><input type="checkbox" checked={draft.noPreBf??false} disabled={disabled} onChange={e=>edit({noPreBf:e.target.checked})}/>No pre-Black Friday promotion</label><p className={styles.subtle}>Enter the planned offer and dates for each active stage.</p><div className={styles.offerGrid} style={{marginTop:20}}>{(['pre','bf'] as const).map(stage=><OfferBlock key={stage} title={stage==='pre'?'01 · Pre-Black Friday':'02 · Black Friday'} offer={draft.offers[stage]} disabled={disabled||(stage==='pre'&&draft.noPreBf)} onChange={offer=>edit({offers:{...draft.offers,[stage]:offer}})}/>)}</div></section>
      <section className={styles.panel}><h2>Quantity & allocation</h2><p className={styles.subtle}>{brand.contract.kind==='exact'?'Adjust categories within the Statics and Motion limits.':brand.contract.kind==='grouped'?`Contract: ${brand.contract.static} static + ${brand.contract.motion} motion. Category allocation is adjustable.`:'Flexible allocation.'}</p>
        <div className={styles.split}><div className={styles.splitLabels}><span>Pre-BF <strong>{prePercent}%</strong> · {split.pre}</span><span>Black Friday <strong>{100-prePercent}%</strong> · {split.bf}</span></div><input aria-label="Pre-BF creative percentage" type="range" min="0" max="100" value={prePercent} disabled={disabled||draft.noPreBf} onChange={e=>edit({prePercent:Number(e.target.value)})}/><span className={styles.subtle}>{draft.noPreBf?'Black Friday only':'Suggested split: 30% / 70%'}</span></div>
        {allocationGroups.map(group=><section key={group.label} className={styles.allocationGroup} aria-label={`${group.label} allocation`}><div className={styles.allocationGroupHeader}><h3>{group.label}</h3><span aria-label={`${group.label} subtotal`}>{group.subtotal}{group.cap!==null?` / ${group.cap}`:''}</span></div>{group.categories.map(c=>{const isLocked=draft.allocationLocks.includes(c.id);const maximum=group.cap??brand.cap;return <div className={styles.allocation} key={c.id}><span>{c.label}</span><input aria-label={`${c.label} quantity`} type="range" min="0" max={maximum} value={draft.allocation[c.id]} disabled={disabled||isLocked} onChange={e=>edit({allocation:{...draft.allocation,[c.id]:Number(e.target.value)}})}/><input className={styles.input} aria-label={`${c.label} edit quantity`} type="number" min="0" max={maximum} value={draft.allocation[c.id]} disabled={disabled||isLocked} onChange={e=>edit({allocation:{...draft.allocation,[c.id]:Number(e.target.value)}})}/><button className={styles.lock} aria-label={`${isLocked?'Unlock':'Lock'} ${c.label}`} aria-pressed={isLocked} disabled={disabled} onClick={()=>edit({allocationLocks:isLocked?draft.allocationLocks.filter(id=>id!==c.id):[...draft.allocationLocks,c.id]})}>{isLocked?<LockKeyhole size={13} style={{margin:'auto'}}/>:<UnlockKeyhole size={13} style={{margin:'auto'}}/>}</button></div>})}</section>)}
        <div className={styles.totals}><span>Total allocated</span><span>{total} / {brand.cap}</span></div>
      </section></>}
    {!summary&&step===2&&<section className={styles.panel}><h2>Copy</h2><label className={styles.check}><input type="checkbox" checked={draft.useClientCopy??false} disabled={disabled} onChange={e=>edit({useClientCopy:e.target.checked})}/>Use client-provided copy</label>{draft.useClientCopy?<p className={styles.subtle}>The client materials contain enough copy. CRM copy approval is not required. Keep the materials in Notes &amp; files.</p>:<><p className={styles.subtle}>Approve individual lines or confirm all 30. Unapprove a line before editing it.</p>{sourceNotice&&<div className={styles.warning}>{sourceNotice}</div>}<button className={styles.secondary} disabled={disabled||approvedCount===draft.copies.length} style={{marginTop:12}} onClick={()=>setShowApplyOffers(true)}>Generate with AI · planned offers</button><div style={{marginTop:20}}>{draft.copies.map((copy,i)=>{const approved=isCopyApproved(draft,copy.id);return <div className={`${styles.copyrow} ${approved?styles.copyApproved:''}`} key={copy.id}><span className={styles.number}>{String(i+1).padStart(2,'0')}</span><textarea aria-label={`Copy ${i+1}`} className={styles.textarea} rows={2} value={copy.text} readOnly={approved} disabled={disabled} onChange={e=>edit({copies:draft.copies.map(c=>c.id===copy.id?{...c,text:e.target.value}:c)})}/><div className={styles.copyControls}><span className={styles.tag}>{{'BF anterior':'Previous BF',Recente:'Recent',Nova:'New'}[copy.source]}</span><div className={styles.copyActions}>{approved?<button className={styles.tinyButton} disabled={disabled} aria-label={`Unapprove copy ${i+1}`} onClick={()=>void transition('unapprove-copy',copy.id)}>Unapprove</button>:<button className={styles.tinyButton} disabled={disabled||!copy.text.trim()} aria-label={`Approve copy ${i+1}`} onClick={()=>void transition('approve-copy',copy.id)}>Approve</button>}<button className={styles.tinyButton} disabled={disabled||approved} aria-label={`Generate new copy ${i+1}`} onClick={()=>void transition('regenerate-copy',copy.id)}>Generate new</button></div>{approved&&<span className={styles.approvedLabel}><Check size={11}/>Approved</span>}</div></div>})}</div></>}</section>}
    {!summary&&step===3&&<section className={styles.panel}><h2>Motion references</h2><p className={styles.subtle}>Style references, not editable templates.</p><button className={styles.secondary} disabled={disabled||draft.motionIds.length>=10||!moreReferencesAvailable} title={draft.motionIds.length>=10?'Unselect a reference to replace it.':!moreReferencesAvailable?'No additional references available.':'Replaces unchecked references only.'} onClick={()=>void transition('more-references')}>Generate more references</button><div className={styles.filters}>{categories.map(category=><button className={styles.filter} aria-pressed={filter===category} key={category} onClick={()=>setFilter(category)}>{category}</button>)}</div>
      {refs.length?<div className={styles.motions}>{refs.filter(r=>filter==='All'||r.category===filter).map(ref=><article key={ref.id} className={`${styles.motion} ${draft.motionIds.includes(ref.id)?styles.motionSelected:''}`}>
        <ReferencePreview reference={ref}/>
        <div className={styles.motionBody}><div className={styles.motionTitle}>{ref.title}</div><div className={styles.subtle} style={{fontSize:10}}>{ref.category} · {ref.format}</div><div className={styles.motionActions}><button className={styles.tinyButton} onClick={()=>{setPlaying(ref);setPlaybackError(false)}} aria-label={`Watch ${ref.title}`}><Play size={10} style={{display:'inline'}}/> Watch</button><label className={styles.check} style={{margin:0,fontSize:10}}><input type="checkbox" checked={draft.motionIds.includes(ref.id)} disabled={disabled} aria-label={`Select ${ref.title}`} onChange={e=>edit({motionIds:e.target.checked?[...draft.motionIds,ref.id]:draft.motionIds.filter(id=>id!==ref.id)})}/>Use</label></div></div>
      </article>)}</div>:<div className={styles.empty}>References are being verified. Unavailable players will not be shown.</div>}
      <div className={styles.options}><label className={styles.check}><input type="checkbox" checked={draft.voiceover} disabled={disabled} onChange={e=>edit({voiceover:e.target.checked})}/>Allow voiceover</label><label className={styles.check}><input type="checkbox" checked={draft.sfx} disabled={disabled} onChange={e=>edit({sfx:e.target.checked})}/>Allow sound effects (SFX)</label></div>
    </section>}
    {summary&&<section className={styles.panel}><h2>Review plan</h2><BfcmPlanReview brand={brand} snapshot={draft} motionReferences={motionReferences} files={files} busy={busy} downloadFile={downloadFile}/>{!locked&&<label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this plan’s offers, quantities, copy lines and references.</label>}{fileError&&<p className={styles.error} role="alert">{fileError}</p>}</section>}
    {!summary&&<section className={styles.panel} aria-labelledby="bfcm-notes-files"><h2 id="bfcm-notes-files">Notes & files</h2><label className={styles.field}>Notes<textarea className={styles.textarea} aria-label="Plan notes" rows={4} maxLength={20000} value={draft.notes??''} disabled={disabled} placeholder="Add notes for this plan" onChange={event=>edit({notes:event.target.value})}/></label><div className={styles.filesHeader}><h3>Files</h3><div className={styles.inline}>{fileActions?.cleanup&&<button className={styles.tinyButton} disabled={disabled} onClick={()=>void clearExpiredUploads()}>Clear expired uploads</button>}<label className={styles.filePicker}><span>Add files</span><input ref={fileInput} type="file" multiple aria-label="Add plan files" disabled={disabled||(!fileActions&&!fixtureFiles)} onChange={event=>void uploadFiles(Array.from(event.target.files??[]))}/></label></div></div><p className={styles.subtle}>{fixtureFiles?'Fixture files are kept in this tab only and are lost on reload.':'Any file type · Up to 250 MB per file'}</p>{!fileActions&&!fixtureFiles&&<p className={styles.subtle}>File uploads are unavailable.</p>}{fileProgress&&<div className={styles.fileProgress} role="status"><progress aria-label="File upload progress"/>{fileProgress}</div>}{fileError&&<p className={styles.error} role="alert">{fileError}</p>}{fileStatus&&<p className={styles.subtle} role="status">{fileStatus}</p>}{currentFiles.length?<ul className={styles.fileList}>{currentFiles.map(file=><li key={file.id}><div className={styles.fileInfo}><span>{file.name}</span><small>{fileSize(file.size)}</small></div><div className={styles.inline}><button className={styles.tinyButton} disabled={busy} aria-label={`Download ${file.name}`} onClick={()=>void downloadFile(file)}>Download</button><button className={styles.tinyButton} disabled={disabled} aria-label={`Remove ${file.name}`} onClick={()=>void removeFile(file)}>Remove</button></div></li>)}</ul>:!fileError&&<p className={styles.subtle}>No files attached.</p>}</section>}
    {draft.history.length>0&&<details className={styles.panel}><summary style={{cursor:'pointer',fontSize:14,fontWeight:700}}>History · {draft.history.length} {draft.history.length===1?'version':'versions'}</summary>{draft.history.map(v=><div className={styles.history} key={v.version}><div className={styles.inline}><strong>Version {v.version}</strong><span className={styles.subtle}>{new Date(v.lockedAt).toLocaleString('en-US')}</span><button className={styles.tinyButton} onClick={()=>setHistoryVersion(historyVersion===v.version?null:v.version)}>{historyVersion===v.version?'Hide':'View version'}</button></div>{historyVersion===v.version&&<div style={{marginTop:12}}><BfcmPlanReview brand={brand} snapshot={v.snapshot} motionReferences={motionReferences} files={files} busy={busy} downloadFile={downloadFile}/>{fileError&&<p className={styles.error} role="alert">{fileError}</p>}</div>}</div>)}</details>}
    <footer className={styles.footer}><div>{locked?<span className={styles.subtle}>Confirmed</span>:<button className={styles.secondary} disabled={busy||(!summary&&step===1)} onClick={()=>void go(summary?3:step-1)}><ArrowLeft size={13} style={{display:'inline',verticalAlign:'middle'}}/> Back</button>}</div><div className={styles.inline}>{locked?<button className={styles.secondary} disabled={busy} onClick={()=>setShowReopen(true)}>Reopen plan</button>:summary?<button className={styles.primary} disabled={busy} onClick={()=>void transition('lock')}>{busy?'Saving…':'Confirm · BFCM plan locked'}</button>:step===2?<>{!draft.useClientCopy&&<button className={styles.secondary} disabled={busy||validateCopies(draft.copies).length>0} onClick={()=>void transition('approve')}>Confirm all 30 copy lines <Check size={14} style={{display:'inline',verticalAlign:'middle'}}/></button>}<button className={styles.primary} disabled={busy} onClick={()=>void go(3)}>Continue <ArrowRight size={14} style={{display:'inline',verticalAlign:'middle'}}/></button></>:step===3?<button className={styles.primary} disabled={busy} onClick={review}>Review plan <ArrowRight size={14} style={{display:'inline',verticalAlign:'middle'}}/></button>:<button className={styles.primary} disabled={busy} onClick={()=>void go(2)}>Continue <ArrowRight size={14} style={{display:'inline',verticalAlign:'middle'}}/></button>}</div></footer>
    {showApplyOffers&&<div className={styles.modalBackdrop}><div className={styles.modal} role="dialog" data-bfcm-dialog aria-modal="true" aria-labelledby="apply-offers-title"><h2 id="apply-offers-title" style={{fontWeight:750,fontSize:20}}>Generate new unapproved copy?</h2><p className={styles.subtle} style={{margin:'16px 0'}}>Generate new copy from the website and planned offers. Only unapproved lines will be replaced, including their edits. Approved lines will remain unchanged.</p><div className={styles.inline}><button className={styles.secondary} disabled={busy} onClick={()=>setShowApplyOffers(false)}>Cancel</button><button className={styles.primary} disabled={busy} onClick={()=>void transition('apply-offers')}>Replace unapproved lines</button></div></div></div>}
    {showReopen&&<div className={styles.modalBackdrop}><div className={styles.modal} role="dialog" data-bfcm-dialog aria-modal="true" aria-labelledby="reopen-title"><h2 id="reopen-title" style={{fontWeight:750,fontSize:20}}>Reopen this plan?</h2><p className={styles.subtle} style={{margin:'16px 0'}}>The current version will remain in history. You must confirm the copy lines again before locking a new version.</p><div className={styles.inline}><button className={styles.secondary} disabled={busy} onClick={()=>setShowReopen(false)}>Cancel</button><button className={styles.primary} disabled={busy} onClick={()=>void transition('reopen')}>Yes, reopen</button></div></div></div>}
    {playing&&<div className={styles.modalBackdrop} onClick={()=>setPlaying(null)}><div className={styles.modal} role="dialog" data-bfcm-dialog aria-modal="true" aria-label={playing.title} onClick={e=>e.stopPropagation()}><div className={styles.topline}><strong>{playing.title}</strong><button autoFocus className={styles.tinyButton} aria-label="Close video" onClick={()=>setPlaying(null)}><X size={16}/></button></div>{playbackError?<div className={styles.error}>This reference is currently unavailable. Close the video and choose another.</div>:<video controls autoPlay muted loop playsInline preload="metadata" poster={playing.thumbnailUrl} src={playing.videoUrl} onError={()=>setPlaybackError(true)}/>}<p className={styles.subtle}>Visual reference · Not an editable template.</p></div></div>}
  </div></main>
}
