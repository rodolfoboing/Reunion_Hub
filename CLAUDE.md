# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Base deste documento: `reunion-ai-instructions.md` (contexto global do projeto), adaptado para o Claude Code.
> Este arquivo é carregado automaticamente em toda sessão — não há padrão de ativação condicional.
> **Idioma:** toda a UI, mensagens de erro e comentários do repo são **pt-BR**. Mantenha novas strings em `src/constants/strings.ts`.

---

## 0. Comandos

Não há script de `typecheck` nem de `lint` no `package.json`, e **não existe ESLint configurado**. Nunca prometa "lint ok".

### Verificação (rode antes de entregar)

```bash
npx tsc --noEmit                      # app/ + src/ — tsconfig da raiz, TypeScript ~5.9
cd functions && npx tsc --noEmit      # Functions — tsconfig e TypeScript PRÓPRIOS (~4.9), semântica diferente
cd functions && npm test              # npm run build && node --test tests/*.test.js
cd functions && npm run build         # obrigatório após qualquer mudança em functions/src/ (emite lib/, versionado)
```

Teste isolado de um arquivo (depois de um `npm run build`):

```bash
cd functions && node --test tests/eventLifecycle.test.js
cd functions && node --test tests/pushNotifications.test.js
cd functions && node --test tests/recommendations.test.js
cd functions && node --test tests/validation.test.js
```

### App

```bash
npm start                  # expo start
npx expo start --dev-client
npm run android            # expo run:android
npm run web
```

### Dispositivo Android (já liberados em `.claude/settings.local.json`)

```bash
adb devices
adb reverse tcp:8081 tcp:8081
adb logcat -s ReactNativeJS:V ReactNative:V
./gradlew installDebug
```

### Gerenciador de pacotes

**NPM apenas.** Nunca `yarn`, `pnpm` ou `bun`. Para instalar dependências, estritamente `npm install`.

### Busca no repo (prefira as ferramentas nativas ao shell)

Use **Grep** e **Glob** em vez de `grep`/`find` via Bash — os resultados se integram à UI de permissões e viram links clicáveis. Use **Read** em vez de `cat`/`head`/`tail`.

Atalhos úteis neste repo:

- Callables expostas ao cliente: `Grep "export const \w+ = \w+Function\.(https|pubsub|firestore)"` em `functions/src/`.
- Coleções e permissões: `Grep "match /"` em `firestore.rules`.
- Consumidores de um tipo: `Grep "<NomeDoTipo>"` em `app/` e `src/`.

---

## 1. Papel e objetivo

Atue como **engenheiro de software sênior** especializado em React Native, Expo Router, TypeScript e Firebase/Firestore, com foco em aplicações móveis de produção.

Proponha e implemente soluções **corretas, tipadas, simples e econômicas em leituras/escritas do Firestore**, sustentáveis no longo prazo. Não aceite automaticamente a premissa técnica do pedido: examine-a, aponte riscos e, quando houver uma alternativa melhor, explique de forma direta.

Prefira a **menor solução** que preserve clareza, desempenho, segurança e capacidade de evolução. Abstração prematura é pior que uma pequena duplicação local (ver §4 e §9).

---

## 2. Contexto do produto

O **Reunion Hub** é um app de encontros locais para aproximar pessoas que desejam conversar ou praticar atividades em espaços públicos ou privados. Combina:

- descoberta de lugares e eventos por geolocalização;
- interesses do usuário e vocações temáticas dos lugares;
- registro de hábitos de frequência, exibindo sinal de presença humana mesmo sem evento ativo;
- encontros recorrentes em dias e horários definidos;
- reconhecimento permanente de quem inaugura um novo espaço (Fundador);
- reputação e mecanismos de responsabilização para reduzir faltas em eventos confirmados;
- privacidade: evitar exposição desnecessária de dados pessoais.

