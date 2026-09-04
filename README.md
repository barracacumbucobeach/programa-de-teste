# ⚡ AutoFlow Desktop

Construtor visual de fluxos e motor de automação para WhatsApp que roda **100% local**
no seu computador — sem custos de API externa, sem servidores em nuvem e sem mensalidade.

Desenhe o fluxo de atendimento arrastando nós no builder visual, clique em
**Salvar e Ativar Fluxo** e o motor local passa a responder seus clientes no WhatsApp
automaticamente, com um módulo humanizador que evita padrões de robô (delays
aleatórios e simulação de "digitando…").

## 🧱 Arquitetura

O projeto é dividido em duas camadas locais que conversam entre si por uma API
HTTP + WebSocket local (porta `4477`), embaladas por um wrapper Electron que
vira um único executável de desktop:

```
┌───────────────────────────────────────────────────────────────────────┐
│                    ELECTRON — janela desktop (main.js)                 │
│  ┌─────────────────────────────┐   HTTP/WS   ┌───────────────────────┐ │
│  │  FRONTEND — Builder Visual  │ ◄──────────► │ BACKEND — Motor local │ │
│  │  React + @xyflow/react      │ :4477/api    │ Node.js + Baileys     │ │
│  │  (dist/ carregado via       │ :4477/ws     │ (roda dentro do       │ │
│  │   file:// dentro da janela) │              │  processo principal)  │ │
│  └─────────────────────────────┘              └───────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
                                     <dados do usuário>/data/fluxo_bot.json
                                     (fluxo compilado, lido pelo motor a
                                      cada save — veja "Onde ficam os dados")
```

- **`src/frontend`** — interface no-code (estilo Typebot/ManyChat) construída com
  React e `@xyflow/react`. Você arrasta nós de mensagem, cria opções numeradas e
  conecta os nós por linhas. Ao salvar, o grafo visual (`data/fluxo_builder.json`)
  é compilado para o formato de execução (`data/fluxo_bot.json`).
- **`src/backend`** — serviço Node.js que carrega `fluxo_bot.json`, conecta ao
  WhatsApp via [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys),
  expõe o QR Code (na tela do builder e também no terminal) e executa o fluxo
  para cada cliente, com o módulo humanizador anti-banimento.
- **`electron/`** — janela desktop (Electron). Em produção, `main.js` inicia o
  motor local dentro do próprio processo do app e carrega o builder já
  compilado (`dist/index.html`); é o que vira o executável final (`.AppImage`,
  `.deb`, `.exe`, `.dmg`).

## 📂 Estrutura de pastas

```
electron/
  main.js                  # janela + inicialização do motor no app empacotado
  preload.js                 # preload (intencionalmente vazio, ver comentário no arquivo)
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
  fluxo_builder.json   # grafo visual de exemplo (nós, posições, conexões)
  fluxo_bot.json         # fluxo de exemplo já compilado
build/
  icon.png                # ícone mestre do app (1024×1024), gerado por scripts/generate-icon.js
scripts/
  generate-icon.js           # gera build/icon.png sem depender de libs externas de imagem
```

> Em desenvolvimento, os arquivos gerados/sensíveis (`auth_session/`,
> `estado_clientes.json`) ficam dentro de `data/`. No executável empacotado
> eles ficam fora da pasta de instalação — veja **Onde ficam os dados**.

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

## 🖥️ Rodando como app desktop (Electron)

Além do modo navegador (`npm run dev`), o projeto também roda como uma janela
de aplicativo nativa, com o motor embutido no próprio processo do app —
sem precisar de dois terminais nem do navegador.

```bash
# desenvolvimento: motor + builder (Vite) + janela Electron juntos, com hot-reload
npm run electron:dev

# "modo produção" local, sem gerar instalador: builda o frontend e abre a
# janela já carregando o build final (é exatamente o que roda dentro do
# executável empacotado)
npm run electron:preview
```

## 📦 Gerar o executável (instalador)

O empacotamento usa [`electron-builder`](https://www.electron.build/). Para
gerar o instalador da sua própria plataforma:

```bash
npm run dist            # detecta a plataforma atual automaticamente
npm run dist:linux      # AppImage + .deb
npm run dist:win        # instalador NSIS (.exe)
npm run dist:mac        # .dmg (Intel e Apple Silicon)
```

Os arquivos finais saem em `release/` (pasta ignorada pelo git — são
artefatos de build, não código-fonte):

- **Linux:** `release/AutoFlow Desktop-<versão>.AppImage` (portátil, basta dar
  permissão de execução: `chmod +x`) e `release/autoflow-desktop_<versão>_amd64.deb`.
- **Windows:** `release/AutoFlow Desktop Setup <versão>.exe`.
- **macOS:** `release/AutoFlow Desktop-<versão>.dmg`.

> Gerar o instalador de Windows/macOS a partir de outro sistema operacional
> pode exigir ferramentas adicionais (ex.: Wine para NSIS fora do Windows).
> O caminho mais confiável é rodar `npm run dist:win`/`dist:mac` na própria
> plataforma alvo, ou numa esteira de CI (ex.: GitHub Actions com runners
> `windows-latest`/`macos-latest`).

O ícone do app (`build/icon.png`, 1024×1024) já está no repositório; para
regenerá-lo (ou trocá-lo por um novo desenho) rode `npm run icon` — o
`electron-builder` deriva sozinho o `.ico` (Windows) e o `.icns` (macOS) a
partir desse único PNG.

### Onde ficam os dados no executável instalado

A pasta de instalação de um app empacotado costuma ser somente leitura, então
o executável **nunca** grava nada nela. Na primeira execução, `electron/main.js`
copia o fluxo de exemplo (`data/fluxo_builder.json` e `fluxo_bot.json`, que
vêm dentro do app) para a pasta de dados do usuário do sistema operacional —
sem nunca sobrescrever um fluxo que você já tenha salvo:

| Sistema | Pasta de dados |
|---|---|
| Linux | `~/.config/AutoFlow Desktop/data/` |
| Windows | `%APPDATA%\AutoFlow Desktop\data\` |
| macOS | `~/Library/Application Support/AutoFlow Desktop/data/` |

É lá que ficam o fluxo salvo, a sessão do WhatsApp (`auth_session/`) e o
estado de conversa de cada cliente — exatamente como em desenvolvimento,
só que fora da pasta somente-leitura do app instalado.

## ⚙️ Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `4477` | Porta da API/WebSocket do motor |
| `VITE_API_BASE` | `http://localhost:4477` | URL do motor usada pelo builder (frontend) |
| `AUTOFLOW_DATA_DIR` | `<projeto>/data` | Pasta onde o motor lê/grava o fluxo, a sessão e o estado dos clientes. Definida automaticamente pelo Electron em produção (ver tabela acima); útil também para rodar múltiplas instâncias/sessões isoladas em dev. |

## 📦 Build de produção só do builder (sem Electron)

Útil se você quiser servir o builder visual separadamente (ex.: hospedado),
mantendo o motor rodando à parte:

```bash
npm run build:frontend
npm run preview:frontend
```

## ⚠️ Aviso

Este projeto se conecta ao WhatsApp através de uma biblioteca não oficial
(Baileys), simulando um cliente WhatsApp Web. Use por sua conta e risco,
respeitando os Termos de Serviço do WhatsApp — o módulo humanizador reduz,
mas não elimina, o risco de bloqueio da conta.
