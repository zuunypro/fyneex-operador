/**
 * Traduz códigos específicos do backend mobile pra mensagens amigáveis em PT-BR.
 * Os códigos vêm do servidor em ApiError.code (ex: 'EVENT_INACTIVE', 'ORDER_NOT_PAID').
 * Fallback: usa a mensagem original do backend (err.message).
 */

import { ApiError } from '@/services/api'

const BACKEND_CODE_LABELS: Record<string, string> = {
  EVENT_INACTIVE: 'Este evento está arquivado/cancelado — não permite mais check-in',
  ORDER_NOT_PAID: 'Pedido ainda não foi pago — check-in indisponível',
  // P1-8: TICKET_TRANSFERRED + QR_REVOKED + ITEM_REFUNDED voltam de paths
  // 410/422 do servidor. Antes apenas TICKET_TRANSFERRED tinha label —
  // os outros dois caíam no fallback `err.message` cru, que mostra texto
  // longo do servidor e confunde operador no balcão.
  TICKET_TRANSFERRED: 'Ingresso foi transferido — QR antigo não vale mais',
  QR_REVOKED: 'QR revogado pelo organizador — peça pra cliente gerar novo',
  ITEM_REFUNDED: 'Ingresso foi reembolsado — não permite mais check-in',
  INSTANCE_OUT_OF_RANGE: 'Número do ingresso inválido pra este pedido',
  CHECKIN_REQUIRED: 'Faça o check-in antes de entregar o kit',
  KIT_NO_STOCK_CONFIGURED: 'Sem estoque vinculado — toque no participante manualmente pra forçar',
  FORCE_REASON_REQUIRED: 'Informe uma justificativa pra retirada forçada',
  FORBIDDEN: 'Sem permissão pra este evento',
  EVENT_MISMATCH: 'Este QR não pertence ao evento selecionado',
  NOT_FOUND: 'Ingresso não encontrado neste evento',
  TIMEOUT: 'Conexão lenta — tente de novo',
  NETWORK_ERROR: 'Sem conexão com o servidor',
}

export function friendlyError(err: unknown, fallback = 'Erro inesperado'): string {
  if (err instanceof ApiError) {
    // 429 vem antes do code-lookup: o servidor já entrega "Limite atingido. Tente em Xs"
    // com tempo exato vindo do Redis, e Retry-After cobre o caso de body sem mensagem.
    if (err.status === 429) {
      if (err.message && /\d/.test(err.message)) return err.message
      if (err.retryAfter) return `Muitas tentativas — aguarde ${err.retryAfter}s`
      return 'Muitas tentativas — aguarde um instante'
    }
    if (err.code && BACKEND_CODE_LABELS[err.code]) {
      return BACKEND_CODE_LABELS[err.code]
    }
    if (err.status === 404) return 'Ingresso não encontrado neste evento — confira o QR'
    if (err.status === 401) return 'Sessão expirada — saia e entre de novo'
    if (err.status === 403) return 'Sem permissão pra este evento'
    if (err.status >= 500) return 'Servidor instável — tente de novo em segundos'
    if (err.status === 0) return 'Sem conexão com o servidor'
    return err.message || `Erro ${err.status}`
  }
  if (err instanceof Error) return err.message || fallback
  return fallback
}
