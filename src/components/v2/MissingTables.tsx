import { MIGRATION_FILE } from '@/lib/v2/model'

/** Shown instead of a 2.0 screen when its tables aren't in this database yet. */
export default function MissingTables() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong style={{ color: 'var(--text-primary)' }}>2.0 needs its database tables first</strong>
      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-base)' }}>
        Run <code>supabase/migrations/{MIGRATION_FILE}</code> in the Supabase SQL editor, then reload this page.
      </span>
    </div>
  )
}
