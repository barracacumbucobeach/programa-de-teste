# ⚡ AutoFlow Desktop

Construtor visual de fluxos e motor de automação para WhatsApp que roda **100% local**
no seu computador — sem custos de API externa, sem servidores em nuvem e sem mensalidade.

Desenhe o fluxo de atendimento arrastando nós no builder visual, clique em
**Salvar e Ativar Fluxo** e o motor local passa a responder seus clientes no WhatsApp
automaticamente, com um módulo humanizador que evita padrões de robô (delays
aleatórios e simulação de "digitando…").

## 🧱 Arquitetura

O projeto é dividido em duas camadas locais que conversam entre si por uma API
HTTP + WebSocket local (porta `4477`):

```
┌─────────────────────────────┐        HTTP/WS         ┌───────────────────────────────┐
│  FRONTEND — Builder Visual  │  ◄────────────────────► │  BACKEND — Motor de Execução   │
│  React + @xyflow/react      │   localhost:4477/api    │  Node.js + Baileys             │
│  (rodando em :5173 no dev)  │   localhost:4477/ws     │                                 │
└─────────────────────────────┘                         └───────────────────────────────┘
                                                                     │
                                                                     ▼
                                                          data/fluxo_bot.json
                                                          (fluxo compilado, lido
                                                           pelo motor a cada save)
```

- **`src/frontend`** — interface no-code (estilo Typebot/ManyChat) construída com
  React e `@xyflow/react`. Você arrasta nós de mensagem, cria opções numeradas e
  conecta os nós por linhas. Ao salvar, o grafo visual (`data/fluxo_builder.json`)
  é compilado para o formato de execução (`data/fluxo_bot.json`).
- **`src/backend`** — serviço Node.js que carrega `fluxo_bot.json`, conecta ao
  WhatsApp via [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys),
  expõe o QR Code (na tela do builder e também no terminal) e executa o fluxo
  para cada cliente, com o módulo humanizador anti-banimento.

## 📂 Estrutura de pastas

```
src/
  backend/
    engine.js       # ponto de entrada do motor (API + conexão WhatsApp)
    server.js       # API HTTP + WebSocket local
    whatsapp.js      # conexão Baileys, QR Code, roteamento de mensagens
    flowEngine.js     # máquina de estados da conversa por cliente
    humanizer.js       # delays aleatórios + simulação de digitação
    store.js            # leitura/escrita atômica dos arquivos em data/
    logger.js             # logger colorido compatível com Baileys
  frontend/
    index.html
    vite.config.js
    src/
      App.jsx              # layout principal do builder
      api.js                 # cliente HTTP/WebSocket para o motor local
      styles.css               # tema visual (dark, estilo profissional)
      components/                # Sidebar, TopBar, NodePanel, QRModal, Toasts
      components/nodes/            # nó de mensagem customizado
      components/edges/              # conexão com rótulo editável (gatilho)
data/
  fluxo_builder.json   # grafo visual (nós, posições, conexões) — editado pelo builder
  fluxo_bot.json         # fluxo compilado, lido pelo motor de execução
  auth_session/             # credenciais da sessão do WhatsApp (gerado, git-ignored)
  estado_clientes.json         # em qual etapa cada cliente está (gerado, git-ignored)
```

## 🚀 Como usar

### 1. Instalar dependências

```bash
npm install
```

### 2. Rodar o motor + o builder juntos

```bash
npm run dev
```

Isso inicia:

- o **motor** (`src/backend/engine.js`) em `http://localhost:4477`;
- o **builder visual** (Vite) em `http://localhost:5173`.

Abra `http://localhost:5173` no navegador.

> Prefere rodar cada parte separadamente? Use `npm run start:engine` e
> `npm run dev:frontend` em dois terminais.

### 3. Conectar o WhatsApp

Clique no indicador de status (canto superior direito ou barra lateral) para abrir
o QR Code — ele também aparece no terminal onde o motor está rodando. Escaneie com
**WhatsApp → Mais opções → Aparelhos conectados → Conectar um aparelho**.

### 4. Editar o fluxo

- Arraste a partir da borda inferior de um nó até outro nó para criar uma conexão.
- Clique em **"+ Nova opção"** dentro de um nó para criar automaticamente um novo
  nó já conectado.
- Clique em um nó para abrir o painel lateral e editar o **título** e a
  **mensagem** que o bot enviará.
- Edite o número/palavra de cada conexão diretamente no rótulo sobre a linha —
  é exatamente o que o cliente precisa digitar no WhatsApp para seguir aquele
  caminho.
- Clique em **💾 Salvar e Ativar Fluxo** para compilar e ativar imediatamente
  (o motor recarrega o fluxo sem precisar reiniciar).

Digitar **`menu`**, **`0`** ou **`voltar`** a qualquer momento faz o cliente
retornar à mensagem inicial.

## 🛡️ Módulo humanizador anti-banimento

Antes de responder qualquer mensagem, o motor **sempre**:

1. Sorteia um tempo de espera aleatório entre 3 e 7 segundos;
2. Ativa o estado **"digitando…"** na conversa;
3. Mantém esse estado por um tempo proporcional ao tamanho do texto
   (mínimo de 2s, máximo de 6s);
4. Remove o estado de digitação e só então envia a mensagem.

Essa lógica está isolada em `src/backend/humanizer.js` e é usada por
`src/backend/whatsapp.js` em toda resposta automática.

## ⚙️ Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `4477` | Porta da API/WebSocket do motor |
| `VITE_API_BASE` | `http://localhost:4477` | URL do motor usada pelo builder (frontend) |

## 📦 Build de produção do builder

```bash
npm run build:frontend
npm run preview:frontend
```

## ⚠️ Aviso

Este projeto se conecta ao WhatsApp através de uma biblioteca não oficial
(Baileys), simulando um cliente WhatsApp Web. Use por sua conta e risco,
respeitando os Termos de Serviço do WhatsApp — o módulo humanizador reduz,
mas não elimina, o risco de bloqueio da conta.
