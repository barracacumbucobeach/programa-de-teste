'use strict';

const fs = require('fs');
const path = require('path');

// Em desenvolvimento os dados ficam em <projeto>/data. Quando empacotado em
// Electron, main.js define AUTOFLOW_DATA_DIR apontando para uma pasta
// gravável do usuário (app.getPath('userData')), já que o app instalado
// costuma ficar num diretório somente leitura.
const DATA_DIR = process.env.AUTOFLOW_DATA_DIR
  ? path.resolve(process.env.AUTOFLOW_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const AUTH_DIR = path.join(DATA_DIR, 'auth_session');
const BUILDER_FILE = path.join(DATA_DIR, 'fluxo_builder.json');
const FLOW_FILE = path.join(DATA_DIR, 'fluxo_bot.json');
const STATE_FILE = path.join(DATA_DIR, 'estado_clientes.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversas.jsonl');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'clientes.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

/** Fluxo mínimo usado apenas se a pasta data/ estiver vazia. */
const DEFAULT_BUILDER = {
  nodes: [
    {
      id: 'start',
      type: 'message',
      position: { x: 360, y: 60 },
      data: {
        kind: 'text',
        title: 'Início',
        mensagem: 'Olá! 👋 Como posso te ajudar?\n\n1 - Falar com um atendente',
      },
    },
    {
      id: 'no_atendente',
      type: 'message',
      position: { x: 360, y: 320 },
      data: {
        kind: 'text',
        title: 'Atendente',
        mensagem: 'Perfeito! Já vou te encaminhar para um de nossos atendentes.',
      },
    },
  ],
  edges: [
    {
      id: 'e-start-atendente',
      source: 'start',
      target: 'no_atendente',
      type: 'labeled',
      data: { trigger: '1' },
    },
  ],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️  Falha ao ler ${file}:`, err.message);
    return fallback;
  }
}

function writeJSONAtomic(file, data) {
  ensureDataDir();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function loadBuilder() {
  return readJSON(BUILDER_FILE, null) || DEFAULT_BUILDER;
}

function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Estrutura de fluxo inválida.');
  }
  if (!graph.nodes.some((n) => n.id === 'start')) {
    throw new Error('O fluxo precisa de um nó inicial chamado "start".');
  }
}

const MESSAGE_KINDS = new Set(['text', 'image', 'video', 'audio']);
const INPUT_KINDS = new Set(['input_text', 'input_number', 'input_email', 'input_phone']);
const HANDOFF_KIND = 'handoff';
const VALID_KINDS = new Set([...MESSAGE_KINDS, ...INPUT_KINDS, HANDOFF_KIND]);

/**
 * Cada nó do quadro é um "grupo" (estilo Typebot): uma pilha de balões
 * empilhados dentro do mesmo cartão (`data.steps`), com uma única entrada
 * (sempre pelo primeiro balão da pilha) e saídas apontando pra outro grupo
 * só a partir do ÚLTIMO balão (continuação natural) ou de um botão nomeado
 * em QUALQUER balão da pilha (não precisa ser o último).
 *
 * Fluxos salvos antes dessa mudança guardavam um balão só, direto em
 * `data` (sem `data.steps`) — normalizeGroupNode() envolve esse formato
 * antigo numa pilha de um balão só, reaproveitando o próprio id do nó como
 * id do balão. Isso é o que garante que o balão inicial de um fluxo antigo
 * continue compilando pra chave 'start' (ver compileGraph) sem precisar
 * reescrever nenhuma ligação já salva.
 */
function normalizeGroupNode(node) {
  if (Array.isArray(node.data?.steps)) return node;
  const { title, kind, mensagem, mediaUrl, variable, mensagemRetorno, options, ...rest } = node.data || {};
  return {
    ...node,
    data: {
      title,
      steps: [
        {
          id: node.id,
          kind: kind || 'text',
          mensagem: mensagem || '',
          mediaUrl: mediaUrl || '',
          variable,
          mensagemRetorno,
          options: Array.isArray(options) ? options : [],
          ...rest,
        },
      ],
    },
  };
}

/** Converte o grafo visual (grupos com balões empilhados) no formato usado
 *  pelo motor de execução — que continua enxergando um balão por vez,
 *  igual sempre enxergou; a "pilha" existe só pro editor visual. */
function compileGraph(graph) {
  const compiled = {};

  for (const rawNode of graph.nodes) {
    const node = normalizeGroupNode(rawNode);
    const steps = node.data.steps;
    const outgoingFromGroup = graph.edges.filter((edge) => edge.source === node.id);
    // Toda ligação que sai do grupo carrega o id do GRUPO como "source",
    // não o do balão específico — então, pra saber se uma ligação é
    // realmente "solta" (sem botão) precisamos conhecer os ids de botão de
    // TODOS os balões da pilha, não só do balão sendo processado agora
    // (senão uma ligação de botão de um balão vizinho passava por "solta"
    // na hora de compilar outro balão sem botões).
    const allOptionIds = new Set(
      steps.flatMap((s) => (MESSAGE_KINDS.has(s.kind) && Array.isArray(s.options) ? s.options.map((o) => o.id) : []))
    );
    const isFreeEdge = (edge) => !edge.sourceHandle || !allOptionIds.has(edge.sourceHandle);

    steps.forEach((step, index) => {
      const isFirstStep = index === 0;
      const isLastStep = index === steps.length - 1;
      // O primeiro balão do grupo herda o próprio id do grupo (é assim que
      // uma ligação apontando pro grupo — sempre feita pela entrada dele —
      // já cai direto na chave certa, sem precisar de nenhuma tradução; e é
      // assim também que o grupo 'start' vira exatamente a chave 'start').
      const stepKey = isFirstStep ? node.id : `${node.id}__${step.id}`;

      const kind = VALID_KINDS.has(step.kind) ? step.kind : 'text';
      // Botões só existem de fato para balões (texto/imagem/vídeo/áudio) — se
      // um balão já teve botões e depois foi convertido para Pergunta/Atendente
      // pelo seletor de tipo, esses botões "sobrando" não devem mais virar
      // lista numerada nem disputar gatilho com o mecanismo de variável/pausa.
      const options = MESSAGE_KINDS.has(kind) && Array.isArray(step.options) ? step.options : [];
      const opcoes = {};
      let mensagem = (step.mensagem || '').trim();

      // Botões nomeados (cada um com seu próprio conector, ligado à mão pelo
      // usuário, podendo estar em QUALQUER balão da pilha): viram uma lista
      // numerada anexada ao final da mensagem, e o gatilho de cada um é a
      // própria posição na lista (1, 2, 3…) — o destino de um botão é sempre
      // outro grupo, e entra direto no primeiro balão dele.
      let opcoesTexto = '';
      if (options.length > 0) {
        const optionLines = [];
        options.forEach((option, optIndex) => {
          const edge = outgoingFromGroup.find((e) => e.sourceHandle === option.id);
          if (!edge) return; // botão criado mas ainda sem conexão: ignorado até ser ligado
          const trigger = String(optIndex + 1);
          opcoes[trigger] = edge.target;
          // Também aceita o cliente digitar o próprio nome do botão (ex.:
          // "Voltar"), não só o número — é comum a mensagem pedir isso
          // explicitamente, e um botão nomeado "Voltar" deve funcionar
          // mesmo assim, sem virar o gatilho global de reset.
          const label = (option.label || '').trim();
          if (label && !(label in opcoes)) opcoes[label] = edge.target;
          optionLines.push(`${trigger} - ${label || 'Opção'}`);
        });
        if (optionLines.length > 0) {
          opcoesTexto = optionLines.join('\n');
          mensagem = mensagem ? `${mensagem}\n\n${opcoesTexto}` : opcoesTexto;
        }
      }

      // Continuação natural: um balão SEM botões próprios, que não é o
      // último da pilha, segue sozinho pro próximo balão do MESMO grupo —
      // é assim que a pilha inteira "roda" como uma sequência só. Um balão
      // COM botões nunca ganha essa continuação automática (o próprio botão
      // já é a saída dele, como no Typebot: uma vez que vira uma escolha,
      // não existe mais "próximo balão" implícito). Só o balão que realmente
      // sai do grupo (o último da pilha, ou qualquer um com uma ligação
      // solta desenhada até outro grupo) usa a ligação que o usuário
      // desenhou no quadro — sem número/asterisco pra configurar, o próprio
      // desenho já é a regra; um botão nomeado sempre tem prioridade sobre
      // uma ligação solta que por acaso caia no mesmo gatilho.
      const internalNextKey = !isLastStep && options.length === 0 ? `${node.id}__${steps[index + 1].id}` : null;
      if (internalNextKey) {
        if (!('*' in opcoes)) opcoes['*'] = internalNextKey;
      } else {
        const freeEdge = outgoingFromGroup.find(isFreeEdge);
        if (freeEdge && !('*' in opcoes)) opcoes['*'] = freeEdge.target;
      }

      compiled[stepKey] = {
        kind,
        title: (isFirstStep ? node.data.title : '') || '',
        mensagem,
        mediaUrl: (step.mediaUrl || '').trim(),
        opcoes,
      };
      if (opcoesTexto) compiled[stepKey].opcoesTexto = opcoesTexto;

      if (INPUT_KINDS.has(kind)) {
        compiled[stepKey].variable = (step.variable || '').trim() || 'resposta';
        // Nó de pergunta: segue sempre para o próximo passo (dentro do grupo
        // ou pela ligação externa, se for o último balão), independentemente
        // do texto que o cliente responder.
        compiled[stepKey].next = internalNextKey || outgoingFromGroup.find(isFreeEdge)?.target || null;
        // Mensagem alternativa para quando o cliente que responde essa
        // pergunta já é conhecido (voltou a falar depois de um tempo): pula
        // a pergunta (a resposta já está salva) e usa esse texto no lugar.
        const mensagemRetorno = (step.mensagemRetorno || '').trim();
        if (mensagemRetorno) compiled[stepKey].mensagemRetorno = mensagemRetorno;
      }
    });
  }

  return compiled;
}

function saveBuilder(graph) {
  validateGraph(graph);
  writeJSONAtomic(BUILDER_FILE, graph);
  const compiled = compileGraph(graph);
  writeJSONAtomic(FLOW_FILE, compiled);
  return compiled;
}

function loadFlow() {
  return readJSON(FLOW_FILE, null) || compileGraph(loadBuilder());
}

function loadClientState() {
  return readJSON(STATE_FILE, {});
}

let saveStateTimer = null;
function saveClientStateDebounced(state) {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => writeJSONAtomic(STATE_FILE, state), 800);
}

function loadCustomersRaw() {
  return readJSON(CUSTOMERS_FILE, {});
}

let saveCustomersTimer = null;
function saveCustomersDebounced(customers) {
  clearTimeout(saveCustomersTimer);
  saveCustomersTimer = setTimeout(() => writeJSONAtomic(CUSTOMERS_FILE, customers), 500);
}

/** Configurações gerais do app (hoje só o modo restrito de atendimento). */
function loadConfig() {
  return readJSON(CONFIG_FILE, {});
}

function saveConfig(config) {
  writeJSONAtomic(CONFIG_FILE, config);
  return config;
}

module.exports = {
  DATA_DIR,
  AUTH_DIR,
  BUILDER_FILE,
  FLOW_FILE,
  STATE_FILE,
  CONVERSATIONS_FILE,
  CUSTOMERS_FILE,
  CONFIG_FILE,
  MESSAGE_KINDS,
  INPUT_KINDS,
  HANDOFF_KIND,
  ensureDataDir,
  loadBuilder,
  saveBuilder,
  compileGraph,
  loadFlow,
  loadClientState,
  saveClientStateDebounced,
  loadCustomersRaw,
  saveCustomersDebounced,
  loadConfig,
  saveConfig,
};
