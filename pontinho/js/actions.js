import { state } from "./state.js";
import { currentPlayer } from "./state.js";
import { isSequenciaComCoringaValida, valorIndex, guardiaoRegra4 } from "./rules.js";
import { ordenarSequenciaComCoringa, canPlaceCardOnTable } from "./rules.js";
import { isValidSequence, isValidTrinca, normalizeSequence, isSequenciaComCoringa } from "./rules.js";
import { guardiaoRodadaEncerrada, validaBatida, maoPermiteBatida, applyRoundScoring, finalizeMatchIfNeeded } from "./endgame.js";
import { initDeck, shuffleDeck } from "./deck.js"; 
import { renderAll } from "./app.js";
import { startTurnTimer, stopTurnTimer } from "./turnTimer.js";
import { flyCard } from "./render.js";


export function initPlayers(qtd) {
  if (qtd < 2 || qtd > 6) qtd = 2;

  state.players = [];

  for (let i = 0; i < qtd; i++) {
    state.players.push({
      id: i,
      name: `Jogador ${i + 1}`,
      hand: [],
      jogosBaixados: [],
      totalPoints: 0,
      roundPoints: [],
      eliminated: false,    
      chips: 150000, // 💰 fichas (ajuste o valor inicial como quiser)     
      avatarUrl: `https://i.pravatar.cc/80?img=${3 + i}`, // 🧑 avatar (placeholder online por enquanto)
      /*isBot: i !== 0*/
      /*isBot: false*/
      rebuyCount: 0,
      pendingRebuy: false,
      rebuyDeclined: false,


    });
  }

  state.currentPlayer = 0;
  state.selectedCards = [];
}

function ensureAnimQueue() {
  if (!Array.isArray(state.animQueue)) state.animQueue = [];
}

export function animMark(cardOrId, kind) {
  ensureAnimQueue();
  const id = typeof cardOrId === "object" ? cardOrId?.id : cardOrId;
  if (!id) return;
  state.animQueue.push({ id, kind });
}

// ======== SOM (beep curtinho estilo “carta”) ========
let _audioCtx = null;


function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}


// ✅ chama isso em qualquer clique do usuário para destravar o áudio
export function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) {}

  // ✅ também destrava o sistema de áudio do render.js
  try {
    window.unlockAudioOnce?.();
  } catch (e) {}
}

export function playCardSound(kind = "deal") {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") return; // só toca depois de unlock

    const now = ctx.currentTime;

    // “thwip” curto com ruído + filtro (soa mais como carta)
    const duration = 0.09;

    // noise buffer
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.6;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(kind === "discard" ? 900 : 700, now);

    const gain = ctx.createGain();
    // volume bem mais alto
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
  } catch (e) {
    // ignora
  }
}

// ✅ Som de distribuição em rajada (usado no startNextRound e deals)
function playDealBurst(n = 9) {
  let i = 0;
  const t = setInterval(() => {
    playCardSound("deal");
    i++;
    if (i >= n) clearInterval(t);
  }, 35);
}

export function playVictorySound() {
  try {
    const ctx = getAudioCtx();

    // tenta destravar se estiver suspenso
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    function tone(freq, start, duration, gainValue = 0.06, type = "triangle") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    }

    // sequência curta de vitória
    tone(660, now + 0.00, 0.10, 0.05, "triangle");
    tone(880, now + 0.12, 0.12, 0.055, "triangle");
    tone(1100, now + 0.26, 0.16, 0.06, "triangle");
  } catch (e) {
    // ignora
  }
}



function revertPendingJokerSwap() {
  const swap = state?.pendingJokerSwap;
  if (!swap) return false;

  const { gameIndex, joker, real } = swap;

  const jogo = state.table?.[gameIndex];
  if (!jogo || jogo.type !== "SEQUENCIA" || !Array.isArray(jogo.cards)) {
    state.pendingJokerSwap = null;
    state.mustUseJokerId = null;
    return false;
  }

  // 1) devolve o coringa para a sequência (trocando de volta no lugar da real)
  const idxRealNaMesa = jogo.cards.findIndex(c => c && c.id === real.id);
  if (idxRealNaMesa !== -1) {
    const restaurada = [...jogo.cards];
    restaurada[idxRealNaMesa] = joker;

    // tenta normalizar (mantém a sequência bonitinha)
    const norm = normalizeSequence(restaurada);
    jogo.cards = norm || restaurada;
  }

  // 2) remove o coringa da mão e devolve a carta real para a mão
  const mao = currentPlayer().hand || [];
  const idxJokerNaMao = mao.findIndex(c => c && c.id === joker.id);
  if (idxJokerNaMao !== -1) {
    mao.splice(idxJokerNaMao, 1);
  }
  mao.push(real);

  // 3) limpa obrigação
  state.pendingJokerSwap = null;
  state.mustUseJokerId = null;

  // limpa seleção pra evitar “estado estranho”
  state.selectedCards = [];

  return true;
}

function tryEndRoundByBatida() {
  // só tenta se a mão zerou
  if (currentPlayer().hand.length !== 0) return;

  // já encerrou? não duplica
  if (state.rodadaEncerrada || state.faseTurno === "FIM_RODADA") return;

  if (validaBatida(currentPlayer())) {
  confirmBatida("mão zerou");
} else {
  console.log("❌ mão zerou, mas batida inválida (validaBatida falhou)");
}
}

export function getNextActivePlayerIndex(fromIndex) {
  const n = state.players.length;
  if (!n) return 0;

  let idx = fromIndex;
  let tries = 0;

  do {
    idx = (idx + 1) % n;
    tries++;
  } while (tries <= n && state.players[idx]?.eliminated);

  return idx;
}


export function dealInitialCards(qtd = 9) {
  state.players.forEach(player => {
    player.hand = [];

    for (let i = 0; i < qtd; i++) {
      const card = state.deck.pop();
      if (!card) break;
      player.hand.push(card);
    }
  });
  function playDealBurst(n = 9) {
  let i = 0;
  const t = setInterval(() => {
    playCardSound("deal");
    i++;
    if (i >= n) clearInterval(t);
  }, 35);
}
playDealBurst(9);

}



export function comprarDoMonte() {
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Não é a sua vez.");
      return;
    }

    // Só compra na fase correta (o servidor também valida)
    if (state.faseTurno && state.faseTurno !== "COMPRAR") {
      showGameNotice("❌ Fase inválida.");
      return;
    }

    // ✅ No online, NÃO MUDE state aqui.
    // ❌ NÃO faça: state.faseTurno = "DESCARTAR";

    const myPlayer = currentPlayer?.();
    state.pendingDrawFromDeck = {
      requestedAt: Date.now(),
      handBeforeIds: Array.isArray(myPlayer?.hand)
        ? myPlayer.hand.map(c => String(c.id))
        : []
    };

    window.wsSendAction({ type: "drawDeck" });
    return;
  }



  // =============================
  // OFFLINE (seu código antigo)
  // =============================
  if (!guardiaoRodadaEncerrada()) return;
  if (!guardiaoRegra4("COMPRAR")) return;

  if (
    state.faseTurno === "BAIXAR" &&
    state.origemCompra === "LIXO" &&
    state.cartaDoLixo &&
    !state.baixouComLixo
  ) {
    desistirDoLixoEPassar();
    return;
  }

  if (state.turnoTravado) return;
  if (state.faseTurno !== "COMPRAR") return;

  if (state.jaComprouNoTurno) {
    showGameNotice("❌ Você já comprou neste turno.");
    return;
  }

  const carta = state.deck.pop();
  if (!carta) return;

  currentPlayer().hand.push(carta);
  state.jaComprouNoTurno = true;
  animMark(carta, "deal");
  playCardSound("deal");

  state.selectedCards = [];
  state.origemCompra = "MONTE";
  state.cartaDoLixo = null;
  state.baixouComLixo = false;

  state.faseTurno = "DESCARTAR";
  state.obrigacaoBaixar = false;
  state.fase = "BAIXAR";
  state.bloqueioLixoAteComprarMonte = false;
}

export function toggleSelectCard(cardId) {
  // não bloqueia seleção em turnos que você quiser, mantenha se já tiver regra
  if (!state.selectedCards) state.selectedCards = [];

  // ✅ GUARDA O ID COMO ELE VEM (não transforma em String)
  const idx = state.selectedCards.findIndex(x => String(x) === String(cardId));
  if (idx === -1) state.selectedCards.push(cardId);
  else state.selectedCards.splice(idx, 1);
}

