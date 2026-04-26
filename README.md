# Fyneex Organizador — App Nativo

App nativo Android do portal do operador (Expo SDK 52 + React Native 0.76). Porta 1:1 a versão web antiga (`web-legacy/`), troca scanner HTML por ML Kit nativo (offline), e usa Expo EAS pra build + OTA.

---

## ⚡ Fluxo simples

### 🔧 Setup (uma vez, ~5 min)

1. Conta grátis: https://expo.dev/signup
2. Na pasta `celular/`:

```bash
npm install
npm install -g eas-cli
eas login                  # email + senha da conta
eas init                   # cria projeto, grava projectId no app.json
```

O `eas init` preenche o `projectId` no `app.json`. Abra o arquivo e troque também `"url": "https://u.expo.dev/REPLACE_WITH_PROJECT_ID"` pelo valor real.

### 📱 Gerar APK

```bash
npm run apk
```

EAS builda na nuvem (10–15min). No final imprime URL tipo `https://expo.dev/artifacts/eas/abc.apk`.

**No celular:**
1. Abra essa URL no Chrome
2. Baixa o APK
3. Abre o arquivo — Android pede "permitir fonte desconhecida" (só na 1ª vez)
4. Instala

### 🔄 Mandar update sem reinstalar APK

Pra mudanças de código JS/UI/lógica (99% das vezes):

```bash
npm run push "o que mudou"
```

30 segundos depois:
- **Automático:** fecha e abre o app → baixa em background → aplica no próximo open
- **Manual:** Perfil → "Procurar atualização" → "Aplicar agora" (reinicia na versão nova)

No Perfil aparece o hash do bundle — se mudou, é versão nova.

### 📲 Quando precisa de APK novo (não resolve com OTA)

- Mudou permissão Android (`app.json > android.permissions`)
- Adicionou lib com código nativo
- Bumpou `app.json > expo.version`

Fluxo: `npm run apk` → instala por cima do antigo (mesma assinatura, não apaga dados).

---

## 🛠 Comandos

| Comando | Faz |
|---|---|
| `npm run apk` | APK preview (canal `preview`) |
| `npm run apk:prod` | APK production |
| `npm run push "msg"` | Update OTA canal `preview` |
| `npm run push:prod "msg"` | Update OTA canal `production` |
| `npm run start` | Dev server |

APK preview ↔ updates preview. APK production ↔ updates production. Nunca cruze.

---

## 🧪 Dev local

```bash
npm run start
```

Expo Go (Play Store) no celular, scaneia o QR do terminal. Hot reload funciona.

⚠️ Se câmera ficar preta em Expo Go:
```bash
eas build --profile development --platform android
```
Gera APK de dev client, instala uma vez, `npm run start` conecta direto nele.

---

## 🌐 Backend — CORS

Fetch nativo do RN manda request **sem header `Origin`**. O middleware CORS dos endpoints `/api/mobile/*` precisa aceitar Origin ausente (auth já é por `Authorization: Bearer <accessHash>`). Sem isso, login retorna "Falha de rede".

---

## 📦 Env

`.env` (copia de `.env.example`):
```
EXPO_PUBLIC_API_URL=https://fyneexsports.com
```

---

## 🗂 Estrutura

```
celular/
  App.tsx                 router raiz, hidrata user, OTA check auto
  app.json                config Expo + URL updates + projectId
  eas.json                perfis de build

  assets/                 ícone, splash

  src/
    theme/                tokens cor/spacing (port do index.css web)
    components/           AppShell, BottomNav, QRScanner (ML Kit), modais
    pages/                Login, EventSelector, Dashboard, Checkin, Stock, Profile
    hooks/                12 hooks (react-query + zustand + AsyncStorage)
    stores/               userStore, navigationStore
    services/             api.ts (fetch direto), formatters.ts

  web-legacy/             código Vite antigo preservado
```

---

## ❓ Troubleshooting

- **Câmera em preto:** Configurações > Apps > Fyneex Organizador > Permissões > Câmera
- **"Falha de rede" no login:** CORS do backend (veja acima) ou URL errada no `.env`
- **Update OTA não chegou:** `eas update:list --branch preview` — confira se `app.json > expo.updates.url` aponta pro `projectId` correto. App só busca em release build (não em dev)
- **APK não instala:** permitir "fontes desconhecidas" nas configs Android pro app que abre o APK
- **Build EAS falha:** `eas doctor` + `npx expo install --check` pra alinhar versões
