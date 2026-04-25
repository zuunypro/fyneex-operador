import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { useNavigationStore } from '@/stores/navigationStore'
import { useOfflineStore } from '@/stores/offlineStore'
import {
  DEFAULT_STALE_PACKET_HOURS,
  SAME_DAY_STALE_PACKET_HOURS,
} from '@/services/offline'
import { Icon } from './Icon'

interface StalePacketWarningProps {
  /** Override do threshold (em horas). Default: DEFAULT_STALE_PACKET_HOURS. */
  staleHours?: number
}

/** Heurística "evento é hoje" baseada na data string do EventInfo (YYYY-MM-DD
 * ou outro formato livre — comparamos com Date.toDateString do hoje pra
 * tolerar variações). Em eventos do dia, o snapshot envelhece mais rápido
 * (vendas last-minute) — reduzimos o threshold. */
function isEventToday(dateStr: string | undefined): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return false
  return d.toDateString() === new Date().toDateString()
}

function formatAge(downloadedAtIso: string): string {
  const ms = Date.now() - new Date(downloadedAtIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'agora'
  const hours = ms / 3_600_000
  if (hours < 1) {
    const mins = Math.max(1, Math.round(ms / 60_000))
    return `${mins} min atrás`
  }
  if (hours < 24) {
    return `${Math.round(hours)}h atrás`
  }
  const days = Math.floor(hours / 24)
  return `${days} dia${days === 1 ? '' : 's'} atrás`
}

/**
 * Aviso fininho que aparece SÓ quando:
 *  - Está offline
 *  - Tem evento selecionado
 *  - Packet local desse evento foi baixado há mais que STALE_HOURS
 *
 * Operador num evento que rodou multi-dia pode estar olhando um snapshot
 * de N horas atrás — clientes que pagaram nesse meio-tempo NÃO aparecem na
 * lista offline. Sem o aviso, ele não sabe que o packet tá velho.
 */
export function StalePacketWarning({ staleHours }: StalePacketWarningProps = {}) {
  const event = useNavigationStore((s) => s.selectedEvent)
  const packets = useOfflineStore((s) => s.packets)
  const online = useOfflineStore((s) => s.online)

  const meta = useMemo(
    () => (event ? packets.find((p) => p.eventId === event.id) : undefined),
    [event, packets],
  )

  // Online → essa info fica fora de tela (banner online já cobre estado).
  // Sem packet → não há nada local pra estar antigo.
  if (online !== false || !meta) return null

  // Eventos do dia: janela menor (4h vs 12h) — vendas last-minute envelhecem
  // o snapshot rapidíssimo. Override por prop tem prioridade pra casos
  // específicos (ex: evento de múltiplos dias com checkin contínuo).
  const effectiveHours =
    staleHours ?? (isEventToday(event?.date) ? SAME_DAY_STALE_PACKET_HOURS : DEFAULT_STALE_PACKET_HOURS)

  const ageMs = Date.now() - new Date(meta.downloadedAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < effectiveHours * 3_600_000) return null

  return (
    <View style={styles.box}>
      <Icon name="warning" size={14} color={colors.accentOrange} />
      <Text style={styles.label} numberOfLines={2}>
        Snapshot offline de {formatAge(meta.downloadedAt)} — re-baixe quando voltar online pra
        ver inscrições mais recentes.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: '#3A2A0D',
    borderWidth: 1,
    borderColor: '#6B4A1A',
  },
  label: {
    flex: 1,
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#F0C674',
    lineHeight: 15,
  },
})