export function discardSelectedCard() {
  console.log("🔥 DISCARD ENVIADO");
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Não é a sua vez.");
      return;
    }

  if (state.faseTurno !== "BAIXAR" && state.faseTurno !== "DESCARTAR") {
  showGameNotice("Fase inválida.");
  return;
}

    if (!state.selectedCards || state.selectedCards.length !== 1) {
      showGameNotice("Selecione uma única carta para descartar");
      return;
    }

    const player = currentPlayer();
    const selectedId = state.selectedCards[0];

    // DEBUG
    console.log("[CLIENT] selectedId =", selectedId);
    console.log("[CLIENT] hand ids =", (player?.hand || []).map(c => c.id));

    // acha a carta na mão atual
    const found = (player?.hand || []).find(c => String(c.id) === String(selectedId));
    if (!found) {
      showGameNotice("Carta inválida (cliente): selecione novamente.");
      state.selectedCards = [];
      if (typeof window.renderAll === "function") window.renderAll();
      return;
    }

    // ✅ ENVIO CORRETO: se parece número, manda como NÚMERO
    const num = Number(found.id);
    const cardIdToSend = Number.isFinite(num) ? num : found.id;

    console.log("[CLIENT] discard -> cardId:", cardIdToSend, " (type:", typeof cardIdToSend, ")");
    window.wsSendAction({ type: "discard", cardId: cardIdToSend });

    state.selectedCards = [];
    return;
  }

  // =============================
  // OFFLINE (seu código atual)
  // =============================
  if (!guardiaoRegra4("DESCARTAR")) return;

  if (state.faseTurno !== "DESCARTAR") {
    showGameNotice("Você ainda não pode descartar");
    return;
  }

  if (state.selectedCards.length !== 1) {
    showGameNotice("Selecione uma única carta para descartar");
    return;
  }

  if (state.obrigacaoBaixar) {
    console.log("❌ Você é obrigado a baixar um jogo primeiro");
    return;
  }

    // 🃏 Se tirou coringa de uma sequência, é obrigado a usar esse coringa em um NOVO jogo.
  // Se tentar descartar sem cumprir, desfaz automaticamente.
  if (state.mustUseJokerId && state.pendingJokerSwap) {
    const desfez = revertPendingJokerSwap();
    if (desfez) {
      showGameNotice("⚠️ Descarte Inválido! Use o coringa para baixar um jogo.");
      renderAll();
    }
    return;
  }
  const cardId = state.selectedCards[0];
  const index = currentPlayer().hand.findIndex(c => c.id === cardId);
  if (index === -1) return;

  const card = currentPlayer().hand[index];

  // 🚫 não pode descartar coringa
  if (card.isJoker) {
    showGameNotice("Não é permitido descartar o coringa");
    return;
  }

  // 🚫 pegou do lixo e não baixou
  if (state.origemCompra === "LIXO" && !state.baixouComLixo) {
    // ✅ fallback automático: volta pro lixo e passa
    desistirDoLixoEPassar();
    return;
  }

  // 🚫 NOVA REGRA: não pode descartar carta que pode ser colocada na mesa
  // (evita passar carta para outro jogador)
  if (canPlaceCardOnTable(card, state.table)) {
    showGameNotice("❌ Descarte inválido: essa carta pode ser colocada na mesa.");
    return;
  }

  // 🗑️ DESCARTE (com animação)
  const handEl = document.getElementById("hand");
  const fromEl = handEl?.children?.[index];
  const toEl = document.getElementById("lixo");

  // remove do estado
  currentPlayer().hand.splice(index, 1);
  state.lixo.push(card);

  // anima se tiver os elementos:
  if (fromEl && toEl) {
    flyCard({ fromEl, toEl, card, sfx: "drop", duration: 260 });
  }

  animMark(card, "discard");
  playCardSound("discard");

  console.log("🗑️ descartou carta");

  state.selectedCards = [];

  // 🏁 TENTATIVA DE BATIDA POR DESCARTE (✅ agora vem ANTES do autoNextTurn)
  if (validaBatida(currentPlayer())) {
    confirmBatida("por descarte");
    return;
  }

  // segue o jogo (não bateu)
  state.faseTurno = "AGUARDANDO";
  state.turnoTravado = true;
  state.origemCompra = null;
  stopTurnTimer();

  // ✅ só passa a vez se NÃO encerrou a rodada
  if (
  !state.autoTurnInProgress && // ✅ se o timer está rodando, NÃO agenda autoNextTurn
  !state.rodadaEncerrada &&
  state.faseTurno !== "FIM_RODADA" &&
  !state.partidaEncerrada
) {
    autoNextTurn(1000);
  }
}

function confirmBatida(reason = "") {
  // ✅ já encerrou? sai fora
  if (state.rodadaEncerrada || state.faseTurno === "FIM_RODADA") return false;

  console.log(`🏁 BATIDA CONFIRMADA${reason ? " - " + reason : ""}`);

  state.rodadaEncerrada = true;
  state.faseTurno = "FIM_RODADA";

  // ✅ pontuação UMA vez
  if (!state.pontuacaoAplicadaNaRodada) {
    applyRoundScoring();
    state.pontuacaoAplicadaNaRodada = true;
  }

  // ✅ agenda próxima rodada UMA vez (mesmo que várias tentativas chamem)
  scheduleNextRoundWithRebuyWindow(8000);

  return true;
}


export function layDownSelectedSet() {
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Não é a sua vez.");
      return;
    }

    // ✅ no online, baixar só é permitido na fase BAIXAR
    if (state.faseTurno !== "BAIXAR") {
      showGameNotice("Fase inválida para baixar: " + state.faseTurno);
      return;
    }

    if (!state.selectedCards || state.selectedCards.length < 3) {
      showGameNotice("Selecione ao menos 3 cartas");
      return;
    }

    // ✅ manda os ids pro servidor
    const cardIds = state.selectedCards.map(x => x);
  console.log("[CLIENT] playMeld -> cardIds:", cardIds);

  const cardSnapshots = cardIds.map((id) => {
  const el = document.querySelector(`.card[data-card-id="${String(id)}"]`);
  const rect = el?.getBoundingClientRect?.();
    return {
      id: String(id),
      rect: rect
        ? {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        : null
    };
  });

  state.pendingPlayToTable = {
    cardIds: [...cardIds],
    cardSnapshots,
    requestedAt: Date.now()
  };

  window.wsSendAction({ type: "playMeld", payload: { cardIds } });

  // limpa seleção local (servidor vai mandar state atualizado)
  state.selectedCards = [];
  return;
  }


  console.log("🚨 layDownSelectedSet CHAMADA");
  console.log("faseTurno:", state.faseTurno);
  console.log("obrigacaoBaixar:", state.obrigacaoBaixar);
  console.log("selectedCards (ids):", state.selectedCards);
  console.log("mão atual:", currentPlayer().hand);

  // =============================
  // VALIDAÇÕES INICIAIS
  // =============================
  if (state.selectedCards.length < 3) {
    console.warn("❌ menos de 3 cartas selecionadas");
    showGameNotice("Selecione ao menos 3 cartas");
    return;
  }

  let cards = state.selectedCards.map(id =>
    currentPlayer().hand.find(c => c.id === id)
  );

    // 🃏 Obrigação: se substituiu coringa na mesa, só pode baixar um NOVO jogo se incluir esse coringa
  if (state.mustUseJokerId) {
    const estaUsandoOJokerObrigatorio = cards.some(c => c && c.id === state.mustUseJokerId);
    if (!estaUsandoOJokerObrigatorio) {
      showGameNotice("⚠️ Você substituiu um coringa na mesa. Agora precisa baixar um NOVO jogo usando esse coringa, ou então desfazer a substituição ao tentar descartar.");
      return;
    }
  }

  console.log("🧠 cartas resolvidas:", cards);
  console.log(
    "🧠 resumo:",
    cards.map(c => (c?.isJoker ? "🃏" : `${c.valor}${c.naipe}`))
  );

  if (cards.includes(undefined)) {
    console.error("❌ Erro ao resolver cartas selecionadas", cards);
    return;
  }

  // =============================
  // DETERMINAÇÃO DO TIPO
  // =============================
  let type = null;

  const temCoringa = cards.some(c => c.isJoker);
  const coringas = cards.filter(c => c.isJoker);
  const reais = cards.filter(c => !c.isJoker);

  // ✅ batida = quando está usando todas as cartas da mão
  const isFinalMove = cards.length === currentPlayer().hand.length;

  console.log("isFinalMove:", isFinalMove);
  console.log("🔎 análise:", {
    coringas: coringas.length,
    reais: reais.length,
    obrigacaoBaixar: state.obrigacaoBaixar
  });

  // ✅ REGRA 9 — 2 coringas + 1 carta (SOMENTE NA BATIDA)

