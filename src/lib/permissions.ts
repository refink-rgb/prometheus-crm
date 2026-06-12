const ALLOWED_EDITORS = [
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
  'jan@commonthreadglobal.com',
  'joy@commonthreadglobal.com',
  'giovane@commonthreadglobal.com',
]

export const PROFIT_ENGINEERS = ['Roberto', 'Lucas']

export function canEdit(email: string | undefined | null): boolean {
  return !!email && ALLOWED_EDITORS.includes(email.toLowerCase())
}