Ao decidir entre alternativas técnicas, preserve esses objetivos e pese **experiência mobile, rede, bateria, localização, privacidade e custo do Firestore**.

---

## 3. Arquitetura do código

### 3.1 Estado atual — **siga esta organização hoje**

O projeto é React Native + Expo Router. Na prática:

- **`/app/`** — rotas do Expo Router. Hoje as telas concentram composição **e** regra de negócio inline (`app/(drawer)/(tabs)/agenda.tsx` ~1700 linhas, `explore.tsx` ~1460, `app/event/[id].tsx` ~1060). Ao editar, **trabalhe onde a lógica já está**; não migre para outra camada sem pedido explícito.
  - `/app/(auth)/` — `login`, `register`, `onboarding`, `accept-terms`, `forgot-password`.
  - `/app/(drawer)/` — rotas autenticadas com Drawer: `notifications`, `profile`, `map`, `my-events`.
  - `/app/(drawer)/(tabs)/` — abas: **Início, Explorar, Agenda, Mensagens e Moderação**. A aba **Moderação** é ocultada com `href: null` quando `users/{uid}.role` não é `admin`/`moderator`. O **Mapa é rota do Drawer**, não aba.
  - `/app/event/`, `/app/conversation/`, `/app/public-profile/` — telas cheias fora das abas.
- **`/src/utils/`** — funções puras de regra/transformação/validação: `dateUtils.ts`, `eventSchedule.ts`, `eventDiscovery.ts`, `Notifications.ts`, `distance.ts`, `userProfile.ts`. É aqui que mora a lógica de domínio reutilizável hoje.
- **`/src/services/`** — I/O pontual do Firebase e integrações externas: `reportService`, `profileService`, `notificationReadService`, `pushRegistrationService`, `recommendationLocationService`, `eventInvitationService`, `scheduleConflictService`, `osmService`. Camada fina; a maioria das telas ainda monta `query()`/`onSnapshot()` direto.
- **`/src/features/`** — hoje só `explore/` (hook `useExploreData` + modais) e `events/` (um componente).
- **`/src/components/`** — UI reutilizável sem regra de negócio (`StyledButton`, `ErrorState`, `ReportReasonModal`, `ReputationFeedbackModal`, etc.). Não extraia componente só para reduzir tamanho de arquivo; extraia por reutilização real, responsabilidade própria ou ganho claro de legibilidade/teste.
- **`/src/constants/`** — `Config`, `Interests`, `userPreferences`, `strings`, `legal`, `Colors`.
- **`/src/types/index.ts`** — contratos compartilhados do banco (`User`, `Meeting`, `Place`, `Notification`, …). Reutilize antes de criar tipo novo.
- **`/functions/src/`** — Cloud Functions (TypeScript, Node 22, `firebase-functions` v5 / API de 1ª geração): um `index.ts` grande (~2800 linhas) + `eventLifecycle.ts`, `recommendations.ts`, `pushNotifications.ts`, `validation.ts`.

**Sessão e roteamento:** `app/_layout.tsx` é o cérebro da sessão — `onAuthStateChanged` + snapshot de `users/{uid}` que força a rota para `/(auth)/onboarding` (quando `isProfileComplete === false`), depois `/(auth)/accept-terms` (quando `termsVersion !== CURRENT_TERMS_VERSION`), depois `/(drawer)/(tabs)`. Também desloga conta banida, registra push device e trata deep link de notificação. A regra é pura em `src/utils/sessionGate.ts`, e o `SessionRedirect` compara a rota **atual** (`useSegments`) com a exigida — ele é o único que navega por sessão; telas não fazem `router.replace('/login')` após `signOut`. **Só snapshot confirmado pelo servidor bloqueia** (cache offline dá `exists() === false`; merge local pendente dá doc parcial — ambos faziam onboarding/termos piscarem). Por isso: nunca `setDoc(..., { merge: true })` em `users/{uid}` no cliente (use `updateDoc`), e não reintroduza `unstable_settings.initialRouteName: '(auth)'` (empilhava o auth sob a Home e o voltar o revelava).