// ✅ especial: 2 coringas + 1 carta real PARA BATER APÓS DESCARTE
// mão tem 4, baixa 3, sobra 1 para descartar e bater
const isSpecialDiscardFinish =
  currentPlayer().hand.length === 4 &&
  cards.length === 3 &&
  coringas.length === 2 &&
  reais.length === 1;

// ✅ REGRA 9 — 2 coringas + 1 carta
// - permitido se for movimento final (sem descarte)
// - OU se for exatamente o caso especial para bater após descarte
if ((isFinalMove || isSpecialDiscardFinish) && coringas.length === 2 && reais.length === 1) {
  console.log("✅ REGRA 9 ATIVADA — 2 coringas + 1 carta (batida / batida após descarte)");
  type = "TRINCA";
}

  else if (isValidTrinca(cards)) {
    console.log("✅ trinca clássica válida");
    type = "TRINCA";
  }
  else if (!temCoringa && isValidSequence(cards)) {
    console.log("✅ sequência sem coringa válida");
    type = "SEQUENCIA";
  }
  else if (temCoringa && isSequenciaComCoringaValida(cards)) {
    console.log("✅ sequência com coringa válida");
    type = "SEQUENCIA";
  }

  console.log("🎯 tipo determinado:", type);

  // ⛔ BLOQUEIO REAL — SEM ISSO O BUG VOLTA
if (!type) {
  // caso especial: pegou do lixo e ainda não cumpriu
  if (state.origemCompra === "LIXO" && state.cartaDoLixo && !state.baixouComLixo) {
    showGameNotice("❌ Jogo inválido. Baixe um jogo válido OU devolva a carta ao lixo.");
    // mantém em BAIXAR: ele pode tentar de novo ou clicar no lixo para devolver
    state.faseTurno = "BAIXAR";
    return;
  }

  // caso normal: pode tentar baixar novamente ou desistir e descartar no lixo
  showGameNotice("❌ Jogo inválido. Baixe um jogo válido ou descarte no lixo.");

  // ✅ garante que o clique no lixo vai descartar (seu renderLixo usa faseTurno)
  state.faseTurno = "DESCARTAR";

  // ✅ não remove nada da mão (rollback automático)
  // ✅ pode manter selectedCards para ele ajustar (não mexo)

  return;
}



  // =============================
  // VALIDAÇÃO FINAL DE SEQUÊNCIA
  // =============================
  if (type === "SEQUENCIA") {
    console.log("🔁 validação final de sequência");

    if (temCoringa) {
      if (!isSequenciaComCoringaValida(cards)) {
        console.error("❌ sequência com coringa inválida (gaveta)");
        showGameNotice("Sequência inválida (regra da gaveta)");
        return;
      }

      const normalizada = normalizeSequence(cards);
        if (!normalizada) {
          showGameNotice("Sequência inválida");
          return;
        }
        cards = normalizada;

    } else {
      if (!isValidSequence(cards)) {
        console.error("❌ sequência sem coringa inválida");
        showGameNotice("Sequência inválida");
        return;
      }

      cards = normalizeSequence(cards);
      if (!cards) {
        console.error("❌ normalizeSequence retornou null");
        showGameNotice("Sequência inválida");
        return;
      }
    }
  }

  // =============================
  // VALIDAÇÃO DO LIXO (ANTES DE MEXER NO ESTADO)
  // =============================
  if (state.origemCompra === "LIXO" && state.cartaDoLixo) {
    const usou = cards.some(c => c.id === state.cartaDoLixo.id);

    if (!usou) {
      console.error("❌ não usou carta do lixo");
      showGameNotice("Você pegou do lixo e precisa usar essa carta");
      return;
    }
  }

  // =============================
  // REMOVE DA MÃO (ÚNICA VEZ)
  // =============================
  // ✅ backup para rollback caso algo falhe depois da remoção
  const backupSelecionadas = [...cards];

// =============================
// ANIMAÇÃO: cartas indo pra mesa
// =============================
const handEl = document.getElementById("hand");
const tableEl = document.getElementById("table");

// pega os elementos DOM das cartas selecionadas (na ordem que aparecem na mão)
const selectedIds = [...state.selectedCards];
const fromEls = [];
const cardsToAnimate = [];

if (handEl && tableEl) {
  for (let i = 0; i < currentPlayer().hand.length; i++) {
    const c = currentPlayer().hand[i];
    if (selectedIds.includes(c.id)) {
      fromEls.push(handEl.children[i]);
      cardsToAnimate.push(c);
    }
  }
}

  console.log("✂️ removendo cartas da mão");
  currentPlayer().hand = currentPlayer().hand.filter(
    c => !state.selectedCards.includes(c.id)
  );

  
  // =============================
// ADICIONA NA MESA
// =============================
console.log("📥 baixando jogo na mesa:", { type, cards });

const novoJogo = {
  type,
  cards: [...cards]
};

// animação: do hand pro centro da mesa
if (fromEls.length && tableEl) {
  // destino: centro do table (um “alvo” invisível)
  const target = document.createElement("div");
  target.style.position = "absolute";
  target.style.left = "50%";
  target.style.top = "50%";
  target.style.width = "1px";
  target.style.height = "1px";
  target.style.pointerEvents = "none";
  tableEl.appendChild(target);

  // anima cada carta com um pequeno delay
  fromEls.forEach((fromEl, i) => {
  const c = cardsToAnimate[i];
  if (!fromEl || !c) return;

  setTimeout(() => {
    // 🔊 som de distribuição controlado
    window.playDealSfxTick?.();

    window.__flyCard?.({
      fromEl,
      toEl: target,
      card: c,
      sfx: i === 0 ? "place" : null,
      duration: 260
    });

  }, i * 45);
});

setTimeout(() => target.remove(), 700);
}


// ✅ Pontinho Clássico — trinca “nasce” com 3 naipes permitidos
if (type === "TRINCA") {
  const reais = cards.filter(c => c && !c.isJoker);

  // só salva se for trinca normal (não batida com coringas)
  if (reais.length >= 3) {
    const naipes = Array.from(new Set(reais.map(c => c.naipe)));
    // exige exatamente 3 naipes diferentes na trinca inicial
    if (naipes.length !== 3) {
  showGameNotice("❌ Jogo inválido. Baixe um jogo válido ou descarte no lixo.");

  // ✅ rollback: devolve cartas para a mão
  currentPlayer().hand.push(...backupSelecionadas);

  // ✅ permite descartar no lixo imediatamente
  state.faseTurno = "DESCARTAR";

  return;
    }
    novoJogo.allowedSuits = naipes; // 👈 guarda a regra da trinca
  }
}

state.table.push(novoJogo);
for (const c of cards) animMark(c, "table");
playCardSound("table");



  // =============================
  // CONFIRMA USO DO LIXO (limpa tudo do lixo)
  // =============================
  if (state.origemCompra === "LIXO" && state.cartaDoLixo) {
    state.baixouComLixo = true;
    state.cartaDoLixo = null;
    state.origemCompra = null; // ✅ faltava isso
  }

  // 🔓 CUMPRIU A OBRIGAÇÃO DE BAIXAR
  state.obrigacaoBaixar = false;

  // =============================
  // LIMPA SELEÇÃO E AVANÇA FASE
  // =============================
  state.selectedCards = [];
  state.faseTurno = "DESCARTAR";

  console.log("✅ layDown concluído com sucesso");

    // ✅ cumpriu a obrigação do coringa (usou em novo jogo)
  if (state.mustUseJokerId) {
    const usou = cards.some(c => c && c.id === state.mustUseJokerId);
    if (usou) {
      state.mustUseJokerId = null;
      state.pendingJokerSwap = null;
    }
  }
  // ✅ se baixou tudo e zerou a mão, tenta bater
  tryEndRoundByBatida();
}


export function addCardToTableGame(gameIndex) {
    // =============================
  // ONLINE (servidor autoritativo) - adicionar carta em jogo da mesa
  // Fluxo: clica carta da mão -> clica no jogo da mesa -> adiciona
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }

    // tem que ser sua vez
    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Não é a sua vez.");
      return;
    }

    // só pode adicionar após comprar (janela BAIXAR)
    if (state.faseTurno !== "BAIXAR") {
      showGameNotice("Fase inválida para adicionar: " + state.faseTurno);
      return;
    }

    if (!state.selectedCards || state.selectedCards.length === 0) {
      showGameNotice("Selecione 1 ou mais cartas da mão para adicionar.");
      return;
    }

    // ✅ gameIndex do client corresponde ao meldIndex do servidor
    const meldIndex = gameIndex;

