# Transcritor de Aulas

Aplicativo mobile em **Expo (SDK 58)** / **React Native** para gravar aulas, organizar múltiplos áudios e transcrições por aula, ouvir o áudio clicando diretamente em qualquer palavra da transcrição e editar manualmente trechos ou palavras incorretas — com tema escuro e foco em transcrição **100% offline** sem limites de minutos.

---

## Funcionalidades

- **Organização por Aulas:**
  - Crie e renomeie aulas na tela inicial ou diretamente na tela da aula.
  - Veja a contagem de áudios, duração total, quantidade de transcrições e prévia do texto.
- **Múltiplos Áudios e Transcrições por Aula:**
  - Grave um ou mais áudios dentro da mesma aula e renomeie cada áudio.
  - Gere e alterne entre múltiplas transcrições na aula; cada transcrição mantém automaticamente o mesmo nome do áudio transcrito.
- **Player de Áudio Completo:**
  - Controles de Play/Pause, avançar/voltar 10s e velocidade (`1x`, `1.25x`, `1.5x`, `2x`).
  - Suporte a gravação e reprodução em segundo plano configurados via `expo-audio`.
- **Transcrição Interativa e Editável:**
  - **Clique para ouvir:** toque em qualquer palavra ou timestamp para pular o áudio exatamente para aquele instante, com destaque em tempo real da palavra reproduzida.
  - **Edição inline:** ative **Editar Palavras** (ou segure sobre uma palavra) para corrigir palavras individuais, ou toque no ícone de lápis do trecho para editar a frase inteira.
  - **Busca e compartilhamento:** filtre palavras dentro da transcrição e compartilhe o texto via `Share` nativo.
- **Tema Escuro:** interface em paleta escura (`#020617` / `#0F172A` / `#3B82F6`).
- **Configurações do Modelo Offline:** gerencie o download ou remoção do modelo `ggml-base.bin` (~142 MB) diretamente no aparelho.

---

## Stack e Dependências

- **Expo SDK 58** (`expo ~58.0.25`)
- **React 19.3.0** / **React Native 0.88.1**
- **Expo Router** (`expo-router ~58.0.31`) — roteamento baseado em arquivos em `src/app/`
- **Expo Audio** (`expo-audio ~58.0.12`) — gravação e reprodução de áudio
- **Expo FileSystem** (`expo-file-system ~58.0.13`) — persistência local (`lessons.json`) e download do modelo Whisper
- **whisper.rn** (`^0.7.4`) — inferência local em C++/JSI usando `whisper.cpp`

---

## Estrutura do Projeto

```text
transcritor/
├── app.json                    # Configurações Expo e plugins (expo-router, expo-audio, expo-secure-store)
├── package.json                # Dependências e scripts
├── tsconfig.json               # Configuração TypeScript (strict)
└── src/
    ├── types.ts                # Tipos de Lesson, LessonAudio, LessonTranscription e TranscriptSegment
    ├── storage.ts              # Persistência local (lessons.json / localStorage na Web) e utilitários
    ├── transcribe.ts           # Integração offline com whisper.rn e download de ggml-base.bin
    └── app/
        ├── _layout.tsx         # Navegador Stack raiz com tema escuro
        ├── index.tsx           # Tela inicial: listagem e criação de aulas
        ├── settings.tsx        # Gerenciamento do modelo offline Whisper Base (~142 MB)
        └── recording/
            └── [id].tsx        # Tela da aula: gravação, player, transcrições clicáveis e edição
```

---

## Pré-requisitos e Execução

### 1. Instalar dependências

```bash
npm install
```

### 2. Verificações de código

```bash
npx tsc --noEmit   # Typecheck TypeScript
npx expo lint      # Linter ESLint
npx expo-doctor    # Diagnóstico do projeto Expo
```

### 3. Iniciar servidor de desenvolvimento

```bash
npx expo start -c
```

> **Importante:** como o projeto usa `whisper.rn` (código nativo em C++ / JSI), **a transcrição offline não funciona no Expo Go padrão nem no navegador**. Para rodar a transcrição no celular, é necessário gerar um **Development Build** ou build nativo:
>
> ```bash
> npx expo run:android
> # ou via EAS Build:
> npx eas-cli@latest build --profile development --platform android
> ```

---

## Estado Atual e Pendências Conhecidas

Antes de gerar o APK/IPA final de produção, os seguintes pontos foram identificados na auditoria do projeto e precisam ser resolvidos:

1. **Formato de áudio para `whisper.rn`:** `src/app/recording/[id].tsx` atualmente grava usando `RecordingPresets.HIGH_QUALITY` (`.m4a`), enquanto o `whisper.rn` exige arquivos **WAV 16-bit PCM** (`.wav`). É necessário migrar a gravação para gerar `.wav` (ex.: via `useAudioStream` + `startFileRecordingAsync({ format: 'wav' })` do `expo-audio`).
2. **Dependências para bundle Android e `expo-doctor`:**
   - Instalar peer dependencies faltantes: `npx expo install expo-font expo-asset`
   - Resolver a dependência `buffer` exigida indiretamente por `whisper.rn` (`safe-buffer`) no Metro bundler.
3. **Identificadores de build nativo:** adicionar `android.package` e `ios.bundleIdentifier` em `app.json`, além de criar `eas.json` caso utilize o EAS Build.
4. **Melhorias de robustez pendentes:** bloquear transcrições simultâneas na UI, validar download completo do `ggml-base.bin` via arquivo temporário e sincronizar estado ao trocar entre áudios durante a reprodução.
