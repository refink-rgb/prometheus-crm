/** Quiet card footer; an empty field does not imply that nothing is missing. */
export default function BfcmMissing({ value }: { value: unknown }) {
  if (typeof value !== 'string' || !value.trim()) return null
  return <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><span style={{ fontWeight: 600 }}>Missing: </span>{value.trim()}</div>
}
