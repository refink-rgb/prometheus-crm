const ALLOWED_EDITORS = [
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
]

export function canEdit(email: string | undefined | null): boolean {
  return !!email && ALLOWED_EDITORS.includes(email.toLowerCase())
}
