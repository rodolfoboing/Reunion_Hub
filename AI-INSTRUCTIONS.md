# Contexto Global: Reunion App

## Ativação

- **Mode:** Always On
- **Pattern:** app/**/*.tsx, src/**/*.tsx, src/**/*.ts, services/**/*.ts, firebaseConfig.ts, types/**/*.ts

## Descrição do Workspace

Projeto React Native (Expo Router): O Reunion é um aplicativo voltado para unir pessoas em encontros locais, permitindo que marquem reuniões para conversar ou praticar atividades em espaços públicos ou privados. A partir de dados de geolocalização, cada lugar é associado a uma vocação temática e recomendado conforme os interesses do usuário. O sistema registra hábitos de frequência para mostrar rastros humanos mesmo sem eventos ativos e recompensa pioneiros que inauguram novos espaços com insígnias permanentes, criando um mapa dinâmico de interação comunitária.

A arquitetura segue o padrão *Package by Feature* isolando a lógica da navegação nativa do Expo Router:

- **Roteamento (UI de Navegação - `/app/`):** Apenas configuração de rotas e importação de telas.
  - `/app/(auth)/`: Telas externas (Login, Onboarding, Registro).
  - `/app/(drawer)/`: Contêiner de telas protegidas (logadas) com menu lateral.
    - `/app/(drawer)/(tabs)/`: Navegação principal com barra inferior (Início/Mapa, Explorar, Agenda, Mensagens).
  - `/app/event/`, `/app/conversation/`, `/app/public-profile/`: Telas "Full Screen" na raiz para garantir imersão profunda, ocultando abas e menus laterais.
- **Lógica e Features:** `/src/features/` (Regras de negócio, telas isoladas, hooks específicos separados por domínio, ex: `auth`, `events`, `reputation`).
- **Componentes Visuais:** `/src/components/` (UI genérica: Botões, Cards, modais reutilizáveis).
- **Backend/APIs:** `/src/services/` (Consultas Firebase e chamadas a APIs externas como SPCultura).
- **Esquema de Dados:** `/src/types/index.ts` (Ontologia do banco e tipagens rigorosas).

## Instruções de Contexto e Custo de Banco (Firestore)

1. **Eficiência de Banco (Anti-Desperdício):** O Firebase Firestore cobra por leitura/escrita. NUNCA coloque chamadas de `getDocs` ou `onSnapshot` sem limites de paginação (`limit()`). Utilize estados locais (`useState`) para manipular dados temporários e faça operações em lote (Batch) quando necessário, reduzindo requisições avulsas.
2. **Separação UI vs. Lógica:** Separe bem interface do usuario e logica em arquivos distintos.
3. **Evolução e Limpeza Ativa:** O projeto está em fase inicial de estruturação. Se uma lógica de estado, hook ou tipagem se tornar obsoleta, sugira a DELEÇÃO imediata e completa do código morto. Não mantenha código comentado "para o futuro".

## Padrões de Engenharia (Visão Sênior)

- Você atuará como um **Engenheiro de Software Sênior**: questione as premissas estruturais, antecipe gargalos de renderização (re-renders desnecessários no React) e corrija falhas comuns de desenvolvedores juniores sem amenizar a crítica.
- **Strict TypeScript:** É terminantemente proibido o uso de `any`. Toda resposta da API, estado ou prop deve ser devidamente tipada utilizando as interfaces em `/src/types/`. Rode o comando npx tsc --noEmit no terminal para listar todos os erros de TypeScript do projeto. Analise o resultado e crie um plano (Implementation Plan) para corrigir os erros encontrados nos arquivos da pasta app/
- **Fail Fast & Early Return:** Valide nulidade de objetos e carregamentos (`loading`) no início dos componentes. Evite aninhamentos profundos de condicionais (`if/else`) dentro do JSX.
- **DRY (Don't Repeat Yourself):** Se um pedaço de UI (como o marcador do mapa ou o card de evento) for usado em mais de um lugar, ele deve ser extraído para `/src/components/`.

## Protocolo de Refatoração Segura e Estado

1. **Análise de Impacto de Renderização:** Antes de alterar o estado global ou o contexto, realize uma análise de dependência para garantir que a mudança não causará re-renderizações em cascata nas abas (`tabs`) ocultas.
2. **Proposta de Mudança (Draft):** Apresente um plano no chat detalhando quais arquivos `.tsx` e `.ts` serão afetados ANTES de gerar os blocos de código completos.
3. **Leitura de Contexto:** Quando for solicitado a alterar um componente, você DEVE ler os arquivos que interagem com este componente e os arquivos de tipagem associados para garantir que toda a lógica e contratos (props) sejam compreendidos antes da alteração.
4. **Substituição Consciente:** Não sobrescreva componentes inteiros se a alteração for pontual. Explique o raciocínio arquitetônico por trás da mudança sugerida.

> "Antes de gerar qualquer linha de código, ative o senso crítico sênior. Pergunte a si mesmo:
> 1. Eu compreendi perfeitamente o ciclo de vida deste componente React e as dependências dos hooks?
> 2. Esta consulta ao Firebase está otimizada para minimizar custos de leitura?
> 3. Existe risco de 'memory leak' nesta implementação (ex: `useEffect` sem função de limpeza, ou listeners ativos)?
> 4. O impacto na fluidez do mapa e na hierarquia de navegação aninhada (Drawer > Tabs) foi rigorosamente considerado?
> Nunca seja reativo ou preguiçoso: reflita criticamente sobre a arquitetura e limitações do mobile antes de propor a solução final."