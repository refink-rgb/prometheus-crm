'use client'

import { useState } from 'react'
import Link from 'next/link'
import { filterProjects, isProjectOverdue, PLAN_STATUSES, PRODUCTION_STATUSES, type ProjectFilters, type ProjectRow, type ProjectSort } from '@/lib/bfcm/project-list'
import styles from './BfcmProjectsTable.module.css'

const EMPTY_FILTERS: ProjectFilters = { query: '', planStatus: '', productionStatus: '', overdueOnly: false }
const COLUMNS: { key: ProjectSort['key']; label: string }[] = [
  { key: 'name', label: 'Project' },
  { key: 'planStatus', label: 'Plan status' },
  { key: 'productionStatus', label: 'Production status' },
  { key: 'dueDate', label: 'Next due date' },
]
const TONE = { waiting: 'neutral', client: 'client', review: 'progress', calibration: 'internal', ads: 'progress', check: 'internal', custom: 'neutral', done: 'complete' } as const
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export default function BfcmProjectsTable({ projects, today }: { projects: ProjectRow[]; today: string }) {
  const [filters, setFilters] = useState<ProjectFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<ProjectSort>({ key: 'name', direction: 'asc' })
  const visible = filterProjects(projects, filters, sort, today)
  const filtered = !!(filters.query || filters.planStatus || filters.productionStatus || filters.overdueOnly)
  function changeFilter<K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) { setFilters(current => ({ ...current, [key]: value })) }
  function sortBy(key: ProjectSort['key']) { setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })) }

  return <section aria-label="BFCM projects">
    <div className={styles.filters}>
      <label className={`${styles.field} ${styles.search}`}>Search projects
        <input type="search" placeholder="Search by brand name…" value={filters.query} onChange={event => changeFilter('query', event.target.value)} />
      </label>
      <label className={styles.field}>Plan status
        <select value={filters.planStatus} onChange={event => changeFilter('planStatus', event.target.value as ProjectFilters['planStatus'])}>
          <option value="">All plan statuses</option>
          {Object.entries(PLAN_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={styles.field}>Production status
        <select value={filters.productionStatus} onChange={event => changeFilter('productionStatus', event.target.value as ProjectFilters['productionStatus'])}>
          <option value="">All production statuses</option>
          {Object.entries(PRODUCTION_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={styles.overdue}><input type="checkbox" checked={filters.overdueOnly} onChange={event => changeFilter('overdueOnly', event.target.checked)} />Overdue only</label>
      {filtered && <button type="button" className={`btn-secondary ${styles.clear}`} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
    </div>
    <div className={styles.scroll} role="region" aria-label="Projects table, scroll horizontally on smaller screens" tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>BFCM projects with plan status, production status, next due date and project links. Select a column heading to sort.</caption>
        <thead><tr>
          {COLUMNS.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" className={styles.sort} onClick={() => sortBy(column.key)} aria-label={`Sort by ${column.label.toLowerCase()}, ${sort.key === column.key && sort.direction === 'asc' ? 'descending' : 'ascending'}`}>
              {column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span>
            </button>
          </th>)}
          <th scope="col">Project link</th>
        </tr></thead>
        <tbody>
          {visible.map(project => <tr key={project.slug}>
            <th scope="row" className={styles.name}>{project.name}</th>
            <td><span className={styles.badge} data-tone={project.planStatus === 'locked' ? 'complete' : project.planStatus === 'in_progress' ? 'progress' : 'neutral'}>{PLAN_STATUSES[project.planStatus]}</span></td>
            <td><span className={styles.badge} data-tone={TONE[project.productionStatus]}>{project.productionLabel}</span></td>
            <td>{project.dueDate ? <div className={styles.date}><time dateTime={project.dueDate}>{dateLabel(project.dueDate)}</time>{isProjectOverdue(project, today) && <span className={styles.late}>Overdue</span>}</div> : <span className={styles.muted}>No due date</span>}</td>
            <td><Link href={`/bfcm-creatives/${project.slug}`} className={styles.link} aria-label={`Open ${project.name} project`}>Open project <span aria-hidden="true">→</span></Link></td>
          </tr>)}
          {!visible.length && <tr><td colSpan={5} className={styles.empty} role="status">{projects.length ? 'No projects match these filters.' : 'No plans yet. Add a project to get started.'}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}
