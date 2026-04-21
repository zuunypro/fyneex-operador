import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'

/**
 * Icon helper que mapeia o nome de glyph do Material Symbols (web) pro
 * Material Icons do @expo/vector-icons (que é o Material Icons "round/filled"
 * clássico do Google). Como nem todo nome do Symbols existe em Material Icons,
 * mantemos um dicionário explícito com os ~40 glyphs que o app usa (ver lista
 * no <link ... icon_names=...> do index.html legacy).
 *
 * Uso: <Icon name="qr_code_scanner" size={22} color="#3FB950" />
 */

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name']
type MaterialCommunityIconName = ComponentProps<typeof MaterialCommunityIcons>['name']

type IconEntry =
  | { family: 'material'; name: MaterialIconName }
  | { family: 'community'; name: MaterialCommunityIconName }

const MAP: Record<string, IconEntry> = {
  add: { family: 'material', name: 'add' },
  arrow_downward: { family: 'material', name: 'arrow-downward' },
  arrow_upward: { family: 'material', name: 'arrow-upward' },
  barcode_scanner: { family: 'material', name: 'qr-code-scanner' },
  battery_full: { family: 'material', name: 'battery-full' },
  bolt: { family: 'material', name: 'bolt' },
  calendar_today: { family: 'material', name: 'calendar-today' },
  check: { family: 'material', name: 'check' },
  check_circle: { family: 'material', name: 'check-circle' },
  checkroom: { family: 'material', name: 'checkroom' },
  chevron_right: { family: 'material', name: 'chevron-right' },
  close: { family: 'material', name: 'close' },
  edit: { family: 'material', name: 'edit' },
  error: { family: 'material', name: 'error' },
  event: { family: 'material', name: 'event' },
  event_busy: { family: 'material', name: 'event-busy' },
  expand_more: { family: 'material', name: 'expand-more' },
  grid_view: { family: 'material', name: 'grid-view' },
  group: { family: 'material', name: 'group' },
  help: { family: 'material', name: 'help' },
  how_to_reg: { family: 'material', name: 'how-to-reg' },
  image: { family: 'material', name: 'image' },
  inventory_2: { family: 'material', name: 'inventory-2' },
  keyboard: { family: 'material', name: 'keyboard' },
  location_on: { family: 'material', name: 'location-on' },
  lock: { family: 'material', name: 'lock' },
  login: { family: 'material', name: 'login' },
  logout: { family: 'material', name: 'logout' },
  mail: { family: 'material', name: 'mail' },
  manage_accounts: { family: 'material', name: 'manage-accounts' },
  military_tech: { family: 'material', name: 'military-tech' },
  notifications_active: { family: 'material', name: 'notifications-active' },
  person: { family: 'material', name: 'person' },
  person_search: { family: 'material', name: 'person-search' },
  priority_high: { family: 'material', name: 'priority-high' },
  qr_code_scanner: { family: 'material', name: 'qr-code-scanner' },
  redeem: { family: 'material', name: 'redeem' },
  refresh: { family: 'material', name: 'refresh' },
  remove: { family: 'material', name: 'remove' },
  schedule: { family: 'material', name: 'schedule' },
  search: { family: 'material', name: 'search' },
  shield: { family: 'material', name: 'shield' },
  signal_cellular_alt: { family: 'material', name: 'signal-cellular-alt' },
  swap_horiz: { family: 'material', name: 'swap-horiz' },
  visibility: { family: 'material', name: 'visibility' },
  visibility_off: { family: 'material', name: 'visibility-off' },
  warning: { family: 'material', name: 'warning' },
  wifi: { family: 'material', name: 'wifi' },
  wifi_off: { family: 'material', name: 'wifi-off' },
}

export interface IconProps {
  name: string
  size?: number
  color?: string
  style?: ComponentProps<typeof MaterialIcons>['style']
}

export function Icon({ name, size = 22, color = '#E8E8E8', style }: IconProps) {
  const entry = MAP[name] ?? { family: 'material', name: 'help' as MaterialIconName }
  if (entry.family === 'material') {
    return <MaterialIcons name={entry.name} size={size} color={color} style={style} />
  }
  return <MaterialCommunityIcons name={entry.name} size={size} color={color} style={style} />
}
