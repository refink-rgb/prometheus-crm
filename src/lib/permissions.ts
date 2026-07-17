const ALLOWED_EDITORS = [
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
  'jan@commonthreadglobal.com',
  'joy@commonthreadglobal.com',
  'giovane@commonthreadglobal.com',
  'aleksandrs@commonthreadglobal.com',
  'ferran@commonthreadglobal.com',
  // Static editors
  'jaspen@commonthreadglobal.com',
  'janella@commonthreadglobal.com',
  'omkar@commonthreadglobal.com',
  'vinicius@commonthreadglobal.com',
]

export function canEdit(email: string | undefined | null): boolean {
  return !!email && ALLOWED_EDITORS.includes(email.toLowerCase())
}