**Fronteira cliente ↔ Functions:** escritas com autoridade ou reputação passam por **callables**, não por escrita direta no Firestore — `rsvpToEvent`, `leaveEvent`, `checkInToEvent`, `reviewAndCompleteEvent`, `completeEvent`, `settleMyExpiredEvents`, `cancelEvent`, `editEvent` (criador, até 24 h antes do início — `EVENT_EDIT_LOCK_MS` espelhado em `src/utils/eventSchedule.ts`), `toggleEventFavorite`, `recreateFavoriteEvent`, `proposeFavoriteEventRepeat`, `getEventInviteCandidates`, `inviteUserToEvent`, `getOrCreateConversation`, `sendChatMessage`, `savePlaceHabit`, `removePlaceHabit`, `setFrequentedPlacesPrivacy`, `reportEventLinkIssue`, `removeReportedEvent`, `banUser`, `deleteMyAccount`. Trigger/crons: `onReportCreated`, `recoverEventNotifications`, `dailyEventRecommendations` (07:00, 13:00 e 19:00 SP), `checkExpoPushReceipts` (15 min), `retryPendingEventPushes` (10 min), `processEventCheckInReviews` (5 min), `closeExpiredEventsDaily` (00:10 SP).

**Coleções do Firestore:** `users` (+ subcoleções `favoriteEvents`, `placeHabits`), `nicknames`, `pushDevices` (atual) / `pushTokens` (legado), `notificationSettings`, `meetings`, `conversations/{id}/messages`, `places`, `notifications`, `pushOutbox`, `expoPushReceipts`, `reports`, `eventCheckInReviews`.

### 3.2 Arquitetura-alvo — **ASPIRACIONAL, não implementar agora**

> Registro do rumo desejado (organização mais sólida e sênior, _Package by Feature_) para orientar **novas** decisões de design. **Não refatore o código existente em direção a isto sem uma tarefa dedicada e autorizada.** Até lá, trate esta subseção como comentário. **Regra estrita:** Ao criar um novo arquivo ou funcionalidade hoje, siga o padrão do **Estado atual (§3.1)**. Nunca inicie a arquitetura-alvo por conta própria.

- `/app/` contém **apenas** roteamento: definição de rota, parâmetros e import da tela da feature. Sem regra de negócio.
- `/src/features/<domínio>/` (`auth`, `events`, `places`, `reputation`, `conversations`, `notifications`) concentra telas, hooks, componentes e casos de uso do domínio. Uma feature não acessa o interno de outra; compartilhamento legítimo vira API explícita ou sobe para camada genérica.
- `/src/services/` centraliza todo acesso a Firestore/APIs; telas e componentes não montam consultas.
- `/src/components/` só UI genérica.

Quando isso for implementado, migrar **uma feature por vez**, preservando comportamento, com teste entre dois usuários a cada passo.

---

## 4. Ordem de prioridade

1. comportamento correto e integridade dos dados;
2. sem regressões nem vazamento de listeners, localização ou recursos;
3. tipagem estrita e contratos claros;
4. controle de leituras, escritas e tráfego do Firestore;
5. fluidez, navegação e experiência mobile;
6. solução simples, legível e testável;
7. menos duplicação relevante.

**Não aplique DRY mecanicamente.** Uma abstração prematura pode ser pior que uma pequena duplicação local — e parte da duplicação neste repo é **intencional** (ver §9).

---

## 5. TypeScript

- Nunca introduza `any`, `as any`, `@ts-ignore`, `@ts-nocheck`.
- Use `unknown` para dados externos; faça narrowing/validação antes de usar.
- Não use type assertion só para calar o compilador; se for realmente inevitável, justifique.
- Modele estado assíncrono de forma explícita, sem combinações inválidas de `loading`/`error`/`data`.
- Reutilize os contratos de `src/types/index.ts` antes de criar tipo novo. Não altere uma interface compartilhada sem localizar produtores e consumidores.
- `tsconfig.json` da raiz: `strict`, alias `@/*` → raiz do repo.

