/**
 * Campo de detalhe genérico — label pequeno em caixa-alta + valor.
 * Usado em CheckinPage e StockPage no expand do card do participante,
 * e em ConfirmationModal pra mostrar dados do form. Centralizado
 * aqui pra evitar 3 implementações iguais pulando de typography
 * sutil entre as telas.
 */
import { StyleSheet, Text, View } from 'react-native'
import { colors, font } from '@/theme'

interface DetailFieldProps {
  label: string
  value: string
  /** Quando true, valor não é truncado em 1 linha (útil pra notas
   *  longas como "observação" e "tipo sanguíneo + alergias"). */
  multiline?: boolean
}

export function DetailField({ label, value, multiline }: DetailFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={styles.value}
        numberOfLines={multiline ? undefined : 1}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    width: '50%',
    paddingRight: 10,
    paddingBottom: 6,
  },
  label: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#B0B0B0',
  },
})
