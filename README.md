# Transcritor

Aplicativo mobile em **Expo (SDK 58)** / **React Native** para gravar ou importar áudios de **palestras, aulas, reuniões e entrevistas**, organizar tudo em pastas e sessões, ouvir o áudio clicando diretamente em qualquer palavra da transcrição e editar manualmente trechos ou palavras incorretas — com tema escuro e transcrição **100% offline** sem limites de minutos.

---

## Funcionalidades

- **Organização por Pastas e Sessões:**
  - Crie pastas personalizadas, mova sessões entre pastas e filtre por pasta ou categoria (`Palestra`, `Aula`, `Reunião`, `Entrevista`, `Outro`).
  - Veja a contagem de áudios, duração total, quantidade de transcrições, marcadores e prévia do texto.
- **Múltiplos Áudios e Transcrições por Sessão:**
  - Grave um ou mais áudios dentro da mesma sessão (em `.wav` 16-bit PCM a 16 kHz no celular) ou importe arquivos `.wav` externos do aparelho.
  - Renomeie cada áudio; as transcrições acompanham automaticamente o nome do áudio correspondente.
- **Marcadores de Momento Importante:**
  - Marque segundos importantes **durante a gravação** ou **durante a reprodução**, renomeie marcadores e pule direto para eles com um toque.
- **Player de Áudio Completo:**
  - Controles de Play/Pause, barra de progresso clicável, avançar/voltar 10s, velocidade (`1x`, `1.25x`, `1.5x`, `2x`) e reprodução em segundo plano.
- **Transcrição Interativa, Editável e com Progresso:**
  - **100% Offline Embutida:** modelo Whisper Base (`ggml-base.bin`, ~148 MB) já embutido no app — sem internet, sem conta e sem chave de API. A IA é carregada apenas durante a transcrição e liberada automaticamente ao terminar ou ir para segundo plano.
  - **Progresso real (0%–100%) e Cancelar:** acompanhe o andamento e cancele a transcrição a qualquer momento.
  - **Clique para ouvir:** toque em qualquer palavra ou timestamp para pular o áudio para aquele instante, com destaque em tempo real da palavra reproduzida.
  - **Edição inline:** ative **Editar Palavras** (ou segure sobre uma palavra) para corrigir palavras individuais, ou edite o trecho inteiro.
  - **Busca e compartilhamento:** filtre palavras dentro da transcrição e compartilhe o texto via `Share` nativo.

---

## Stack e Dependências

- **Expo SDK 58** (`expo ~58.0.25`)
- **React 19.3.0** / **React Native 0.88.1**
- **Expo Router** (`expo-router ~58.0.31`) — roteamento baseado em arquivos em `src/app/`
- **Expo Audio** (`expo-audio ~58.0.12`) — gravação (`useAudioStream` em `.wav` no celular) e reprodução
- **Expo FileSystem** (`expo-file-system ~58.0.13`) e **Expo Document Picker** (`expo-document-picker`)
- **whisper.rn** (`^0.7.4`) — inferência local em C++/JSI usando `whisper.cpp`

---

## Estrutura do Projeto

```text
transcritor/
├── app.json                    # Configurações Expo, permissões e identificadores Android/iOS
├── eas.json                    # Perfis de build (development, preview, production)
├── metro.config.js             # Suporte a assets .bin (modelo Whisper embutido)
├── package.json                # Dependências e scripts
├── tsconfig.json               # Configuração TypeScript (strict)
├── assets/models/
│   └── ggml-base.bin           # Modelo Whisper Base embutido (~148 MB)
└── src/
    ├── types.ts                # Tipos de Folder, Lesson, SessionTag, AudioBookmark, etc.
    ├── storage.ts              # Persistência local (lessons.json / folders.json / localStorage na Web)
    ├── transcribe.ts           # Motor offline whisper.rn com progresso, cancelamento e liberação de memória
    └── app/
        ├── _layout.tsx         # Navegador Stack raiz + liberação da IA em background
        ├── index.tsx           # Tela inicial: pastas, filtros por tipo, sessões
        ├── settings.tsx        # Status da IA offline embutida
        └── recording/
            └── [id].tsx        # Tela da sessão: gravação/importação, player, marcadores e transcrição
```

---

## Comandos Úteis

```bash
npm install        # Instalar dependências
npx tsc --noEmit   # Typecheck TypeScript
npx expo lint      # Linter ESLint
npx expo-doctor    # Diagnóstico do projeto Expo
npx expo start -c  # Iniciar servidor de desenvolvimento
```

> **Nota para celular:** como o projeto usa `whisper.rn` (código nativo em C++ / JSI), a transcrição offline funciona apenas em um **Development Build** ou build nativo (não no Expo Go padrão nem no navegador):
>
> ```bash
> npx eas-cli@latest build --profile development --platform android
> # ou localmente com Android Studio:
> npx expo run:android
> ```