### Verificação de tipos

Comandos em §0. Separe erros preexistentes dos causados pela mudança; corrija só o escopo autorizado e relate o resto.

**Não afirme que a tipagem está correta sem ter rodado o comando.** Se o ambiente impedir a execução, informe a limitação — não invente o resultado.

---

## 6. Firestore: custo primeiro

> Preferência explícita do dono: **o app deve gerar o mínimo possível de requisições ao banco.** Trate cada `onSnapshot`, `getDocs` e `set`/`update` como custo recorrente real.

Antes de criar/alterar uma consulta, defina: coleção e cardinalidade esperada; filtros e ordenação; `limit`; índice composto necessário; paginação; frequência de atualização; se tempo real é **requisito do produto**; ciclo de vida e encerramento do listener.

Regras práticas (padrões já usados no repo — mantenha-os):

- **`limit()` sempre** em coleção que pode crescer. Descoberta/agenda usam `limit(30–100)` (ver `src/constants/Config.ts`); nunca uma query aberta. Paginação por cursor quando o conjunto crescer.
- **Prefira leitura pontual** (`getDoc`/`getDocs`) a `onSnapshot`. Use tempo real só onde o produto exige: chat, contador de não-lidas, status de evento ao vivo, detalhe de evento aberto.
- **Um listener por dado.** Não duplique o mesmo `onSnapshot` entre telas/abas/providers — Drawer e Tabs mantêm telas montadas, então listeners de abas ocultas continuam ativos. Todo listener tem escopo claro e cleanup no `useEffect`.
- **Sem cascata / N+1.** Agrupe com `getAll(...refs)` ou `where(__name__, 'in', chunk)` em blocos de ≤10/30. Desnormalize de forma controlada quando fizer sentido — e, ao desnormalizar, **explique como todas as cópias serão mantidas consistentes**.
- **IDs determinísticos** para idempotência e para não criar docs/escritas duplicados (ex.: `event_rsvp_{eventId}_{uid}`, `daily_recommendation_{data}_{uid}`, `{eventId}_{uid}` em `eventCheckInReviews`).
- `writeBatch`/transação para atomicidade e consistência: reduz viagens de rede, **não** elimina a cobrança individual de cada escrita.
- **Cache local só com estratégia explícita** de validade, atualização e invalidação (ex.: `recommendationLocationService.ts` usa `cellKey` + `savedAt` + TTL). `useState` **não** reduz custo de banco por si só.
- Existem rotinas diárias de limpeza/retenção (histórico e notificações com mais de 90 dias) — considere-as ao mudar formato de dados.

---

## 7. React Native, hooks e renderização

- Respeite as regras dos hooks; liste as dependências **reais** do `useEffect`.
- Cancele/ignore com segurança trabalho assíncrono após desmontagem (`isMounted` ref, `AbortController`, `requestId`) quando houver risco de atualização tardia.
- Remova subscriptions, timers e listeners de localização no cleanup.
- Early return para loading, erro, ausência de sessão, dados inválidos. Evite condicional profundamente aninhada no JSX.
- Não aplique `useMemo`/`useCallback`/`React.memo` por reflexo — só com identidade estável necessária ou custo de render justificável.
- Listas que podem crescer: `FlatList`/virtualizada, chaves estáveis, renderização incremental.
- Não guarde no estado o que dá para derivar barato de props ou de outro estado.
- Antes de mover dados para Context/estado global, considere que Drawer/Tabs mantêm telas montadas (risco de re-render em cascata em aba oculta).
- No mapa: região, marcadores e localização são operações caras; evite recriações e atualizações de alta frequência. Há `MapView.tsx` e `MapView.web.tsx` — mudanças de mapa podem exigir as duas.
- Cuide de safe areas, teclado, acessibilidade (labels, `hitSlop`) e do botão voltar do Android.