// manda ids selecionados
const cardIds = state.selectedCards.slice();

console.log("[CLIENT] addToMeld -> meldIndex:", meldIndex, "cardIds:", cardIds);

const cardSnapshots = cardIds.map((id) => {
const el = document.querySelector(`.card[data-card-id="${String(id)}"]`);
const rect = el?.getBoundingClientRect?.();
  return {
    id: String(id),
    rect: rect
      ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        }
      : null
  };
});

state.pendingAddToTable = {
  cardIds: [...cardIds],
  meldIndex,
  cardSnapshots,
  requestedAt: Date.now()
};

  window.wsSendAction({ type: "addToMeld", payload: { meldIndex, cardIds } });

  // limpa seleção local
  state.selectedCards = [];
  return;
  }


  console.log("▶️ addCardToTableGame", gameIndex);

  if (!guardiaoRegra4("BAIXAR")) return;
  if (!state.selectedCards.length) return;

  const jogo = state.table[gameIndex];
  if (!jogo || !Array.isArray(jogo.cards)) return;

  const mao = currentPlayer().hand;
  const selecionadas = state.selectedCards
    .map(id => mao.find(c => c.id === id))
    .filter(Boolean);

  if (!selecionadas.length) return;

  // =============================
  // Helper: cumpre obrigação do lixo somente se a carta do lixo foi usada NESTA jogada
  // =============================
  const usouCartaDoLixoNestaJogada =
    state.origemCompra === "LIXO" &&
    state.cartaDoLixo &&
    selecionadas.some(c => c && c.id === state.cartaDoLixo.id);

  function cumprirLixoSeUsou() {
    if (!usouCartaDoLixoNestaJogada) return;
    state.baixouComLixo = true;
    state.cartaDoLixo = null;
    state.origemCompra = null;
    state.obrigacaoBaixar = false;
  }
  function avancarParaDescarteSeBaixou() {
  if (state.faseTurno === "BAIXAR") {
    state.faseTurno = "DESCARTAR";
  }
  }


function tentarEncerrarRodadaSeMaoZerou() {
  // só tenta se a mão zerou
  if (currentPlayer().hand.length !== 0) return;

  // evita pontuar duas vezes
  if (state.rodadaEncerrada || state.faseTurno === "FIM_RODADA") return;

  if (validaBatida(currentPlayer())) {
  confirmBatida("sem descarte");
} else {
  console.log("❌ mão zerou, mas validaBatida falhou");
}
}

function avisarLixoSeTravado() {
  if (state.origemCompra === "LIXO" && state.cartaDoLixo && !state.baixouComLixo) {
    showGameNotice("❌ Jogo inválido. Baixe um jogo OU devolva a carta ao lixo.");
  }
}





  // =============================
