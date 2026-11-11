// Shown when a migration has not been run yet. Migrations are run by hand in
// the Supabase SQL editor (repo convention).
export default function MigrationNotice({ file, title = 'Evergreen tables not found.', what }: { file: string; title?: string; what?: string }) {
  return (
    <div style={{
      padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-4)', borderRadius: 10, lineHeight: 1.6,
      background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))',
      border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))', fontSize: 'var(--text-base)',
      color: 'var(--text-primary)', flexShrink: 0,
    }}>
      <strong>{title}</strong> Run <code>{file}</code> in the{' '}
      <a href="https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new" target="_blank" rel="noopener noreferrer">Supabase SQL editor</a>
      {what ? ` ${what}` : ', then reload.'}
    </div>
  )
}