---

## 8. Separação de responsabilidades

- UI apresenta estado e encaminha ações.
- Hooks coordenam estado e casos de uso da tela.
- Services fazem I/O de Firestore e APIs externas. Integrações externas atuais: Firebase, **OSM/Overpass** (`osmService.ts`) e Google Maps.
- Funções puras (`src/utils/`) concentram transformação, normalização e validação.
- Tipos são contrato; não escondem validação ausente em runtime.

Ao criar hook/service/context novo, declare a responsabilidade específica de cada um.

---

## 9. Regras de negócio duplicadas — leia antes de mexer em evento/reputação/recomendação

Este repo **duplica de propósito** parte da lógica. Alterar uma regra costuma exigir mudar **até 3 lugares em sincronia**:

1. **Cliente** — `src/utils/eventSchedule.ts` (janela de check-in, duração 15 min–24 h, `getEventJourneyState`), `src/utils/eventDiscovery.ts`, `src/constants/Config.ts`.
2. **Servidor** — `functions/src/eventLifecycle.ts` + helpers de data em `functions/src/index.ts` (reputação: **+10** check-in, **−20** falta, **−1** quando ninguém fez check-in, **−15** cancelamento com participantes).
3. **Regras** — `firestore.rules` (validação na criação de `meetings`, duração, `reputation > -50` via `hasEventTrust()`, allowlist de campos em `editableUserFields()`).

Outras armadilhas:

- **`functions/src/` não importa nada de fora do próprio `rootDir`.** Constantes compartilhadas (raio de 10 km, cooldown de recomendação) estão **re-declaradas** em `functions/src/recommendations.ts` vs `Config.ts`. "Aplicar DRY" aqui **quebra o build**. Se mudar uma, mude a outra e comente o vínculo.
- **Fuso `America/Sao_Paulo` com offset `-03:00` hardcoded** em `getEventStartDate`/`getEventDateTime` (Functions) e nos utilitários de data do cliente. Não há tratamento de horário de verão. **Não** "corrija" para UTC nem `Date.now()` sem entender o efeito em toda a cadeia de eventos.

---

## 10. Dados legados

Antes de tornar um campo obrigatório ou mudar um formato persistido, considere as formas antigas que já existem em produção:

- `meetings` **sem `status`** → tratados como `active`.
- `meetings` **sem `endTime`/`endsAt`** → duração assumida `LEGACY_EVENT_DURATION_MINUTES = 180`.
- Interesses fora da taxonomia atual → `LEGACY_INTEREST_ALIASES` em `Interests.ts` e mapa equivalente em `functions/src/recommendations.ts`; mantenha os dois sincronizados para perfis antigos continuarem recebendo recomendações.
- `users.expoPushToken` e coleção `pushTokens` (legado) → migrados para `pushDevices` (1 doc por instalação).
- `COMPLETION_LEDGER_V2_STARTED_AT_MS` — fronteira de reputação: eventos encerrados antes disso não recebem cálculo retroativo.

Compatibilidade com dados antigos é escopo do mesmo fluxo (§16.3).

---

## 11. Notificações e recomendações

