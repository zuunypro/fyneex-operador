/**
 * Setup global pros testes Jest.
 *
 * Mocka todos os módulos Expo / React Native que os arquivos importam
 * direto, mas que não temos runtime nativo pra rodar em Node. Os mocks
 * mantêm o shape mínimo que o código consome — qualquer função além das
 * que o app usa fica como jest.fn() pro teste poder spy/expect.
 *
 * Stores que dependem desses mocks são reimportadas via jest.resetModules()
 * dentro de cada teste quando precisam isolar estado.
 */

// __DEV__ é flag global do RN — TS reclama, mas em runtime Node precisa
// existir antes do código importar.
;(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false

/* ── @react-native-async-storage/async-storage ─────────────────────────── */
// IMPORTANTE: storage compartilhado via globalThis pra sobreviver a
// jest.resetModules() (que re-executa o factory do mock). Sem isso, dados
// gravados em um require() somem quando o teste reseta módulos pra simular
// "novo boot do app".
const __asKey = '__fyneex_test_async_storage__'
const __asStore: Map<string, string> =
  (globalThis as unknown as Record<string, Map<string, string>>)[__asKey] ||
  ((globalThis as unknown as Record<string, Map<string, string>>)[__asKey] = new Map())

jest.mock('@react-native-async-storage/async-storage', () => {
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (__asStore.has(k) ? __asStore.get(k)! : null)),
      setItem: jest.fn(async (k: string, v: string) => { __asStore.set(k, v) }),
      removeItem: jest.fn(async (k: string) => { __asStore.delete(k) }),
      multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => __asStore.delete(k)) }),
      getAllKeys: jest.fn(async () => Array.from(__asStore.keys())),
      clear: jest.fn(async () => { __asStore.clear() }),
      __reset: () => __asStore.clear(),
    },
  }
})

/* ── expo-constants ─────────────────────────────────────────────────────── */
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { apiUrl: 'https://fyneexsports.com' },
    },
  },
}))

/* ── expo-secure-store ──────────────────────────────────────────────────── */
const __ssKey = '__fyneex_test_secure_store__'
const __ssStore: Map<string, string> =
  (globalThis as unknown as Record<string, Map<string, string>>)[__ssKey] ||
  ((globalThis as unknown as Record<string, Map<string, string>>)[__ssKey] = new Map())

jest.mock('expo-secure-store', () => {
  return {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k: string, v: string) => { __ssStore.set(k, v) }),
    getItemAsync: jest.fn(async (k: string) => (__ssStore.has(k) ? __ssStore.get(k)! : null)),
    deleteItemAsync: jest.fn(async (k: string) => { __ssStore.delete(k) }),
    __reset: () => __ssStore.clear(),
  }
})

/* ── expo-application ───────────────────────────────────────────────────── */
jest.mock('expo-application', () => ({
  __esModule: true,
  applicationId: 'com.fyneex.operador.test',
  nativeApplicationVersion: '1.0.0-test',
  getAndroidId: jest.fn(() => 'androidid-test-1234567890abcdef'),
}))

/* ── expo-crypto ────────────────────────────────────────────────────────── */
jest.mock('expo-crypto', () => ({
  __esModule: true,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_alg: string, input: string) => {
    // Hash determinístico simples baseado no input — não precisa ser real
    // SHA-256, só estável (mesmo input → mesma saída) pra testes verem
    // cache hit / variação cross-device.
    let h = 0
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0
    }
    return Math.abs(h).toString(16).padStart(8, '0').repeat(8).slice(0, 64)
  }),
}))

/* ── expo-haptics ───────────────────────────────────────────────────────── */
jest.mock('expo-haptics', () => ({
  __esModule: true,
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
}))

/* ── expo-file-system ───────────────────────────────────────────────────── */
jest.mock('expo-file-system', () => ({
  __esModule: true,
  getFreeDiskStorageAsync: jest.fn(async () => 5 * 1024 * 1024 * 1024), // 5GB
  getTotalDiskCapacityAsync: jest.fn(async () => 64 * 1024 * 1024 * 1024), // 64GB
}))

/* ── expo-sqlite (módulo opcional — só pros testes que importam offline.ts) ── */
jest.mock('expo-sqlite', () => ({
  __esModule: true,
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    withTransactionAsync: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    closeAsync: jest.fn(async () => undefined),
  })),
}))