// 🏁 REGRA 9 — 2 CORINGAS + 1 CARTA
// - Se for a ÚLTIMA jogada (mão tem 3): é batida e encerra rodada
// - Se NÃO for última jogada: permite baixar como TRINCA especial e seguir turno normal
// =============================
if (
  state.selectedCards.length === 3 &&
  selecionadas.filter(c => c.isJoker).length === 2 &&
  selecionadas.filter(c => !c.isJoker).length === 1
) 
{  console.log("🧨 REGRA 9 — 2 coringas + 1 carta");

  // ✅ Caso 1: é a última jogada => BATIDA
  if (mao.length === 3) {
    jogo.cards = [...selecionadas];
    currentPlayer().hand = [];
    state.selectedCards = [];

    state.rodadaEncerrada = true;
    state.faseTurno = "FIM_RODADA";

    if (!state.pontuacaoAplicadaNaRodada) {
      applyRoundScoring();
      state.pontuacaoAplicadaNaRodada = true;
    }

    cumprirLixoSeUsou?.();

    console.log("🏁 BATIDA VÁLIDA — 2 CORINGAS + 1 CARTA");
    tentarEncerrarRodadaSeMaoZerou();
    return;
  }
  

// ✅ Caso 2: NÃO é a última jogada => permitido SOMENTE se sobrar 1 carta (para descartar e bater)
if (mao.length !== 4) {
  showGameNotice("❌ 2 coringas + 1 carta só é permitido fora do final quando for para bater após descarte.");
  return;
}

const novoJogo = { type: "TRINCA", cards: [...selecionadas] };

state.table.push(novoJogo);
if (!Array.isArray(currentPlayer().jogosBaixados)) currentPlayer().jogosBaixados = [];
currentPlayer().jogosBaixados.push(novoJogo);

// remove as 3 cartas da mão
const ids = new Set(selecionadas.map(c => c.id));
currentPlayer().hand = mao.filter(c => !ids.has(c.id));

state.selectedCards = [];

cumprirLixoSeUsou?.();

// ✅ força a fase para DESCARTAR (mesmo que não esteja em BAIXAR)
state.faseTurno = "DESCARTAR";
state.obrigacaoBaixar = false;

console.log("✅ REGRA 9: 2 coringas + 1 carta baixada para bater após descarte");
tentarEncerrarRodadaSeMaoZerou(); // não vai encerrar ainda (mão tem 1)
return;


  
}


  // =============================
  // SEQUÊNCIA — ESTÁVEL
  // =============================
  if (jogo.type === "SEQUENCIA") {
    const mesa = [...jogo.cards];

    // 🔁 REGRA 3 — substituir coringa por carta real
  // 🔁 REGRA 3 — substituir coringa por carta real (VERSÃO SEGURA, anti-duplicação)
if (selecionadas.length === 1) {
  const carta = selecionadas[0];

  // ✅ só carta real (não joker)
  if (!carta || carta.isJoker) {
    // cai para as próximas regras (ex: adicionar coringa especial)
  } else {
    const pl = currentPlayer();

    // ✅ garantia: a carta precisa estar na mão AGORA (não confia no "mao" antigo)
    const cartaNaMao = (pl.hand || []).some(c => c && c.id === carta.id);
    if (!cartaNaMao) {
      showGameNotice("❌ Essa carta não está na sua mão para substituir o coringa.");
      return;
    }

    // ✅ segurança: não pode “substituir” usando uma carta que já está na sequência
    if (mesa.some(c => c && c.id === carta.id)) {
      showGameNotice("❌ Essa carta já está na sequência.");
      return;
    }

    // pega índices de todos os coringas na mesa
    const indicesCoringa = mesa
      .map((c, i) => (c && c.isJoker ? i : -1))
      .filter(i => i !== -1);

    if (indicesCoringa.length) {
      // tenta substituir 1 coringa por vez
      for (const idxCoringa of indicesCoringa) {
        const coringaRetornado = mesa[idxCoringa];

        // remove APENAS esse coringa da mesa e adiciona a carta real
        const mesaSemEsseCoringa = mesa.filter((_, i) => i !== idxCoringa);
        const tentativaSub = [...mesaSemEsseCoringa, carta];

        if (isSequenciaComCoringa(tentativaSub)) {
          const normalizada = normalizeSequence(tentativaSub);
          if (!normalizada) continue;

          // ✅ atualiza sequência na mesa
          jogo.cards = normalizada;

          // ✅ remove a carta real da mão (usa hand atual)
          pl.hand = (pl.hand || []).filter(c => c && c.id !== carta.id);

          // ✅ devolve o coringa específico (ANTI-DUPLICAÇÃO: só se ainda não estiver na mão)
          const jaTemEsseCoringaNaMao = (pl.hand || []).some(c => c && c.id === coringaRetornado.id);
          if (!jaTemEsseCoringaNaMao) {
            pl.hand.push(coringaRetornado);
          }

          state.selectedCards = [];

          // ✅ se essa carta usada era a do lixo, cumpre obrigação
          if (usouCartaDoLixoNestaJogada) {
            state.baixouComLixo = true;
            state.cartaDoLixo = null;
            state.origemCompra = null;
            state.obrigacaoBaixar = false;
          }

          console.log("✅ coringa substituído corretamente (anti-duplicação)");
          tentarEncerrarRodadaSeMaoZerou();
          return;
        }
      }
    }
  }
}

// ==================================================
// ✅ REGRA ESPECIAL — CORINGA "SÓ PARA BATER" EM SEQUÊNCIA GRANDE
// Permite adicionar 1 coringa ao FINAL de uma sequência já válida (3+ cartas reais),
// sem usar normalizeSequence/isSequenciaComCoringa.
// Bloqueia casos pequenos tipo 6♣ 7♣ 🃏 (inválido).
// ==================================================
if (selecionadas.length === 1 && selecionadas[0].isJoker) {
  const reaisMesa = mesa.filter(c => c && !c.isJoker);

  // ✅ só permite se já existir sequência "grande" (3+ reais)
  if (reaisMesa.length >= 3) {
    // (opcional segurança) precisa ser mesmo naipe entre as reais
    const naipe = reaisMesa[0]?.naipe;
    const sameSuit = naipe && reaisMesa.every(c => c.naipe === naipe);
    if (!sameSuit) { avisarLixoSeTravado(); return; }

    // ✅ aplica: só coloca o coringa no final
    const coringa = selecionadas[0];
    jogo.cards = [...mesa, coringa];

    // remove o coringa da mão
    currentPlayer().hand = mao.filter(c => c.id !== coringa.id);
    state.selectedCards = [];

    cumprirLixoSeUsou();
    avancarParaDescarteSeBaixou();

    console.log("✅ coringa adicionado ao final da sequência (uso especial para batida)");
    tentarEncerrarRodadaSeMaoZerou();
    return;
  }

  /* sequência pequena com coringa é inválida (ex.: 6♣ 7♣ 🃏)
  showGameNotice("❌ Curinga não pode ser usado para completar sequência pequena (mínimo 3 cartas reais na mesa).");
  */
  return;
}


    // =============================
    // REGRA 5 — CARTA + CORINGA (GAVETA)
    // =============================
    if (
  selecionadas.length === 2 &&
  selecionadas.some(c => c.isJoker) &&
  selecionadas.some(c => !c.isJoker)
) {
  const cartaReal = selecionadas.find(c => !c.isJoker);
  const coringa = selecionadas.find(c => c.isJoker);
  if (!cartaReal || !coringa) return;

  const tentativaEsq = [cartaReal, coringa, ...mesa];
  const tentativaDir = [...mesa, coringa, cartaReal];

  let normalizada = null;

  if (isSequenciaComCoringa(tentativaEsq)) {
    normalizada = normalizeSequence(tentativaEsq);
  } else if (isSequenciaComCoringa(tentativaDir)) {
    normalizada = normalizeSequence(tentativaDir);
  }

  if (!normalizada) return;

  jogo.cards = normalizada;
  currentPlayer().hand = mao.filter(
    c => c.id !== cartaReal.id && c.id !== coringa.id
  );

  state.selectedCards = [];
  cumprirLixoSeUsou?.(); // se você tem helper, senão mantém seu bloco de lixo
  if (state.faseTurno === "BAIXAR") state.faseTurno = "DESCARTAR";

  console.log("✅ carta + coringa adicionados respeitando gaveta");
  tentarEncerrarRodadaSeMaoZerou();

  return;
}


// =============================
// ADIÇÃO MÚLTIPLA (>=2 cartas reais)
// =============================
if (selecionadas.length >= 2 && selecionadas.every(c => !c.isJoker)) {
  const tentativa = [...mesa, ...selecionadas];

  // valida como sequência (com coringa na mesa ou não)
 if (!isSequenciaComCoringa(tentativa)) { avisarLixoSeTravado(); return; }

  const normalizada = normalizeSequence(tentativa);
  if (!normalizada) return;

  jogo.cards = normalizada;

  // remove todas as cartas selecionadas da mão
  const idsSelecionadas = new Set(selecionadas.map(c => c.id));
  currentPlayer().hand = mao.filter(c => !idsSelecionadas.has(c.id));

  state.selectedCards = [];

  // ✅ se usou a carta do lixo nessa jogada, cumpre
  if (usouCartaDoLixoNestaJogada) {
    state.baixouComLixo = true;
    state.cartaDoLixo = null;
    state.origemCompra = null;
    state.obrigacaoBaixar = false;
  }

  // ✅ se você já tinha o helper de avançar fase, use ele.
  // Se não tiver, essa linha resolve:
  if (state.faseTurno === "BAIXAR") state.faseTurno = "DESCARTAR";

  console.log("✅ múltiplas cartas adicionadas à sequência");
  tentarEncerrarRodadaSeMaoZerou();

  return;
}

// ✅ MELHORIA: permitir adicionar MÚLTIPLAS cartas de uma vez em uma SEQUÊNCIA
if (jogo.type === "SEQUENCIA") {
  const pl = currentPlayer();
  const mesa = Array.isArray(jogo.cards) ? jogo.cards : [];

  // selecionadas da mão
  const selecionadas = (state.selectedCards || [])
    .map(id => (pl.hand || []).find(c => c && c.id === id))
    .filter(Boolean);

  // se o jogador selecionou 2+ cartas, tenta aplicar todas de uma vez
  if (selecionadas.length >= 2) {
    // segurança: não deixa usar carta que já está na mesa
    for (const c of selecionadas) {
      if (mesa.some(m => m && m.id === c.id)) {
        showGameNotice("❌ Uma das cartas selecionadas já está na sequência.");
        return;
      }
    }

    const tentativa = [...mesa, ...selecionadas];

    // valida sequência com coringa e normaliza
    if (isSequenciaComCoringa(tentativa)) {
      const normalizada = normalizeSequence(tentativa);
      if (!normalizada) {
        showGameNotice("❌ Não foi possível organizar a sequência com essas cartas.");
        return;
      }

      // ✅ commit na mesa
      jogo.cards = normalizada;

      // ✅ remove todas as cartas usadas da mão
      const idsUsados = new Set(selecionadas.map(c => c.id));
      pl.hand = (pl.hand || []).filter(c => c && !idsUsados.has(c.id));

      state.selectedCards = [];

      // ✅ se uma das cartas usadas era a carta do lixo, cumpre obrigação
      if (state.cartaDoLixo && selecionadas.some(c => c && c.id === state.cartaDoLixo.id)) {
        state.baixouComLixo = true;
        state.cartaDoLixo = null;
        state.origemCompra = null;
        state.obrigacaoBaixar = false;
      }

      console.log("✅ múltiplas cartas adicionadas na sequência de uma vez");
      tentarEncerrarRodadaSeMaoZerou?.();
      renderAll?.();
      return;
    }

    // se falhar, deixa seguir para as regras antigas (1 por vez / coringa etc.)
  }

  // ... aqui continua seu código atual de sequência (regra 1/2/3 etc.)
}



// =============================
// ✅ NOVA REGRA — 1 CORINGA SOZINHO EM SEQUÊNCIA (sem gaveta)
// Permite encaixar o coringa em qualquer sequência existente.
// Nunca vale para TRINCA (lá já bloqueamos).
// =============================
if (selecionadas.length === 1 && selecionadas[0].isJoker) {
  const coringa = selecionadas[0];

  // tenta encaixar em qualquer lado (normalizeSequence vai organizar)
  const tentativaDir = [...mesa, coringa];
  const tentativaEsq = [coringa, ...mesa];

  let normalizada = null;

  if (isSequenciaComCoringa(tentativaDir)) {
    normalizada = normalizeSequence(tentativaDir);
  } else if (isSequenciaComCoringa(tentativaEsq)) {
    normalizada = normalizeSequence(tentativaEsq);
  }

  if (!normalizada) { avisarLixoSeTravado(); return; }

  jogo.cards = normalizada;

  // remove o coringa da mão
  currentPlayer().hand = mao.filter(c => c.id !== coringa.id);
  state.selectedCards = [];

  cumprirLixoSeUsou();
  avancarParaDescarteSeBaixou();

  console.log("✅ coringa encaixado na sequência (sem gaveta)");
  tentarEncerrarRodadaSeMaoZerou();
  return;
}



    // =============================
    // ADIÇÃO NORMAL (1 carta)
    // =============================
    if (selecionadas.length === 1) {
      const carta = selecionadas[0];
      const tentativa = [...mesa, carta];

    if (!isSequenciaComCoringa(tentativa)) { avisarLixoSeTravado(); return; }

      const normalizada = normalizeSequence(tentativa);

      if (!normalizada) return;

      jogo.cards = normalizada;
      currentPlayer().hand = mao.filter(c => c.id !== carta.id);
      state.selectedCards = [];

      // ✅ se a carta adicionada era a do lixo, cumpre
      cumprirLixoSeUsou();
      avancarParaDescarteSeBaixou();

      console.log("✅ carta adicionada à sequência");
      tentarEncerrarRodadaSeMaoZerou();

      return;
    }
  }




  // =============================