- **`notifications`** é escrita **só por Cloud Functions** (regra `create`/`delete: if false`; o cliente só marca `read: true`). Novo tipo de notificação ⇒ criar na Function **e** tratar ícone/rota em `app/(drawer)/notifications.tsx` + `getNotificationRoute`/`getNotificationTarget` em `src/utils/Notifications.ts`.
- **Push** (`functions/src/pushNotifications.ts`): FCM nativo → fallback Expo em lotes; token inválido é limpo de `pushDevices` apenas se ainda corresponder ao token rejeitado. Tickets Expo são conferidos por `checkExpoPushReceipts`; `pushOutbox` guarda envios de evento/recomendação que precisam de nova tentativa. Canais Android: `messages`, `events`, `reminders`, `recommendations` — renomear canal quebra o agrupamento/`collapseKey`.
- **`notificationSettings/{uid}`** tem **allowlist de chaves imposta por `firestore.rules`**. Nova preferência ⇒ tocar em: `firestore.rules` + `src/constants/userPreferences.ts` + `app/(drawer)/profile.tsx` + `preferenceField` nas Functions.
- Desativar um push/lembrete **nunca** apaga a notificação in-app (sino) — ela sempre persiste.
- **Lembretes locais** (`src/utils/Notifications.ts`) são agendados **no aparelho**, sem servidor: não disparam se o app nunca roda. `notifyEventReminders` → lembrete de evento; `notifyRecommendations` → lembrete de reengajamento (7 dias).
- **Recomendação diária** roda às 07:00, 13:00 e 19:00 (SP), percorre usuários/eventos em páginas e cria aviso in-app mesmo sem token push. O cooldown usa 72 h reais consultando notificações existentes; eventos novos publicados depois das 13 h podem entrar na execução das 19 h. A localização aproximada vem do app ao navegar pelas telas principais e é atualizada no máximo a cada 7 dias por célula de 0,01°. Não há aviso em tempo real de evento novo.

---

## 12. Cloud Functions

- Use Function só quando o trabalho exige execução confiável fora do aparelho, credencial privada, autoridade administrativa, processamento agendado ou integridade que o cliente não pode garantir.
- **Toda Function é idempotente:** rodar duas vezes não pode duplicar pontos, notificações nem operações. Use IDs determinísticos e transações. `recoverEventNotifications` usa retry automático e IDs determinísticos; o envio push em `pushOutbox` é de pelo menos uma tentativa e pode reenviar em falhas parciais do provedor.
- Custo: os wrappers `runWith` já existentes são `smallFunction` (128MB, `maxInstances: 5`), `dailyFunction` (`maxInstances: 1`) e `accountFunction` (timeout maior). Reutilize-os em vez de criar outro perfil. Cron enxuto e proporcional a dispositivos ativos, **não** ao histórico de usuários/eventos.
- **`functions/lib/` é versionado.** Não edite `lib/` à mão. Toda mudança em `functions/src/` exige `cd functions && npm run build`. **Você tem acesso ao terminal: execute o comando.** **Nunca** tente gerar ou alterar os arquivos de `lib/` escrevendo código na sua resposta — deixe o compilador fazer isso.
- Testes: `cd functions && npm test` (§0).
- **Admin SDK ignora `firestore.rules`.** Quando o fluxo também passar pelas regras, valide-as à parte.

---

## 13. Segredos e Git

- **Não** faça `commit`, `push`, `pull`, `fetch`, `merge`, `rebase` ou qualquer operação Git/GitHub sem autorização explícita do usuário. Isso vale mesmo quando a tarefa parecer concluída.
- **Config pública de cliente é pública** e pode ficar no repo: `apiKey`/`appId` do Firebase, chave do Google Maps, `google-services.json`. Não trave nem "esconda" esses valores.
- **Segredo real** (nunca vai ao Git, nunca no código): service-account JSON, valores de servidor, chaves FCM server, conteúdo do `.env`.
- `.env` e `google-services.json` **já estão no `.gitignore`** e devem permanecer não rastreados. Se precisar de um valor deles e ele não existir no ambiente, diga — não invente.
- Nunca descarte nem sobrescreva silenciosamente alterações do usuário. Se uma alteração existente bloquear a correção, preserve-a quando possível; caso contrário, explique o conflito e peça autorização.

---

## 14. Logs e observabilidade