/* ── react-native (stub mínimo só pros imports não crasharem) ──────────── */
jest.mock('react-native', () => ({
  __esModule: true,
  Alert: {
    alert: jest.fn(),
  },
  BackHandler: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    removeEventListener: jest.fn(),
    exitApp: jest.fn(),
  },
  Platform: {
    OS: 'android',
    Version: 31,
    select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
  },
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    flatten: (s: unknown) => s,
    hairlineWidth: 1,
  },
  Dimensions: {
    get: jest.fn(() => ({ width: 360, height: 640, scale: 2, fontScale: 1 })),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Linking: {
    openURL: jest.fn(async () => true),
    canOpenURL: jest.fn(async () => true),
  },
  PixelRatio: {
    get: () => 2,
    getFontScale: () => 1,
    roundToNearestPixel: (x: number) => Math.round(x),
  },
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  NativeModules: {},
  // Componentes UI: stubs como funções (suportam defaultProps que App.tsx
  // configura no boot). Strings simples não aceitam set de propriedades.
  View: function View() { return null },
  Text: function Text() { return null },
  ScrollView: function ScrollView() { return null },
  TouchableOpacity: function TouchableOpacity() { return null },
  TouchableWithoutFeedback: function TouchableWithoutFeedback() { return null },
  Pressable: function Pressable() { return null },
  TextInput: function TextInput() { return null },
  Image: 'Image',
  Modal: 'Modal',
  ActivityIndicator: 'ActivityIndicator',
  Switch: 'Switch',
  FlatList: 'FlatList',
  SafeAreaView: 'SafeAreaView',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  RefreshControl: 'RefreshControl',
  StatusBar: { setBarStyle: jest.fn() },
  Animated: {
    Value: class { setValue() {} },
    View: 'AnimatedView',
    timing: () => ({ start: jest.fn() }),
    spring: () => ({ start: jest.fn() }),
  },
  Vibration: { vibrate: jest.fn() },
}))

/* ── @expo/vector-icons (ESM-only — não compila com ts-jest) ───────────── */
jest.mock('@expo/vector-icons', () => ({
  __esModule: true,
  MaterialIcons: 'MaterialIcons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
  Ionicons: 'Ionicons',
  FontAwesome: 'FontAwesome',
  AntDesign: 'AntDesign',
  Feather: 'Feather',
  Entypo: 'Entypo',
}))

/* ── expo-camera (RN-only, pesado) ─────────────────────────────────────── */
jest.mock('expo-camera', () => ({
  __esModule: true,
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: true, status: 'granted' }, jest.fn()],
}))

/* ── expo-linking ───────────────────────────────────────────────────────── */
jest.mock('expo-linking', () => ({
  __esModule: true,
  openURL: jest.fn(async () => true),
  canOpenURL: jest.fn(async () => true),
  createURL: jest.fn((path: string) => `fyneex://${path}`),
}))

/* ── react-native-safe-area-context ────────────────────────────────────── */
jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

/* ── react-native-gesture-handler ───────────────────────────────────────── */
jest.mock('react-native-gesture-handler', () => ({
  __esModule: true,
  GestureHandlerRootView: 'GestureHandlerRootView',
  ScrollView: 'ScrollView',
}))

/* ── react-native-reanimated ────────────────────────────────────────────── */
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    createAnimatedComponent: (c: unknown) => c,
    Value: class { setValue() {} },
    View: 'View',
  },
  useSharedValue: (v: unknown) => ({ value: v }),
  useAnimatedStyle: () => ({}),
  withTiming: (v: unknown) => v,
  withSpring: (v: unknown) => v,
  Easing: { linear: 'linear', ease: 'ease' },
  interpolate: () => 0,
  Extrapolate: { CLAMP: 'clamp' },
}))

/* ── @shopify/flash-list ────────────────────────────────────────────────── */
jest.mock('@shopify/flash-list', () => ({
  __esModule: true,
  FlashList: 'FlashList',
}))

/* ── expo-updates (ESM) ─────────────────────────────────────────────────── */
jest.mock('expo-updates', () => ({
  __esModule: true,
  isEnabled: false,
  channel: 'preview',
  runtimeVersion: '1.0.0',
  updateId: null,
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(async () => ({ isNew: false })),
  reloadAsync: jest.fn(async () => undefined),
}))

/* ── expo-asset / expo-font / expo-splash-screen ───────────────────────── */
jest.mock('expo-asset', () => ({ __esModule: true, Asset: { fromModule: () => ({ downloadAsync: jest.fn() }) } }))
jest.mock('expo-font', () => ({ __esModule: true, useFonts: () => [true, null], loadAsync: jest.fn(async () => undefined) }))
jest.mock('expo-splash-screen', () => ({
  __esModule: true,
  preventAutoHideAsync: jest.fn(async () => undefined),
  hideAsync: jest.fn(async () => undefined),
}))
jest.mock('expo-status-bar', () => ({ __esModule: true, StatusBar: 'StatusBar' }))
jest.mock('expo-system-ui', () => ({ __esModule: true, setBackgroundColorAsync: jest.fn(async () => undefined) }))

/* ── @react-native-community/netinfo ────────────────────────────────────── */
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => undefined),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
  addEventListener: jest.fn(() => () => undefined),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}))
