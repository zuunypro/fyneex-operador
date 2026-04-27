# Suite de testes — App Celular Fyneex (Operador)

Esta pasta concentra a blindagem unitária do app celular. Foco em **lógica
pura + behaviors críticos** — utils, services (api/offline/storage/db),
stores (zustand), hooks utilitários, regressões históricas, smoke imports
de TODOS os arquivos `src/*` (incluindo App.tsx).

## Stats

- **370 testes / 23 suites / ~2s de execução**
- **80% de cobertura de linhas** sobre src/utils + src/services + src/stores + hooks/useDebouncedValue + hooks/useToast + src/schemas
- **100% cobertura** em: format, text, fieldClassification, kitItems (97%), participants (98%), errorMessages, feedback, formatters, db, navigationStore, useDebouncedValue, useToast

## Como rodar

```bash
npm test                  # roda toda a suite (~2s)
npm run test:watch        # modo watch (desenvolvimento)
npm run test:coverage     # com relatório de cobertura
npm run test:regression   # só os bugs históricos blindados
```

**Sempre rode antes de subir APK**:

```bash
npm test && npm run apk
```

## Organização

```
tests/
├── setup.ts                          # mocks globais (expo/RN/AsyncStorage)
├── __mocks__/
│   └── sqliteMemory.ts               # SQLite in-memory pra testar offline.ts
├── utils/                            # 7 suites
│   ├── format.test.ts                # CPF + telefone BR
│   ├── text.test.ts                  # acentos + lowercase
│   ├── fieldClassification.test.ts   # kit / identity / other
│   ├── kitItems.test.ts              # build do kit + ID filter
│   ├── participants.test.ts          # busca + agrupamento
│   ├── errorMessages.test.ts         # tradução PT-BR
│   └── feedback.test.ts              # haptics não-throw
├── services/                         # 7 suites
│   ├── api.test.ts                   # ApiError + validação BASE_URL
│   ├── api-fetch.test.ts             # apiGet/apiPost/apiLogout (fetch real mockado)
│   ├── formatters.test.ts            # formatEventDateTime
│   ├── storage.test.ts               # estimate + check + formatBytes
│   ├── secureToken.test.ts           # accessHash + device id
│   ├── offline.test.ts               # redactForOffline (LGPD)
│   ├── offline-stateful.test.ts      # SQLite roundtrip (savePacket, loadParticipantsPaginated, queue cap, etc)
│   └── db.test.ts                    # singleton + migrations + transação
├── stores/                           # 3 suites
│   ├── userStore.test.ts             # set/clear/load + migração legacy
│   ├── navigationStore.test.ts       # logout + tab + evento
│   └── offlineStore.test.ts          # syncNow + 200/429/409/401/404/400/500 + retry/wipe/delete/recover
├── hooks/                            # 2 suites (jsdom env)
│   ├── useDebouncedValue.test.ts     # debounce + cleanup
│   └── useToast.test.ts              # show/dismiss + auto-hide
├── schemas/
│   └── user.schema.test.ts           # contrato User
├── regression/
│   └── known-bugs.test.ts            # REG-001..016 (16 bugs históricos blindados)
└── smoke/
    └── imports.test.ts               # smoke import de TODOS os src/* + App.tsx
```

## Estratégia: por que NÃO jest-expo?

`jest-expo` puxa o runtime RN inteiro pra testes (~30s startup), assume
device/emulador pra alguns mocks e exige Babel + Metro. Em vez disso:

- **`ts-jest`** compila TS direto, sem Metro/Babel.
- **Mocks manuais** em [setup.ts](setup.ts) cobrem todos os módulos
  RN/Expo que o app importa: `react-native`, `@expo/vector-icons`,
  `expo-camera`, `expo-secure-store`, `expo-application`, `expo-crypto`,
  `expo-haptics`, `expo-file-system`, `expo-sqlite`, `expo-updates`,
  `expo-asset`, `expo-font`, `expo-splash-screen`, `expo-status-bar`,
  `expo-system-ui`, `expo-linking`, `react-native-safe-area-context`,
  `react-native-gesture-handler`, `react-native-reanimated`,
  `@shopify/flash-list`, `@react-native-community/netinfo`,
  `@react-native-async-storage/async-storage`.