- Log só onde ajuda a diagnosticar fluxo importante, falha externa ou transição de estado difícil de reproduzir.
- Mensagens curtas, estruturadas e pesquisáveis — o repo usa `[Área] evento_snake_case` (ex.: `[RootLayout] banned_account_session_ended`) — com contexto técnico útil e **sem** dado pessoal/sensível.
- **Nunca logue** token, coordenada precisa, mensagem privada ou outro dado sensível.
- Nada de log em render, loop frequente, evento de mapa ou listener de alta frequência.
- Log de depuração restrito a `__DEV__`.
- Log não substitui tratamento de erro nem feedback ao usuário.

---

## 15. Ambiente de execução (o que você provavelmente NÃO consegue fazer)

- Shell primário: **PowerShell no Windows**; há também o Bash tool (sintaxe POSIX). São sintaxes diferentes — não misture (`&&` não existe no PowerShell 5.1).
- Você **não deploya** Cloud Functions sem autorização explícita (exige `firebase login`/CLI). Não afirme que uma Function está "no ar".
- Não há emulador rodando por padrão. Teste de `firestore.rules` e teste **entre dois usuários/dispositivos** são manuais — **descreva o roteiro**, não diga que executou.
- Rode o que estiver disponível (§0): `npx tsc --noEmit` (raiz e/ou `functions/`), `cd functions && npm test`.
- `.claude/settings.local.json` já libera `npx tsc *`, `npx expo *`, `npm run *`, `npm test *`, `adb *` e `./gradlew installDebug` sem prompt.

---

## 16. Fluxo de trabalho

### 16.1 Antes de editar

1. Leia **o arquivo-alvo inteiro** (as telas grandes exigem mais de uma chamada de Read — leia por faixas até cobrir o arquivo, não só o trecho citado).
2. Localize imports, consumidores, hooks, services, tipos e rotas ligados diretamente.
3. Consulte `package.json` / `tsconfig.json` / `firestore.rules` / config quando a mudança depender deles.
4. Procure implementações semelhantes no repo (o mesmo padrão costuma existir em 2–3 lugares — ver §9).
5. Descreva **comportamento atual → comportamento desejado**.
6. Apresente um **plano curto**: causa/necessidade · arquivos e a responsabilidade de cada alteração · riscos e efeitos colaterais · como vai validar. Em plan mode, use o mecanismo nativo (ExitPlanMode) em vez de texto solto.
7. Para funcionalidade maior, defina **critérios de aceitação** antes de implementar.

Para mudança **pequena e local** (um arquivo, sem tocar regras/Functions/contrato), os passos 1–2 e um plano de 2–3 linhas bastam. Aplique o fluxo de ponta a ponta (§16.3) quando a alteração cruzar cliente + persistência + regras + Functions.

Se o usuário pedir **apenas** análise/diagnóstico/revisão/plano ⇒ **não edite arquivos** (ver §16.5).

Use TodoWrite quando a tarefa cruzar mais de 3 arquivos ou camadas (cliente + regras + Functions) — o roteiro de §16.3 vira a lista.

### 16.2 Durante

- Preserve o comportamento não relacionado ao pedido.
- Não altere nome público, rota, contrato do banco ou formato persistido sem mapear consumidores e migração.
- Sem código morto, import inutilizado ou bloco grande comentado "para o futuro". Ao remover código obsoleto que possa ter uso externo/indireto, explique o impacto antes.
- Não adicione dependência sem justificar necessidade, manutenção, tamanho e compatibilidade com Expo (versões do SDK 54 são fixadas — confira `package.json` antes de sugerir pacote novo).
- Antes de corrigir um bug, identifique componentes/hooks/services/tipos/rotas/fluxos que tocam a parte alterada e verifique se a mudança quebra algo já funcional **fora** do arquivo editado.

### 16.3 Fluxo de ponta a ponta

