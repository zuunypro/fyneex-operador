/**
 * Tests pra classificação de campos do form_responses.
 *
 * Regressão crítica: campo "Camiseta" cair em "identity" (porque tem "i" tipo
 * email?) ou "CPF" cair em "kit". Isso quebra o card inteiro: kit some, ou
 * identidade duplica em duas seções.
 */

import {
  isKitFieldLabel,
  isIdentityFieldLabel,
  classifyFields,
} from '@/utils/fieldClassification'

describe('isKitFieldLabel', () => {
  it.each([
    ['Camiseta', true],
    ['Camisa Tamanho', true],
    ['Medalha', true],
    ['Garrafa', true],
    ['Troféu', true],
    ['Trofeu', true],
    ['Brinde', true],
    ['Kit Adicional', true],
    ['Tamanho', true],
    ['Cor', true],
    ['Modelo', true],
    ['Variante', true],
    // Case-insensitive:
    ['CAMISETA', true],
    ['camiseta', true],
  ])('"%s" → kit=%s', (label, expected) => {
    expect(isKitFieldLabel(label)).toBe(expected)
  })

  it('false pra labels não-kit', () => {
    expect(isKitFieldLabel('Nome')).toBe(false)
    expect(isKitFieldLabel('Email')).toBe(false)
    expect(isKitFieldLabel('Tipo Sanguíneo')).toBe(false)
    expect(isKitFieldLabel('Data Nascimento')).toBe(false)
  })

  it('false pra string vazia / null', () => {
    expect(isKitFieldLabel('')).toBe(false)
    expect(isKitFieldLabel(null as unknown as string)).toBe(false)
  })
})

describe('isIdentityFieldLabel', () => {
  it.each([
    ['Nome', true],
    ['Nome Completo', true],
    ['Email', true],
    ['E-mail', true],
    ['Telefone', true],
    ['Phone', true],
    ['Celular', true],
    ['CPF', true],
    ['RG', true],
    ['Documento', true],
    ['NAME', true],
  ])('"%s" → identity=%s', (label, expected) => {
    expect(isIdentityFieldLabel(label)).toBe(expected)
  })

  it('false pra labels não-identidade', () => {
    expect(isIdentityFieldLabel('Camiseta')).toBe(false)
    expect(isIdentityFieldLabel('Tamanho')).toBe(false)
    expect(isIdentityFieldLabel('Tipo Sanguíneo')).toBe(false)
  })
})

describe('classifyFields', () => {
  it('particiona em kit/identity/other em uma passada', () => {
    const fields = [
      { label: 'Camiseta', value: 'GG' },
      { label: 'Nome Completo', value: 'João Silva' },
      { label: 'Tipo Sanguíneo', value: 'O+' },
      { label: 'Medalha', value: 'Ouro' },
      { label: 'Email', value: 'a@b.com' },
      { label: 'Data Nascimento', value: '1990-01-01' },
    ]
    const out = classifyFields(fields)
    expect(out.kit.map(f => f.label)).toEqual(['Camiseta', 'Medalha'])
    expect(out.identity.map(f => f.label)).toEqual(['Nome Completo', 'Email'])
    expect(out.other.map(f => f.label)).toEqual(['Tipo Sanguíneo', 'Data Nascimento'])
  })

  it('retorna 3 arrays vazios pra input vazio', () => {
    const out = classifyFields([])
    expect(out.kit).toEqual([])
    expect(out.identity).toEqual([])
    expect(out.other).toEqual([])
  })

  it('preserva ordem original dentro de cada bucket', () => {
    const fields = [
      { label: 'Camiseta', value: 'M' },
      { label: 'Garrafa', value: 'Único' },
      { label: 'Medalha', value: '' },
    ]
    const out = classifyFields(fields)
    expect(out.kit.map(f => f.label)).toEqual(['Camiseta', 'Garrafa', 'Medalha'])
  })

  it('cada campo cai em UM bucket — sem duplicação', () => {
    const fields = [
      { label: 'Camiseta', value: 'P' },
      { label: 'Nome', value: 'Ana' },
    ]
    const out = classifyFields(fields)
    const total = out.kit.length + out.identity.length + out.other.length
    expect(total).toBe(fields.length)
  })

  it('regressão: "Tamanho da Camiseta" prioriza kit (não identidade por "Nome"-substring)', () => {
    // Nenhum keyword de identidade casa, só kit ("camiseta"/"tamanho").
    const out = classifyFields([{ label: 'Tamanho da Camiseta', value: 'GG' }])
    expect(out.kit.length).toBe(1)
    expect(out.identity.length).toBe(0)
  })

  it('matched-first wins: kit antes de identity (label que casa ambos)', () => {
    // Hipótese: "Nome do modelo" — "nome" é identity, "modelo" é kit.
    // O código testa kit primeiro, então deve cair em kit.
    const out = classifyFields([{ label: 'Nome do modelo', value: 'X' }])
    expect(out.kit.length).toBe(1)
  })
})