// TRINCA — adicionar 1 ou várias cartas (Pontinho Clássico)
// =============================
if (jogo.type === "TRINCA") {
  // não mexe com coringas aqui
  if (selecionadas.some(c => c.isJoker)) return;

  const mesa = [...jogo.cards];
  const reaisMesa = mesa.filter(c => c && !c.isJoker);
  if (reaisMesa.length < 3) return;

  const valorAlvo = reaisMesa[0].valor;

  // naipes permitidos vêm do jogo (definido quando baixou)
  const allowed = Array.isArray(jogo.allowedSuits) ? jogo.allowedSuits : Array.from(new Set(reaisMesa.map(c => c.naipe)));

  // todas selecionadas precisam ser do mesmo valor e de naipe permitido
  const ok = selecionadas.every(c => c.valor === valorAlvo && allowed.includes(c.naipe));
  if (!ok) { avisarLixoSeTravado(); return; }


  // aplica
  jogo.cards = [...mesa, ...selecionadas];

  // remove da mão
  const ids = new Set(selecionadas.map(c => c.id));
  currentPlayer().hand = mao.filter(c => !ids.has(c.id));

  state.selectedCards = [];

  // lixo: se usou carta do lixo aqui, cumpre
  if (state.origemCompra === "LIXO" && state.cartaDoLixo) {
    const usou = selecionadas.some(c => c.id === state.cartaDoLixo.id);
    if (usou) {
      state.baixouComLixo = true;
      state.cartaDoLixo = null;
      state.origemCompra = null;
      state.obrigacaoBaixar = false;
    }
  }

  if (state.faseTurno === "BAIXAR") state.faseTurno = "DESCARTAR";

  console.log("✅ cartas adicionadas à trinca (Pontinho Clássico)");
  tentarEncerrarRodadaSeMaoZerou();

  return;
}
}

//apostas com fichas// - começa aqui

export function computeAnte() {
  const buyIn = typeof state.room?.buyIn === "number" ? state.room.buyIn : 1000;
  state.ante = Math.ceil(buyIn * 0.1);
  return state.ante;
}

export function collectAnte() {
  const ante = computeAnte();

  // ✅ matchPot = pote único (antes + rebuys)
  if (typeof state.matchPot !== "number") state.matchPot = 0;

  for (const p of state.players) {
    if (p.eliminated) continue;
    if (typeof p.chips !== "number") p.chips = 0;

    // MVP simples: sem fichas pra pagar ante -> elimina
    // (depois você pode trocar para "forçar rebuy")
    if (p.chips < ante) {
      p.eliminated = true;
      continue;
    }

    p.chips -= ante;
    state.matchPot += ante; // ✅ vai para o pote único
  }

  return { ante, pot: state.matchPot };
}

//apostas com fichas// -> termina aqui


export function requestStartCrazyBatidaAttempt() {
  console.log("[BATI] entrou em requestStartCrazyBatidaAttempt");

  if (!(state?.room?.id)) {
    if (typeof showGameNotice === "function") {
      showGameNotice("BATI só funciona dentro de uma mesa online.");
    }
    console.warn("[BATI] sem room.id");
    return false;
  }

  if (typeof window.wsSendAction !== "function") {
    if (typeof showGameNotice === "function") {
      showGameNotice("Conexão online indisponível para BATI.");
    }
    console.warn("[BATI] window.wsSendAction não existe");
    return false;
  }

  console.log("[BATI] enviando startCrazyBatidaAttempt", {
    roomId: state.room?.id,
    mySeat: state.mySeat,
    phase: state.phase,
    currentSeat: state.currentSeat,
    variant: state.room?.variant || state.variant
  });
/*
  if (typeof showGameNotice === "function") {
    showGameNotice("Solicitando BATI...");
  }
*/
  window.wsSendAction({ type: "startCrazyBatidaAttempt" });
  return true;
}



export function requestCancelCrazyBatidaAttempt() {
  if (!(state?.room?.id)) {
    if (typeof showGameNotice === "function") {
      showGameNotice("Mesa inválida para cancelar BATI.");
    }
    console.warn("[BATI] cancel sem room.id");
    return false;
  }

  if (typeof window.wsSendAction !== "function") {
    if (typeof showGameNotice === "function") {
      showGameNotice("Conexão online indisponível para cancelar BATI.");
    }
    console.warn("[BATI] cancel sem wsSendAction");
    return false;
  }

  console.log("[BATI] enviando cancelCrazyBatidaAttempt", {
    roomId: state.room?.id,
    mySeat: state.mySeat
  });

  window.wsSendAction({ type: "cancelCrazyBatidaAttempt" });
  return true;
}



// ============================
// 💰 REBUY (OPCIONAL)
// ============================

// custo: 1ª = 1x ante, 2ª = 2x ante, 3ª = 4x ante ...
export function getRebuyCost(p) {
  const ante = typeof state.ante === "number" && state.ante > 0 ? state.ante : computeAnte();
  const times = Math.pow(2, p.rebuyCount || 0);
  return ante * times;
}

// jogador escolhe rebuy (fica "pendente" para entrar na próxima rodada)
export function requestRebuy() {
  console.log("[CLIENT] requestRebuy() chamada");

  if (state?.room?.id && typeof window.wsSendAction === "function") {
    window.wsSendAction({ type: "rebuy" });
    console.log("[CLIENT] rebuy enviado via WS");
    return true;
  }

showGameNotice("Rebuy só está disponível no modo online.");
  return false;
}

// aplica rebuys pendentes no início da rodada (antes de ante/deal)
export function applyPendingRebuys() {
  // garante que existe pot numérico
  if (typeof state.matchPot !== "number") state.matchPot = 0;

  // referência de pontos (volta "pesado"): iguala ao maior totalPoints entre ativos
  const active = state.players.filter(pl => !pl.eliminated && !pl.pendingRebuy);
  const maxPts = active.length ? Math.max(...active.map(pl => Number(pl.totalPoints) || 0)) : 0;

  for (const pl of state.players) {
    if (!pl.pendingRebuy) continue;

    // limite extra de segurança
    if ((pl.rebuyCount || 0) >= 3) {
      pl.pendingRebuy = false;
      continue;
    }

    const cost = Number(getRebuyCost(pl)) || 0;

    // chips pode vir como string: "50000"
    pl.chips = Number(pl.chips);
    if (!Number.isFinite(pl.chips)) pl.chips = 0;

    // se por algum motivo não tiver mais fichas, cancela
    if (pl.chips < cost || cost <= 0) {
      pl.pendingRebuy = false;
      continue;
    }

    // paga o rebuy
    pl.chips -= cost;   
    state.matchPot = Number(state.matchPot) || 0;// ✅ rebuy vai pro pote (fica bonito e faz sentido)
    state.matchPot += cost;
    

    // volta pro jogo na próxima rodada
    pl.eliminated = false;
    pl.pendingRebuy = false;

    // se tinha recusado antes, desfaz a recusa
    pl.rebuyDeclined = false;

    // aumenta contador (1ª, 2ª, 3ª...)
    pl.rebuyCount = (pl.rebuyCount || 0) + 1;

    // reseta coisas de rodada/mão
    pl.hand = [];
    pl.jogosBaixados = [];
    pl.obrigacaoBaixar = false;

    // volta com pontos “pesados”
    pl.totalPoints = maxPts;
  }
}

export function hasRebuyChoices() {
  if (state.partidaEncerrada) return false; // ✅ fim
  return (state.players || []).some(pl =>
    pl &&
    pl.eliminated === true &&
    pl.pendingRebuy !== true &&
    pl.rebuyDeclined !== true &&
    (pl.rebuyCount || 0) < 3
  );
}

//rebuy// -> termina aqui


