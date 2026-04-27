import { useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, font, radius } from '@/theme'
import { apiPost, ApiError } from '@/services/api'
import { useNavigationStore } from '@/stores/navigationStore'
import { useUserStore } from '@/stores/userStore'
import { useOfflineStore } from '@/stores/offlineStore'
import { clearQueue } from '@/services/offline'
import type { User } from '@/schemas/user.schema'
import { Icon } from '@/components/Icon'

interface LoginResponse {
  success: boolean
  user: {
    id: string
    name: string
    email: string
    accessHash: string
    organizerId?: string
    role?: 'staff' | 'manager' | 'owner'
    eventScope?: string[] | null
  }
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const setIsLoggedIn = useNavigationStore((s) => s.setIsLoggedIn)
  const setUser = useUserStore((s) => s.setUser)
  const currentUser = useUserStore((s) => s.user)
  const refreshOfflineState = useOfflineStore((s) => s.refreshState)

  async function handleSubmit() {
    if (isLoading) return
    setErrorMessage('')
    setIsLoading(true)
    try {
      const res = await apiPost<LoginResponse>('/api/mobile/login', { email, password })
      if (res.success && res.user) {
        const user: User = {
          id: res.user.id,
          name: res.user.name,
          email: res.user.email,
          accessHash: res.user.accessHash,
          organizerId: res.user.organizerId,
          role: res.user.role ?? 'manager',
          eventScope: Array.isArray(res.user.eventScope) ? res.user.eventScope : null,
        }
        // BUG 2 fix: se havia outro usuário logado, limpa a fila pendente antes
        // de escrever a nova sessão. Ações do usuário A não podem vazar pro
        // usuário B — são de eventos, tokens e contextos diferentes.
        if (currentUser && currentUser.id !== user.id) {
          await clearQueue().catch(() => { /* best-effort */ })
          await refreshOfflineState().catch(() => { /* best-effort */ })
        }
        await setUser(user)
        setIsLoggedIn(true)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('Erro de conexão. Verifique sua internet.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.branding}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandingLabel}>GESTÃO DE EVENTOS ESPORTIVOS</Text>
          </View>

          <View style={styles.form}>
            <InputField
              icon="mail"
              placeholder="E-mail"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType="emailAddress"
              disabled={isLoading}
            />

            <View style={{ position: 'relative' }}>
              <InputField
                icon="lock"
                placeholder="Senha"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                autoCapitalize="none"
                textContentType="password"
                disabled={isLoading}
              />
              <Pressable
                onPress={() => setShowPass(!showPass)}
                style={styles.eyeButton}
                hitSlop={8}
              >
                <Icon
                  name={showPass ? 'visibility_off' : 'visibility'}
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>
            </View>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Icon name="error" size={16} color={colors.accentRed} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={{ alignItems: 'flex-end' }}>
              <Pressable style={styles.forgotLink} hitSlop={4}>
                <Text style={styles.forgotLabel}>Esqueceu a senha?</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={isLoading}
              style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            >
              {isLoading ? (
                <>
                  <ActivityIndicator size="small" color={colors.accentGreen} />
                  <Text style={styles.submitLabelLoading}>Entrando...</Text>
                </>
              ) : (
                <>
                  <Icon name="login" size={20} color={colors.textPrimary} />
                  <Text style={styles.submitLabel}>Entrar</Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={{ flex: 1 }} />

          <Text style={styles.footer}>
            Ao continuar, você concorda com nossos{' '}
            <Text style={styles.footerLink}>Termos de Uso</Text> e{' '}
            <Text style={styles.footerLink}>Política de Privacidade</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

interface InputFieldProps {
  icon: string
  placeholder: string
  value: string
  onChangeText: (v: string) => void
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'email-address' | 'numeric'
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  textContentType?: 'emailAddress' | 'password' | 'username'
  disabled?: boolean
}

function InputField(props: InputFieldProps) {
  return (
    <View style={[styles.input, props.disabled && { opacity: 0.6 }]}>
      <Icon name={props.icon} size={20} color={colors.textTertiary} />
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry={props.secureTextEntry}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize}
        textContentType={props.textContentType}
        editable={!props.disabled}
        style={styles.inputText}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  scroll: {
    flexGrow: 1,
    maxWidth: 430,
    width: '100%',
    alignSelf: 'center',
  },
  branding: {
    padding: 24,
    paddingTop: 60,
    alignItems: 'center',
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 20,
    marginBottom: 12,
  },
  brandingLabel: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
    letterSpacing: 2.2,
  },
  form: {
    paddingTop: 36,
    paddingHorizontal: 20,
    gap: 14,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingHorizontal: 14,
  },
  inputText: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    fontWeight: font.weight.medium,
    color: colors.textPrimary,
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: '#1A0A0A',
    borderWidth: 1,
    borderColor: '#4A1A1A',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.accentRed,
  },
  forgotLink: {
    padding: 4,
  },
  forgotLabel: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.accentBlue,
  },
  submitButton: {
    width: '100%',
    height: 48,
    borderRadius: radius.lg,
    marginTop: 4,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#1A2E1A',
    borderColor: '#2A4A2A',
  },
  submitLabel: {
    fontSize: 14,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  submitLabelLoading: {
    fontSize: 14,
    fontWeight: font.weight.bold,
    color: '#4A7A4A',
  },
  footer: {
    padding: 20,
    textAlign: 'center',
    fontSize: 10,
    color: colors.textTertiary,
    fontWeight: font.weight.medium,
  },
  footerLink: {
    color: colors.accentBlue,
  },
})
