export type MobileUserRole = 'staff' | 'manager' | 'owner'

export interface User {
  id: string
  name: string
  email: string
  accessHash: string
  organizerId?: string
  role?: MobileUserRole
  // null/undefined = sem restrição (manager/owner ou staff full); array = staff
  // só pode operar nos event ids listados.
  eventScope?: string[] | null
}