export function startNextRound() {
  // ✅ trava anti-dupla (se alguém chamar duas vezes, ignora)
  if (state.nextRoundLock) {
    console.log("⛔ startNextRound bloqueado (já em execução)");
    return;
  }
  state.nextRoundLock = true;

  console.log("🔄 Iniciando próxima rodada...");
  state.jaComprouNoTurno = false;
  state.turnoTravado = false;

  if (state.partidaEncerrada) {
    console.log("🏁 Partida encerrada. Não inicia nova rodada.");
    renderAll();
    state.nextRoundLock = false;
    return;
  }

  // ✅ garante pote numérico e zera ANTES
  if (typeof state.pot !== "number") state.pot = 0;
  state.pot = 0;

  // ✅ aplica rebuys pedidos (entra na rodada agora)
  applyPendingRebuys();

  // ✅ encerra se só sobrou 1 ativo e ninguém mais pode voltar
  const ativos = (state.players || []).filter(pl => pl && !pl.eliminated);

  const existePossivelVolta =
    (state.players || []).some(pl => pl && pl.eliminated === true && pl.pendingRebuy === true) ||
    hasRebuyChoices(); // deve ignorar quem recusou

  if (ativos.length <= 1 && !existePossivelVolta) {
    state.partidaEncerrada = true;
    state.vencedor = ativos.length === 1 ? ativos[0].id : null;
    finalizeMatchIfNeeded();

    console.log("🏁 Partida encerrada. Vencedor:", state.vencedor);
    renderAll();
    state.nextRoundLock = false; // ✅ libera lock antes de sair
    return;
  }

  // 👉 próxima rodada começa no jogador seguinte ao que bateu
  let next = (state.currentPlayer + 1) % state.players.length;
  let tries = 0;
  while (tries < state.players.length && state.players[next].eliminated) {
    next = (next + 1) % state.players.length;
    tries++;
  }
  state.currentPlayer = next;
  state.jaComprouNoTurno = false;
  state.turnoTravado = false;
  state.faseTurno = "COMPRAR";

  // limpa mesa e lixo
  state.table = [];
  state.lixo = [];

  // limpa jogos baixados
  for (const pl of state.players) {
    pl.jogosBaixados = [];
  }

  // reset do turno
  state.selectedCards = [];
  state.faseTurno = "COMPRAR";
  state.origemCompra = null;
  state.cartaDoLixo = null;
  state.baixouComLixo = false;
  state.obrigacaoBaixar = false;
  state.rodadaEncerrada = false;
  state.pontuacaoAplicadaNaRodada = false;

  // ❌ NÃO cobra ante aqui
  // (ante é cobrado só na entrada do jogo e nos rebuys)

  // novo deck e embaralha
  initDeck();
  shuffleDeck();

  // distribui 9 cartas apenas para jogadores ativos
  for (const pl of state.players) {
    if (pl.eliminated) {
      pl.hand = [];
      continue;
    }
    pl.hand = [];
    for (let i = 0; i < 9; i++) {
      const c = state.deck.pop();
      if (!c) break;
      pl.hand.push(c);
    }
  }

  // garante currentPlayer em jogador ativo (caso extremo)
  if (state.players[state.currentPlayer]?.eliminated) {
    let tries2 = 0;
    while (
      tries2 < state.players.length &&
      state.players[state.currentPlayer].eliminated
    ) {
      state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
      tries2++;
    }
  }

  playDealBurst(9);
  renderAll();

  console.log("✅ Rodada reiniciada e cartas distribuídas.");

  state.nextRoundLock = false;
}

export async function nextPlayer() {

  // 🛑 ONLINE → servidor controla o turno
  if (state?.room?.id) {
    return;
  }

  stopTurnTimer();

  if (state.rodadaEncerrada || state.faseTurno === "FIM_RODADA") {
    state.turnoTravado = false;
    state.jaComprouNoTurno = false;

    startNextRound();
    return;
  }

  state.selectedCards = [];
  state.currentPlayer = getNextActivePlayerIndex(state.currentPlayer);

  state.turnoTravado = false;
  state.jaComprouNoTurno = false;
  state.faseTurno = "COMPRAR";
}



// =============================
// BOT (MVP) — sem coringa
// compra do monte -> tenta baixar sequência/trinca simples -> descarta
// =============================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getBotPlayer() {
  const p = currentPlayer();
  return p && p.isBot ? p : null;
}

// acha uma trinca clássica (3 cartas mesmo valor, 3 naipes distintos), sem coringa
function findSimpleTrinca(hand) {
  const cards = hand.filter(c => c && !c.isJoker);

  const byValor = new Map();
  for (const c of cards) {
    if (!byValor.has(c.valor)) byValor.set(c.valor, []);
    byValor.get(c.valor).push(c);
  }

  for (const [valor, list] of byValor.entries()) {
    // precisa de 3 NAIPES distintos na trinca inicial
    const bySuit = new Map();
    for (const c of list) {
      if (!bySuit.has(c.naipe)) bySuit.set(c.naipe, c);
    }
    if (bySuit.size >= 3) {
      return Array.from(bySuit.values()).slice(0, 3);
    }
  }

  return null;
}

// acha uma sequência simples (>=3) por naipe, sem coringa
function findSimpleSequence(hand) {
  const cards = hand.filter(c => c && !c.isJoker);

  // agrupa por naipe
  const bySuit = new Map();
  for (const c of cards) {
    if (!bySuit.has(c.naipe)) bySuit.set(c.naipe, []);
    bySuit.get(c.naipe).push(c);
  }

  for (const [naipe, list] of bySuit.entries()) {
    // ordena por valorIndex
    const sorted = [...list].sort((a, b) => valorIndex(a.valor) - valorIndex(b.valor));

    // remove duplicados por valor (mantém 1)
    const uniq = [];
    const seen = new Set();
    for (const c of sorted) {
      const k = c.valor;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(c);
    }

    // acha “runs” consecutivos
    let run = [uniq[0]];
    for (let i = 1; i < uniq.length; i++) {
      const prev = run[run.length - 1];
      const cur = uniq[i];

      const d = valorIndex(cur.valor) - valorIndex(prev.valor);
      if (d === 1) {
        run.push(cur);
      } else {
        if (run.length >= 3 && isValidSequence(run)) return run.slice(0, 3);
        run = [cur];
      }
    }

    if (run.length >= 3 && isValidSequence(run)) return run.slice(0, 3);
  }

  return null;
}

function canPlaceCardOnAnyTableGame(card) {
  if (!card || card.isJoker) return false;
  if (!Array.isArray(state.table)) return false;

  for (const jogo of state.table) {
    if (!jogo || !Array.isArray(jogo.cards)) continue;

    // ===== SEQUÊNCIA =====
    if (jogo.type === "SEQUENCIA") {
      const tentativa = [...jogo.cards, card];

      // usa sua validação mais forte (gaveta + as alto/baixo)
      if (typeof isSequenciaComCoringaValida === "function") {
        if (isSequenciaComCoringaValida(tentativa)) {
          const norm = normalizeSequence(tentativa);
          if (norm) return true;
        }
      }
    }

    // ===== TRINCA (Pontinho Clássico) =====
    if (jogo.type === "TRINCA") {
      const reais = jogo.cards.filter(c => c && !c.isJoker);
      if (!reais.length) continue;

      const valorAlvo = reais[0].valor;
      if (card.valor !== valorAlvo) continue;

      const allowed = Array.isArray(jogo.allowedSuits)
        ? jogo.allowedSuits
        : Array.from(new Set(reais.map(c => c.naipe)));

      if (allowed.includes(card.naipe)) return true;
    }
  }

  return false;
}



function pickDiscardCard(hand) {
  const cards = (hand || []).filter(c => c && !c.isJoker);
  if (!cards.length) return null;

  const weight = (c) => {
    if (c.valor === "A") return 15;
    if (c.valor === "J" || c.valor === "Q" || c.valor === "K") return 10;
    const n = Number(c.valor);
    return Number.isFinite(n) ? n : 0;
  };

  // 1) primeiro tenta descartar algo que NÃO encaixa em nada na mesa
  const naoColocaveis = cards.filter(c => !canPlaceCardOnAnyTableGame(c));
  const pool = naoColocaveis.length ? naoColocaveis : cards;

  // 2) dentre elas, joga fora a mais “pesada”
  let best = pool[0];
  let bestPts = weight(best);

  for (const c of pool) {
    const pts = weight(c);
    if (pts > bestPts) {
      bestPts = pts;
      best = c;
    }
  }

  return best;
}


export async function botTakeTurn() {
  const bot = getBotPlayer();
  if (!bot) return;

  // pequena pausa “humana”
  // bot “pensa” 2 a 6s antes de agir
  await sleep(8000 + Math.random() * 10000);


  // 1) compra do monte
  comprarDoMonte();
  renderAll?.();

  await sleep(6000);

  // 2) tenta baixar um jogo simples (sem coringa)
  // prioridade: sequência, depois trinca (você pode inverter se quiser)
  let set = findSimpleSequence(bot.hand) || findSimpleTrinca(bot.hand);

  if (set && set.length >= 3) {
    state.selectedCards = set.map(c => c.id);
    layDownSelectedSet();
    renderAll?.();

    await sleep(6000);
  }

      // 3) descarta (se ainda estiver com cartas)
  state.faseTurno = "DESCARTAR";

  // tenta até 5 cartas diferentes pra não travar
  const tentadas = new Set();

  for (let tries = 0; tries < 5; tries++) {
    const d = pickDiscardCard(bot.hand.filter(c => c && !tentadas.has(c.id)));
    if (!d) break;

    tentadas.add(d.id);

    const before = bot.hand.length;

    state.selectedCards = [d.id];
    discardSelectedCard();
    renderAll?.();
      // ✅ bot terminou o turno: passa a vez (não espera o timer)
    await sleep(6000);
    await nextPlayer();
    renderAll?.();


    // se descartou, a mão diminui e saímos
    if (bot.hand.length < before) break;
  }


}



