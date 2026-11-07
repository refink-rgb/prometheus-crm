// Shown when the evergreen tables are not in the database yet. Migrations are
// run by hand in the Supabase SQL editor (repo convention).
export default function MigrationNotice({ file }: { file: string }) {
  return (
    <div style={{
      padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-4)', borderRadius: 10, lineHeight: 1.6,
      background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))',
      border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))', fontSize: 'var(--text-base)',
      color: 'var(--text-primary)', flexShrink: 0,
    }}>
      <strong>Evergreen tables not found.</strong> Run <code>{file}</code> in the Supabase SQL editor, then reload.
    </div>
  )
}