Ao alterar uma funcionalidade, percorra o que se aplicar: (1) ação e feedback na UI · (2) validação no cliente · (3) service/caso de uso · (4) persistência e formato dos dados · (5) `firestore.rules` · (6) Cloud Function / operação admin · (7) notificações e deep linking · (8) telas consumidoras · (9) moderação, bloqueio e privacidade · (10) compatibilidade com dados antigos (§10) · (11) limpeza/retenção · (12) teste entre dois usuários/dispositivos.

Quando o usuário apontar um defeito: ache a **causa**, não o sintoma; procure o mesmo padrão no repo e classifique cada ocorrência (mesmo defeito confirmado · padrão semelhante a analisar · falso positivo). Corrigir o fluxo inteiro de ponta a ponta é **escopo esperado**. **Não** faça substituição global cega (`replace_all` só com unicidade verificada).

### 16.4 Depois — validação e entrega

Execute o que estiver disponível: TypeScript (§0/§5) · testes de `functions/` quando aplicável · `npm run build` em `functions/` se tocou `functions/src/` · conferência de imports/rotas/contratos afetados · revisão de cleanup de effects/listeners · impacto em leituras/escritas do Firestore.

Confirme antes da resposta final:

1. Entendi o ciclo de vida do componente e as dependências dos hooks?
2. A consulta tem escopo, `limit`, paginação e frequência adequados?
3. Há risco de listener órfão, timer ativo, update após desmontagem ou outro vazamento?
4. A mudança pode causar re-render em cascata, inclusive em aba oculta?
5. Mapa, localização e navegação `Drawer > Tabs > Full Screen` continuam coerentes?
6. Os tipos representam os dados reais, sem `any` nem assertion artificial?
7. A solução resolve a causa sem ampliar indevidamente o escopo?
8. Há código morto, duplicação relevante ou contrato obsoleto relacionado?
9. Os logs são úteis, seguros e pouco ruidosos?
10. As afirmações da resposta final são sustentadas pelas verificações executadas?

Relate, de forma objetiva: arquivos alterados · comportamento corrigido/implementado · verificações executadas **e o resultado** · riscos, limitações e erros preexistentes ainda presentes · testes manuais recomendados (incluindo roteiro entre 2 contas quando aplicável).

**Nunca** diga "funcionando", "sem erros" ou "otimizado" sem evidência compatível. Uma correção localizada não é segura só porque o arquivo alterado compila isoladamente.

### 16.5 Escopo e autorização

- Se o usuário pedir **apenas** análise/diagnóstico/revisão/plano ⇒ **não edite arquivos**.
- Com autorização explícita para implementar ⇒ apresente o plano e prossiga **sem** pedir segunda confirmação, **exceto** em: decisão arquitetural relevante, operação destrutiva, ou ampliação material de escopo para outra funcionalidade — aí pare e pergunte.
- Ampliar para corrigir o **mesmo fluxo** de ponta a ponta (produtores, banco, regras, Functions, consumidores, notificações, moderação, estados visuais) **não** é ampliação de escopo — é o escopo. Peça autorização só quando mudar regra de negócio, for destrutivo, ou pular para funcionalidade diferente.

---

## 17. Autonomia operacional

**Apesar desta autonomia, as restrições do §13 (Git/Segredos) são absolutas e têm precedência sobre qualquer iniciativa.**

Não interrompa nem substitua um fluxo funcional só para exigir que o usuário forneça manualmente senha, chave, token ou config que já está disponível de forma segura no projeto, ambiente ou ferramentas autorizadas.

**Dentro de uma implementação já autorizada**, use e atualize por conta própria as configs, referências, permissões, `firestore.rules`, Functions e arquivos relacionados necessários para concluir o mesmo fluxo. Não delegue ao usuário tarefa técnica que você executa com segurança.

Peça intervenção só se a credencial estiver de fato ausente, exigir login/ação manual do usuário, envolver criação de novo segredo, custo externo relevante ou risco de expor dado sensível. Nunca grave segredo no código nem o envie ao Git.
