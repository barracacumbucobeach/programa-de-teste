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

/** Converte o grafo visual (nós + conexões) no formato usado pelo motor de execução. */
function compileGraph(graph) {
  const compiled = {};

  for (const node of graph.nodes) {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    const kind = VALID_KINDS.has(node.data?.kind) ? node.data.kind : 'text';
    // Botões só existem de fato para balões (texto/imagem/vídeo/áudio) — se um
    // nó já teve botões e depois foi convertido para Pergunta/Atendente pelo
    // seletor de tipo, esses botões "sobrando" nos dados não devem mais virar
    // lista numerada nem disputar gatilho com o mecanismo de variável/pausa.
    const options = MESSAGE_KINDS.has(kind) && Array.isArray(node.data?.options) ? node.data.options : [];
    const opcoes = {};
    let mensagem = (node.data?.mensagem || '').trim();

    // Botões nomeados (cada um com seu próprio conector, ligado à mão pelo
    // usuário): viram uma lista numerada anexada ao final da mensagem, e o
    // gatilho de cada um é a própria posição na lista (1, 2, 3…).
    // Guardada à parte (além de já embutida em "mensagem") porque o motor
    // precisa remontar só a lista de opções — sem o texto de saudação —
    // quando troca a saudação por uma "mensagem de retorno" pra quem já
    // falou com o bot antes.
    let opcoesTexto = '';

    if (options.length > 0) {
      const optionLines = [];
      options.forEach((option, index) => {
        const edge = outgoing.find((e) => e.sourceHandle === option.id);
        if (!edge) return; // botão criado mas ainda sem conexão: ignorado até ser ligado
        const trigger = String(index + 1);
        opcoes[trigger] = edge.target;
        optionLines.push(`${trigger} - ${(option.label || '').trim() || 'Opção'}`);
      });
      if (optionLines.length > 0) {
        opcoesTexto = optionLines.join('\n');
        mensagem = mensagem ? `${mensagem}\n\n${opcoesTexto}` : opcoesTexto;
      }
    }

    // Conexões "soltas" (feitas pela borda inferior comum, sem passar por um
    // botão nomeado) continuam com gatilho de texto livre — inclui o
    // curinga "*", que casa quando nenhuma opção numerada bate. Um botão
    // nomeado sempre tem prioridade sobre uma ligação solta que por acaso
    // caia no mesmo número (ex.: um "1" solto feito sem querer não pode
    // roubar o gatilho do botão "1 - Catálogo").
    outgoing
      .filter((edge) => !edge.sourceHandle || !options.some((option) => option.id === edge.sourceHandle))
      .forEach((edge) => {
        const gatilho = String(edge.data?.trigger ?? edge.label ?? '*').trim();
        if (gatilho && !(gatilho in opcoes)) opcoes[gatilho] = edge.target;
      });

    compiled[node.id] = {
      kind,
      title: (node.data?.title || '').trim(),
      mensagem,
      mediaUrl: (node.data?.mediaUrl || '').trim(),
      opcoes,
    };
    if (opcoesTexto) compiled[node.id].opcoesTexto = opcoesTexto;

    if (INPUT_KINDS.has(kind)) {
      compiled[node.id].variable = (node.data?.variable || '').trim() || 'resposta';
      // Nó de pergunta: segue sempre para a primeira (única) conexão de saída,
      // independentemente do texto que o cliente responder.
      compiled[node.id].next = outgoing[0]?.target || null;
      // Mensagem alternativa para quando o cliente que responde essa pergunta
      // já é conhecido (voltou a falar depois de um tempo): pula a pergunta
      // (a resposta já está salva) e usa esse texto no lugar dela.
      const mensagemRetorno = (node.data?.mensagemRetorno || '').trim();
      if (mensagemRetorno) compiled[node.id].mensagemRetorno = mensagemRetorno;
    }
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

module.exports = {
  DATA_DIR,
  AUTH_DIR,
  BUILDER_FILE,
  FLOW_FILE,
  STATE_FILE,
  CONVERSATIONS_FILE,
  CUSTOMERS_FILE,
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
};
