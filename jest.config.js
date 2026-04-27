/**
 * Jest config — testes unit-focused na lógica pura do app celular.
 *
 * Estratégia: NÃO usamos jest-expo (overhead de RN runtime + Metro). Em vez
 * disso, ts-jest compila TS direto, e os módulos nativos (expo-*, react-native,
 * @react-native-async-storage, etc.) ficam mocados em `tests/setup.ts` e
 * `tests/__mocks__/`. Isso permite rodar a suite em qualquer CI/Node sem
 * device/emulator, e mantém o foco em lógica de negócio (formatters, search,
 * kitItems, errorMessages, stores) — onde 90% das regressões do app moram.
 *
 * Cobertura mínima alvo: 95%+ de utils/ e services/formatters.ts +
 * services/storage.ts; cobertura útil em services/secureToken.ts (paths
 * de fallback / cache) e stores/userStore.ts (migração legacy).
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  // testEnvironment node usado por padrão (suite é majoritariamente lógica
  // pura). Hooks com renderHook precisam de jsdom — declaração via doc-block
  // no topo do arquivo `tests/hooks/*.test.ts`.
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.test.tsx',
    '<rootDir>/src/**/*.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
          esModuleInterop: true,
          allowJs: true,
          target: 'es2019',
          module: 'commonjs',
          moduleResolution: 'node',
          strict: true,
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
          types: ['jest', 'node'],
          isolatedModules: true,
          skipLibCheck: true,
          allowSyntheticDefaultImports: true,
        },
        diagnostics: {
          // Não falha em diagnóstico TS pra não bloquear feedback de teste —
          // a checagem real de tipos roda no `tsc` separado.
          ignoreCodes: [151001, 6133, 6196, 2304, 2305, 2307, 2322, 2339, 2345, 2532, 2554, 2769, 7006, 7053, 7016, 18046, 2403, 2497],
        },
      },
    ],
  },
  testPathIgnorePatterns: ['/node_modules/', '/web-legacy/', '/.expo/', '/dist/'],
  clearMocks: true,
  resetMocks: false,
  collectCoverageFrom: [
    'src/utils/**/*.ts',
    'src/services/**/*.ts',
    'src/stores/**/*.ts',
    'src/hooks/useDebouncedValue.ts',
    'src/hooks/useToast.ts',
    'src/schemas/**/*.ts',
    '!src/**/*.d.ts',
    '!src/theme/**',
  ],
  // Timer auto-retry no offlineStore mantém handle aberto entre tests; o
  // forceExit é pragmático aqui — alternativa seria expor um clearAllTimers()
  // do store só pra teste, polluindo a API pública.
  forceExit: true,
  coverageDirectory: 'tests/__coverage__',
  coverageReporters: ['text', 'text-summary'],
  // Testes legítimos podem fazer setTimeout (offline retry mocks). 10s é
  // teto de paranoia — testes saudáveis fecham em ms.
  testTimeout: 10_000,
}