- **`globalThis`** preserva estado dos mocks de storage cross-`resetModules`
  (necessário pros testes que simulam novo boot do app).
- **Fake SQLite** em [__mocks__/sqliteMemory.ts](__mocks__/sqliteMemory.ts):
  máquina de estado que entende as queries específicas do `offline.ts` —
  permite testar savePacket/loadPacket/enqueue/queue cap/redact roundtrip
  de verdade, sem device.

## O que está blindado

### Lógica pura (utils)
- CPF/telefone formatação (incl. strip `+55`, fallback formatos inesperados)
- Busca acentuada (`João` ↔ `joao`) + null-safety em packets legacy
- Construção do kit (Garrafa não some, dedupe, label custom preservado, identidade filtrada)
- Tradução de erros do backend (códigos conhecidos, 429 com `Retry-After`, 5xx, network, HTML)

### Services
- **api.ts**: ApiError + validação BASE_URL (HTTP rejeitado, allowlist), apiGet/apiPost com headers, JSON parse, 502 com HTML não vaza, 429 Retry-After header, AbortController timeout, apiLogout best-effort
- **secureToken**: token vai pra SecureStore (não AsyncStorage), device id estável, hash determinístico, fallback UUID
- **offline (LGPD)**: redact de PII, search_text mantido buscável sem persistir CPF, queue cap 5000
- **offline (SQLite roundtrip)**: savePacket atomicidade (download_complete=0/1), loadPacket descarta packet incompleto, paginação + filters search/status, patchParticipantInPacket, removePacket cascata
- **storage**: estimate bytes, formatBytes (B/KB/MB/GB), API indisponível NÃO bloqueia
- **db**: migrations rodam só pra version > atual, withTransaction propaga throw, closeDb permite reopen
- **formatters**: ISO completo + ISO date-only + BR + null/undefined

### Stores
- **userStore**: token vai pra SecureStore (não JSON), migração legacy idempotente, token órfão limpo
- **navigationStore**: logout chama servidor antes de limpar, skipServer skipa, resilience
- **offlineStore**: syncNow drena fila, status code handling (429/409/401/404/400/500), attempts + MAX_AUTO_ATTEMPTS, retryAction reset attempts, wipeAll com backup, deleteEvent cascata, isOnlineNow + getPacketMeta

### Hooks
- **useDebouncedValue**: debounce + cleanup no unmount + delay 0 imediato
- **useToast**: show/dismiss + auto-hide + race protection (timer antigo NÃO esconde toast novo)

### Smoke (TODOS os src/*)
- Import sem throw: components, pages, hooks, services, stores, schemas, theme + App.tsx
- Detecta circular imports, top-level errors, typo em re-exports

### Regressões históricas (REG-001 a REG-016)
1. Busca acentuada (joão != joao)
2. Packet legacy null crashava .toLowerCase()
3. Garrafa sumia
4. CPF expunha 6+ dígitos
5. Telefone +55 sem strip
6. 429 sem Retry-After mostrava "Erro 429"
7. formatBytes(NaN) retornava "NaN B"
8. events.date timestamptz virava "—"
9. HTML do gateway 502 vazava
10. Categorias custom (Boné, Mochila) não cabiam
11. Busca CPF 1 dígito retornava todos
12. Multi-ticket espalhado no portão
13. Token órfão sobrevivia ao logout
14. setUser persistia token em AsyncStorage (PII leak)
15. friendlyError(undefined) crashava
16. kitItems duplicava label estoque + form

## O que NÃO está coberto aqui

- **Rendering RN/UI completo**: smoke garante que importa, mas snapshot/interaction
  ficam em e2e (manual em device/emulador) ou jest-expo se quiser adicionar.
- **Network real**: testes mockam fetch — smoke de produção rola em staging.

## Adicionando testes

Quando corrigir um bug:
1. Reproduza primeiro com um teste em `tests/regression/known-bugs.test.ts`
   (ele deve falhar antes do fix).
2. Aplique o fix em `src/`.
3. Rode `npm test` — deve passar.
4. Commite teste + fix juntos. O teste vira parte da blindagem permanente.

Convenção de naming: `REG-NNN — descrição curta do bug`.
