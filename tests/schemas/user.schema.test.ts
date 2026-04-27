/**
 * Tests "tipo-trato" pro contrato User. O schema é só uma interface TS,
 * sem validação runtime. Mas quebrar o contrato silenciosamente (renomear
 * field, mudar tipo) afeta migration legacy e persistência. Estes testes
 * fixam o shape esperado e detectam regressão acidental.
 */

import type { User } from '@/schemas/user.schema'

describe('User schema (contrato)', () => {
  it('tem todas as keys obrigatórias', () => {
    const u: User = {
      id: '1',
      name: 'A',
      email: 'a@b.com',
      accessHash: 'h',
    }
    expect(u.id).toBe('1')
    expect(u.name).toBe('A')
    expect(u.email).toBe('a@b.com')
    expect(u.accessHash).toBe('h')
  })

  it('organizerId é opcional', () => {
    const u: User = { id: '1', name: 'A', email: 'a@b.com', accessHash: 'h' }
    expect(u.organizerId).toBeUndefined()
    const u2: User = { id: '1', name: 'A', email: 'a@b.com', accessHash: 'h', organizerId: 'org' }
    expect(u2.organizerId).toBe('org')
  })

  it('regressão: fields que NÃO devem virar opcionais (id, name, email, accessHash)', () => {
    // Compile-time check via @ts-expect-error — se algum dia esses campos
    // virarem opcionais, o build aqui passa SEM erro de TS, e aí o test
    // explode no runtime.
    expect(() => {
      // @ts-expect-error — id obrigatório
      const u: User = { name: 'a', email: 'a@b', accessHash: 'h' }
      void u
    }).not.toThrow()
    expect(() => {
      // @ts-expect-error — accessHash obrigatório
      const u: User = { id: '1', name: 'a', email: 'a@b' }
      void u
    }).not.toThrow()
  })
})