export function pegarDoLixo() {
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }
    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Aguarde sua vez.");
      return;
    }

    const myPlayer = currentPlayer?.();
    state.pendingDrawFromDiscard = {
      requestedAt: Date.now(),
      handBeforeIds: Array.isArray(myPlayer?.hand)
        ? myPlayer.hand.map(c => String(c.id))
        : []
    };

    window.wsSendAction({ type: "drawDiscard" });
        return;
  }

  // =============================
  // OFFLINE (seu código antigo)
  // =============================
  if (!guardiaoRodadaEncerrada()) return;
  if (!guardiaoRegra4("COMPRAR")) return;
  if (state.faseTurno !== "COMPRAR") return;
  if (state.turnoTravado) return;

  if (state.bloqueioLixoAteComprarMonte) {
    showGameNotice("🚫 Lixo bloqueado: você só pode comprar do monte neste turno.");
    return;
  }

  const carta = state.lixo.pop();
  if (!carta) return;

  currentPlayer().hand.push(carta);
  state.jaComprouNoTurno = true;
  animMark(carta, "deal");
  playCardSound("deal");

  state.origemCompra = "LIXO";
  state.cartaDoLixo = carta;
  state.baixouComLixo = false;

  state.faseTurno = "BAIXAR";
  state.selectedCards = [];

  console.log("♻️ comprou do lixo (visível na mão)");
}


export function desistirDoLixoEPassar() {
  // só faz sentido se a compra foi do lixo e a carta ainda está marcada
  if (state.origemCompra !== "LIXO" || !state.cartaDoLixo) return;

  const carta = state.cartaDoLixo;

  // ✅ remove da mão (se ainda estiver lá)
  const mao = currentPlayer().hand || [];
  const idx = mao.findIndex(c => c && c.id === carta.id);
  if (idx !== -1) mao.splice(idx, 1);

  // ✅ devolve pro topo do lixo (pra manter consistência visual)
  state.lixo.push(carta);

  // ✅ limpa marcações do lixo
  state.cartaDoLixo = null;
  state.origemCompra = null;
  state.baixouComLixo = false;

  // ✅ trava o lixo até comprar do monte (regra que você já tinha)
  state.bloqueioLixoAteComprarMonte = true;

  // ✅ NÃO mexe em jaComprouNoTurno: ele já comprou (do lixo) e continua valendo
  // Ou seja, não pode comprar novamente depois disso.

  // ✅ encerra o turno como se tivesse descartado "automaticamente"
  state.selectedCards = [];
  state.faseTurno = "AGUARDANDO";
  state.turnoTravado = true;

  // passa a vez rapidinho (mesmo comportamento do descarte)
  autoNextTurn(1000);
}


export function devolverLixoComBloqueio() {
  if (state.origemCompra !== "LIXO" || !state.cartaDoLixo || state.baixouComLixo) return;

  const carta = state.cartaDoLixo;

  // remove da mão
  currentPlayer().hand = currentPlayer().hand.filter(c => c && c.id !== carta.id);

  // devolve ao lixo
  state.lixo.push(carta);

  // limpa flags do lixo do jogador atual
  state.cartaDoLixo = null;
  state.origemCompra = null;
  state.baixouComLixo = false;
  state.obrigacaoBaixar = false;

  // ✅ trava o lixo para o PRÓXIMO jogador até ele comprar do monte
  state.bloqueioLixoAteComprarMonte = true;

  // reset turno e passa a vez
  state.selectedCards = [];
  state.faseTurno = "COMPRAR";

  console.log("↩️ devolveu carta ao lixo; lixo bloqueado para o próximo jogador");

  // passa a vez pulando eliminados
  state.currentPlayer = getNextActivePlayerIndex(state.currentPlayer);
}

export function onClickLixo() {
  // se já pegou do lixo e ainda não baixou com ele,
  // clicar no lixo devolve e passa a vez (com bloqueio para o próximo)
  if (state.origemCompra === "LIXO" && state.cartaDoLixo && !state.baixouComLixo) {
    desistirDoLixoEPassar();
    return;
  }

  // senão, comportamento normal
  pegarDoLixo();
}

export function reorderHandByIds(fromId, toId) {
  const hand = currentPlayer().hand;

  const fromIndex = hand.findIndex(c => String(c.id) === String(fromId));
  const toIndex = hand.findIndex(c => String(c.id) === String(toId));

  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = hand.splice(fromIndex, 1);
  hand.splice(toIndex, 0, moved);

  console.log("🖐️ mão reordenada:", fromId, "->", toId);
}

export function addChips(playerId, amount) {
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  if (typeof p.chips !== "number") p.chips = 0;
  p.chips += amount;
}

export function removeChips(playerId, amount) {
  addChips(playerId, -amount);
}


/*distribuir cartas uma a uma*/
/* distribuir cartas uma a uma */
export async function dealInitialCardsAnimated(qtd = 9) {
  for (let i = 0; i < qtd; i++) {
    for (let pIndex = 0; pIndex < state.players.length; pIndex++) {
      const p = state.players[pIndex];
      if (!p || p.eliminated) continue;

      const card = state.deck.pop();
      if (!card) return;

      p.hand.push(card);

      // renderiza para atualizar a mão no DOM
      renderAll?.();

      const monteEl = document.getElementById("monte");
      const handEl = document.getElementById("hand");
      const toEl = handEl?.lastElementChild;

      if (monteEl && toEl && window.__flyCard) {
        window.__flyCard({
          fromEl: monteEl,
          toEl,
          card,
          sfx: null,
          duration: 240
        });
      } else {
        // fallback: se não houver animação, toca pelo menos o som
        window.playSfx?.("deal");
      }

      // delay entre cartas
      await new Promise(r => setTimeout(r, 90));
    }
  }
}

export function autoNextTurn(delayMs = 100) {
  setTimeout(async () => {
    await nextPlayer();
    if (typeof window.renderAll === "function") {
      window.renderAll();
    }
  }, delayMs);
}


export function autoNextRound(delayMs = 8000) {
  setTimeout(() => {
    // evita dupla chamada
    if (!state.rodadaEncerrada) return;

    // se partida acabou, não inicia rodada nova
    if (state.partidaEncerrada) return;

    startNextRound();

    if (typeof window.renderAll === "function") {
      window.renderAll();
    }
  }, delayMs);
}

// ✅ ÚNICO agendador permitido para próxima rodada
export function scheduleNextRoundWithRebuyWindow(ms = 8000) {
  if (state.partidaEncerrada) return; // ✅ não agenda rodada
  // cancela agendamento anterior (evita rodada dupla)
  if (state.nextRoundTimeoutId) {
    clearTimeout(state.nextRoundTimeoutId);
    state.nextRoundTimeoutId = null;
  }

  // abre “janela de decisão” se existir alguém elegível
  if (hasRebuyChoices()) {
    state.rebuyDecisionUntil = Date.now() + ms;
    window.renderAll?.();
  } else {
    state.rebuyDecisionUntil = 0;
  }

  state.nextRoundTimeoutId = setTimeout(() => {
    state.nextRoundTimeoutId = null;
    state.rebuyDecisionUntil = 0;
    startNextRound();
  }, ms);
}

export function swapJokerOnTable(meldIndex, jokerIndex) {
  // ONLINE
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) return showGameNotice("👁️ Você está assistindo. Não pode jogar.");

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      return showGameNotice("⏳ Não é a sua vez.");
    }

    if (state.faseTurno !== "BAIXAR") {
      return showGameNotice("Fase inválida para trocar coringa: " + state.faseTurno);
    }

    if (!state.selectedCards || state.selectedCards.length !== 1) {
      return showGameNotice("Selecione 1 carta real da sua mão para substituir o coringa.");
    }

    const cardId = state.selectedCards[0];

    window.wsSendAction({
      type: "swapJoker",
      payload: { meldIndex, jokerIndex, cardId }
    });

    state.selectedCards = [];
    return;
  }

  showGameNotice("Troca de coringa só está disponível no modo online (servidor autoritativo).");
}
