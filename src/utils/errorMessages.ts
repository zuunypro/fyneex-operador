/**
 * Traduz códigos específicos do backend mobile pra mensagens amigáveis em PT-BR.
 * Os códigos vêm do servidor em ApiError.code (ex: 'EVENT_INACTIVE', 'ORDER_NOT_PAID').
 * Fallback: usa a mensagem original do backend (err.message).
 */

import { ApiError } from '@/services/api'

const BACKEND_CODE_LABELS: Record<string, string> = {
  EVENT_INACTIVE: 'Este evento está arquivado/cancelado — não permite mais check-in',
  ORDER_NOT_PAID: 'Pedido ainda não foi pago — check-in indisponível',
  TICKET_TRANSFERRED: 'Ingresso foi transferido — QR antigo não vale mais',
  INSTANCE_OUT_OF_RANGE: 'Número do ingresso inválido pra este pedido',
  CHECKIN_REQUIRED: 'Faça o check-in antes de entregar o kit',
  KIT_NO_STOCK_CONFIGURED: 'Sem estoque vinculado — configure em /organizador/estoque',
  RATE_LIMITED: 'Muitas requisições — aguarde um instante',
  TIMEOUT: 'Timeout (rede lenta) — tente de novo',
  NETWORK_ERROR: 'Sem conexão com o servidor',
}

export function friendlyError(err: unknown, fallback = 'Erro inesperado'): string {
  if (err instanceof ApiError) {
    if (err.code && BACKEND_CODE_LABELS[err.code]) {
      return BACKEND_CODE_LABELS[err.code]
    }
    // Mensagens específicas por status sem code
    if (err.status === 404) return 'Ingresso não encontrado neste evento — confira o QR'
    if (err.status === 401) return 'Sessão expirada — saia e entre de novo'
    if (err.status === 403) return 'Sem permissão pra este evento'
    if (err.status === 429) return 'Muitas tentativas — aguarde um instante'
    if (err.status >= 500) return 'Servidor instável — tente de novo em segundos'
    if (err.status === 0) return 'Sem conexão com o servidor'
    return err.message || `Erro ${err.status}`
  }
  if (err instanceof Error) return err.message || fallback
  return fallback
}
