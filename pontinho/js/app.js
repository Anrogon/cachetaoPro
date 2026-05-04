
import { initDeck, shuffleDeck } from "./deck.js";
import { renderHand, renderTable, renderMonte, renderLixo, renderPlayerInfo, bindTableUI, renderRoundInfo } from "./render.js";
import { state } from "./state.js";
import { initPlayers,  nextPlayer, unlockAudio, dealInitialCardsAnimated, collectAnte, requestRebuy } from "./actions.js";
import { renderNextPlayerButton, renderPot, renderRebuyOverlay, renderEndMatchOverlay, renderScoreboard, renderDealOverlay } from "./render.js";
import { startTurnTimer } from "./turnTimer.js";
import { renderRebuyButton, playPendingDrawAnimation, playPendingDiscardDrawAnimation, playPendingHandToTableAnimation } from "./render.js";
import { showScreen } from "./screens.js";

window.openTablesFromHome = function (variant) {
  state.selectedVariant = variant;
  renderTablesScreen();

  document.getElementById("homeScreen").style.display = "none";
  document.getElementById("game").style.display = "none";
  document.getElementById("tablesScreen").style.display = "";
};

const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3001/api"
    : "/api";

// =============================
// ONLINE (WS)
// =============================
let socket = null;
let myClientId = null;
let nextActionSeq = 1;

window.socket = null; // debug



// Conecta no WebSocket do MESMO host do site
export function connectWS() {
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;

  const proto = (location.protocol === "https:") ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}`);

  window.socket = socket; // debug
  window.state = state;   // debug

  socket.addEventListener("open", () => {
    console.log("[WS] conectado");
  });

  socket.addEventListener("close", () => {
    console.log("[WS] desconectado");
  });

  socket.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    console.log("[WS] <-", msg.type, msg.payload); // ✅ add aqui

    

// 1) hello
if (msg.type === "hello") {
  myClientId = msg.payload?.clientId || null;

  // garante estrutura
  if (!window.state) window.state = state;

  const tables = Array.isArray(msg.payload?.tables) ? msg.payload.tables : [];

  // ✅ lista base das mesas para o render
  state.tableList = tables.map(table => ({
    id: table.id,
    name: table.name,
    buyIn: table.buyIn
  }));

  // ✅ estado dinâmico por id
  state.tables = {};
  tables.forEach((table) => {
    state.tables[table.id] = table;
  });

  state.online = msg.payload?.online || 0;

  console.log("[WS] hello clientId=", myClientId);
  console.log("[WS] hello tables=", tables);
  console.log("[WS] state.tableList=", state.tableList);
  console.log("[WS] state.tables(byId)=", state.tables);

  // ✅ redesenha a sala de mesas imediatamente
  if (typeof renderTablesScreen === "function") {
    renderTablesScreen();
  }

  return;
}


// 1.5) table_public
if (msg.type === "table_public") {
  const table = msg.payload || {};
  if (!table.id) return;

  window.state = window.state || {};
  window.state.tables = window.state.tables || {};

  window.state.tables[table.id] = {
    ...(window.state.tables[table.id] || {}),
    ...table
  };

  const tablesScreen = document.getElementById("tablesScreen");
  if (tablesScreen && tablesScreen.style.display !== "none") {
    renderTablesScreen();
  }

  return;
}

// 2) joined
if (msg.type === "joined") {
  console.log("[WS] joined recebido", msg.payload);

  const { tableId, mode, seat, reconnectToken } = msg.payload || {};

  state.room = state.room || {};
  state.room.id = tableId;

  state.spectator = (mode === "spectator");
  state.mySeat = seat ?? null;

  if (tableId && seat && reconnectToken) {
    localStorage.setItem(
      `buraco_reconnect_${tableId}_${seat}`,
      reconnectToken
    );
  }

  // garante que a mesa exista no snapshot local
  window.state = window.state || {};
  window.state.tables = window.state.tables || {};
  window.state.tables[tableId] = window.state.tables[tableId] || { id: tableId };

  console.log("[WS] joined", { tableId, mode, seat, reconnectToken });

  // jogador fica aguardando no lobby; espectador pode ver a mesa
  if (mode === "spectator") {
  showScreen("game");
  updateSpectatorUI();
} else {
  showScreen("tables");
  renderTablesScreen();
  updateSpectatorUI();
}

  return;
}

// 3) state_public
if (msg.type === "state_public") {
  const pub = msg.payload || {};
  state.tableId = pub.tableId || state.tableId;
  state.matchPot = Number(pub.matchPot) || state.matchPot || 0;

  // 🔥 ATUALIZA LOBBY (tables) COM ESTADO DO SERVIDOR
if (pub.tableId) {
  const prev = window.state.tables?.[pub.tableId] || {};

  const mergedSeats = Array.isArray(pub.seats)
    ? pub.seats.map((p, i) => p ? ({
        ...p,
        seat: i + 1
      }) : null)
    : (prev.seats || []);

  window.state.tables = window.state.tables || {};

  window.state.tables[pub.tableId] = {
    ...prev,
    id: pub.tableId,
    name: prev.name,
    buyIn: prev.buyIn,
    started: pub.started ?? prev.started ?? false,
    currentSeat: pub.currentSeat ?? prev.currentSeat ?? 1,
    phase: pub.phase ?? prev.phase ?? "WAITING",
    seats: mergedSeats,
    seatedCount: Array.isArray(pub.seats)
      ? pub.seats.filter(Boolean).length
      : (prev.seatedCount || 0),
    maxSeats: prev.maxSeats || 6,
    minPlayersToStart: pub.minPlayersToStart ?? prev.minPlayersToStart ?? 2,
    startAt: Number(pub.startAt) || 0,
    tableMelds: Array.isArray(pub.tableMelds)
      ? pub.tableMelds
      : (prev.tableMelds || []),
    
    discardTop: pub.discardTop ?? prev.discardTop ?? null,
    deckCount: pub.deckCount ?? prev.deckCount ?? 0,
    matchPot: Number(pub.matchPot) || 0,
    roundNumber: Number(pub.roundNumber) || 0
  };
}
  state.started = !!pub.started;
  state.selectedVariant = state.selectedVariant || "CLASSIC";
  state.roundEnded = !!pub.roundEnded;
  state.winnerSeat = pub.winnerSeat ?? null;
  state.rematchVotes = pub.rematchVotes || {};
  state.rematchRequestedBySeat = pub.rematchRequestedBySeat ?? null;

  if (state.roundEnded) {
    state.lastRoundSummary = {
      winnerSeat: state.winnerSeat,
      timestamp: Date.now()
    };
  }

  // turn/fase
  state.faseTurno = pub.phase || "WAITING";
  state.currentSeat = pub.currentSeat ?? null;
  state.variant = String(pub.variant || "CLASSIC").toUpperCase();
  state.turnEndsAt = Number(pub.turnEndsAt) || 0;
  state.buyEndsAt = Number(pub.buyEndsAt) || 0;
  const safeTurnMs = Number(pub.turnMs);
  state.turnDurationSec = Math.ceil(
    (safeTurnMs > 0 && safeTurnMs <= 60000 ? safeTurnMs : 30000) / 1000
  );

  const safeBuyMs = Number(pub.buyMs);
  state.buyDurationSec = Math.ceil(
    (safeBuyMs > 0 && safeBuyMs <= 30000 ? safeBuyMs : 15000) / 1000
  );
  state.dealEndsAt = Number(pub.dealEndsAt) || 0;
  state.dealMs = Number(pub.dealMs) || 2200;
  state.batidaAnnouncement = String(pub.batidaAnnouncement || "");
  state.batidaAnnouncementEndsAt = Number(pub.batidaAnnouncementEndsAt) || 0;
  state.phase = String(pub.phase || "");
  state.currentSeat = Number(pub.currentSeat) || 0;
  state.crazyBatidaAttemptActive = !!pub.crazyBatidaAttemptActive;
  state.crazyBatidaAttemptSeat = Number(pub.crazyBatidaAttemptSeat) || 0;
  state.crazyBatidaAttemptPrioritySeat = Number(pub.crazyBatidaAttemptPrioritySeat) || 0;
  state.crazyBatidaAttemptExpiresAt = Number(pub.crazyBatidaAttemptExpiresAt) || 0;
  state.crazyBatidaBurnedBySeat = pub.crazyBatidaBurnedBySeat || {};

  // sempre limpa seleção
  state.selectedCards = [];

  // lixo / mesa / deck
  state.lixo = pub.discardTop ? [pub.discardTop] : [];
  state.table = Array.isArray(pub.tableMelds)
    ? pub.tableMelds.map(m => ({ cards: m.cards || [] }))
    : [];
  state.deckCount = pub.deckCount ?? 0;


/*----------------------------*/
  state.roundAnnouncement = String(pub.roundAnnouncement || "");
  state.roundAnnouncementEndsAt = Number(pub.roundAnnouncementEndsAt) || 0;
  const nextRoundAnnouncement = String(pub.roundAnnouncement || "");
  const nextRoundAnnouncementEndsAt = Number(pub.roundAnnouncementEndsAt) || 0;

  const prevRoundAnnouncement = String(state._lastShownRoundAnnouncement || "");
  const now = Date.now();

  if (
    nextRoundAnnouncement &&
    nextRoundAnnouncement !== prevRoundAnnouncement &&
    nextRoundAnnouncementEndsAt > now
  ) {
    state._lastShownRoundAnnouncement = nextRoundAnnouncement;

    try {
      showMessage(nextRoundAnnouncement);
    } catch (err) {
      console.error("[ROUND ANNOUNCEMENT] erro ao mostrar mensagem", err);
    }
  }

  if (!nextRoundAnnouncement) {
    state._lastShownRoundAnnouncement = "";
  }


/*--------------------------*/




  // players
  const players = [];
  (pub.seats || []).forEach((p, idx) => {
    if (!p) return;

    const oldPlayer = state.players?.find(x => x.seat === idx + 1);

    const buyInMesa = state.room?.buyIn ? state.room.buyIn : 0;
    const mesaStack = buyInMesa * 10;
    const mesaStackLiquido = mesaStack - buyInMesa;

    players.push({
      id: idx,
      seat: idx + 1,
      name: p.name || `Jogador ${idx + 1}`,
      avatarUrl: p.avatarUrl || null,
      chips: typeof p.chips === "number" ? p.chips : 0,
      tableChips: typeof p.tableChips === "number" ? p.tableChips : mesaStack,
      tableChips: typeof p.tableChips === "number" ? p.tableChips : mesaStackLiquido,

      hand: oldPlayer?.hand || [],

      jogosBaixados: [],
      totalPoints: typeof p.totalPoints === "number" ? p.totalPoints : 0,
      lastRoundPoints: typeof p.lastRoundPoints === "number" ? p.lastRoundPoints : 0,
      eliminated: !!p.eliminated,

      rebuyCount: typeof p.rebuyCount === "number" ? p.rebuyCount : 0,
      pendingRebuy: !!p.pendingRebuy,
      rebuyDeclined: !!p.rebuyDeclined,
    });
  });

  state.players = players;
  state.rebuyDecisionUntil = pub.rebuyDecisionUntil || 0;

  // fim de partida vindo do servidor autoritativo
  state.matchEnded = !!pub.matchEnded;
  state.matchWinnerSeat = pub.matchWinnerSeat ?? null;

  state.matchPot = Number(pub.matchPot) || 0;
  state.pot = state.matchPot;
  state.houseRakePct = Number(pub.houseRakePct) || 0;
  state.houseRake = Number(pub.houseRake) || 0;
  state.winnerPayout = Number(pub.winnerPayout) || 0;
  state.roundNumber = Number(pub.roundNumber) || 0;

  // 🔥 sincroniza snapshot das mesas para a tela do lobby
if (state.room?.id) {
  window.state = window.state || {};
  window.state.tables = window.state.tables || {};

  const prev = window.state.tables[state.room.id] || {};
  const prevSeats = Array.isArray(prev.seats) ? prev.seats : [null, null, null, null, null, null];

  const mergedSeats = Array.isArray(pub.seats)
    ? pub.seats.map((seat, idx) => {
        if (!seat) return null;

        const oldSeat = prevSeats[idx] || null;

        return {
          ...oldSeat,
          ...seat,
          avatarUrl: seat.avatarUrl || oldSeat?.avatarUrl || null
        };
      })
    : prevSeats;

  window.state.tables[state.room.id] = {
  ...prev,
  id: prev.id || state.room.id,
  name: prev.name,
  buyIn: prev.buyIn,
  started: pub.started ?? prev.started ?? false,
  currentSeat: pub.currentSeat ?? prev.currentSeat ?? 1,
  phase: pub.phase ?? prev.phase ?? "WAITING",
  seats: mergedSeats,
  seatedCount: Array.isArray(pub.seats)
    ? pub.seats.filter(Boolean).length
    : (prev.seatedCount || 0),
  maxSeats: prev.maxSeats || 6,
  minPlayersToStart: pub.minPlayersToStart ?? prev.minPlayersToStart ?? 2,
  startAt: Number(pub.startAt) || 0,
  tableMelds: Array.isArray(pub.tableMelds) ? pub.tableMelds : (prev.tableMelds || []),
  discardTop: pub.discardTop ?? prev.discardTop ?? null,
  deckCount: pub.deckCount ?? prev.deckCount ?? 0,
  matchPot: Number(pub.matchPot) || 0,
  roundNumber: Number(pub.roundNumber) || 0
};
/*
  console.log("[WS] lobby sync table", state.room.id, window.state.tables[state.room.id]);
*/
  // redesenha as mesas imediatamente
  if (typeof renderTablesScreen === "function") {
    renderTablesScreen();
  }
}
    // define currentPlayer para render
  if (!state.spectator && state.mySeat != null) {
    const myIdx = state.players.findIndex(p => p.seat === state.mySeat);
    state.currentPlayer = (myIdx >= 0) ? myIdx : 0;
  } else if (state.currentSeat != null) {
    const turnIdx = state.players.findIndex(p => p.seat === state.currentSeat);
    state.currentPlayer = (turnIdx >= 0) ? turnIdx : 0;
  } else {
    state.currentPlayer = 0;
  }


     // detectar animação mão -> mesa
  if (!state.spectator && state.mySeat != null) {
    // baixar novo jogo
    if (state.pendingPlayToTable?.cardIds?.length) {
      state.pendingHandToTableAnim = {
        cardIds: [...state.pendingPlayToTable.cardIds],
        cardSnapshots: Array.isArray(state.pendingPlayToTable.cardSnapshots)
          ? state.pendingPlayToTable.cardSnapshots
          : [],
        targetMeldIndex: Array.isArray(state.table) && state.table.length
          ? state.table.length - 1
          : null,
        requestedAt: Date.now()
      };

      state.pendingPlayToTable = null;
    }

    // adicionar em jogo da mesa
    if (state.pendingAddToTable?.cardIds?.length) {
      state.pendingHandToTableAnim = {
        cardIds: [...state.pendingAddToTable.cardIds],
        cardSnapshots: Array.isArray(state.pendingAddToTable.cardSnapshots)
          ? state.pendingAddToTable.cardSnapshots
          : [],
        targetMeldIndex: Number.isInteger(state.pendingAddToTable.meldIndex)
          ? state.pendingAddToTable.meldIndex
          : null,
        requestedAt: Date.now()
      };

      state.pendingAddToTable = null;
    }
  }

  // ✅ só entra no jogo quando a mesa começou E não está em matchEnded
  if (pub.started && !pub.matchEnded) {
    showScreen("game");
    renderAll();
    playPendingHandToTableAnimation?.();

  // se ainda não começou, permanece na tela das mesas
  } else {
    const tables = document.getElementById("tablesScreen");
    if (tables && tables.style.display !== "none") {
      renderTablesScreen();
    }
  }

  return;
}

// 4) state_private
  if (msg.type === "state_private") {
  const { seat, hand } = msg.payload || {};
  state.canRematch = !!msg.payload.canRematch;

  const fixedHand = Array.isArray(hand)
    ? hand.map(c => (c && typeof c === "object" ? { ...c } : c))
    : [];

  const idx = state.players.findIndex(p => p.seat === seat);
  const oldHand = idx >= 0 && Array.isArray(state.players[idx]?.hand)
    ? state.players[idx].hand.map(c => ({ ...c }))
    : [];

  if (idx >= 0) {
    state.players[idx].hand = applyHandPresentationOrder(fixedHand);
  }

  // detecta compra do monte confirmada pelo servidor
  if (
    !state.spectator &&
    state.mySeat === seat &&
    state.pendingDrawFromDeck &&
    idx >= 0
  ) {
    const beforeIds = new Set(
      Array.isArray(state.pendingDrawFromDeck.handBeforeIds)
        ? state.pendingDrawFromDeck.handBeforeIds.map(String)
        : oldHand.map(c => String(c.id))
    );

    const newCard = state.players[idx].hand.find(c => !beforeIds.has(String(c.id)));

    if (newCard) {
      state.pendingDeckToHandAnim = {
        cardId: String(newCard.id),
        requestedAt: Date.now()
      };
    }

    state.pendingDrawFromDeck = null;
  }

    // detecta compra do lixo confirmada pelo servidor
  if (
    !state.spectator &&
    state.mySeat === seat &&
    state.pendingDrawFromDiscard &&
    idx >= 0
  ) {
    const beforeIds = new Set(
      Array.isArray(state.pendingDrawFromDiscard.handBeforeIds)
        ? state.pendingDrawFromDiscard.handBeforeIds.map(String)
        : oldHand.map(c => String(c.id))
    );

    const newCard = state.players[idx].hand.find(c => !beforeIds.has(String(c.id)));

    if (newCard) {
      state.pendingDiscardToHandAnim = {
        cardId: String(newCard.id),
        requestedAt: Date.now()
      };
    }

    state.pendingDrawFromDiscard = null;
  }


  // garante que jogador vê a própria mão
  if (!state.spectator && state.mySeat != null) {
    const myIdx = state.players.findIndex(p => p.seat === state.mySeat);
    if (myIdx >= 0) state.currentPlayer = myIdx;
  }

  state.selectedCards = [];

  renderAll();
  playPendingDrawAnimation?.();
  playPendingDiscardDrawAnimation?.();
  return;
  }

//5) Error
if (msg.type === "error") {
  console.log("[WS ERROR FULL]", msg);

  const serverMsg =
    msg?.payload?.message ??
    msg?.message ??
    "Erro no servidor.";

  // limpa pendências visuais de ação rejeitada
  state.pendingPlayToTable = null;
  state.pendingAddToTable = null;
  state.pendingHandToTableAnim = null;

  // feedback visual da jogada inválida
  try {
    const selectedIds = Array.isArray(state.selectedCards)
      ? [...state.selectedCards]
      : [];

    window.flashInvalidPlay?.(selectedIds);
  } catch {}

  showGameNotice(serverMsg, "warn");
  return;
}

  });

}






// Envia ação para o servidor (todas as jogadas passam por aqui)*/

export function wsSendAction(action) {
  if (!socket || socket.readyState !== 1) return false;
  if (!state.room?.id) return false;

  const actionWithSeq = {
    ...(action || {}),
    seq: nextActionSeq++
  };

  console.log("[WS] -> action", actionWithSeq);

  socket.send(JSON.stringify({
    type: "action",
    payload: { tableId: state.room.id, action: actionWithSeq }
  }));

  return true;
}

window.wsSendAction = wsSendAction;

// =============================
// RENDER GERAL
// =============================
export function renderAll() {
  
  renderPlayerInfo();
  renderHand();
  renderTable();
  renderMonte();
  renderLixo();
  renderPot();
  renderScoreboard();
  updateSpectatorUI();
  renderNextPlayerButton();
  

  const gameEl = document.getElementById("game");
  const gameVisible = !!gameEl && gameEl.style.display !== "none";
  const hasAnyHand =
    Array.isArray(state.players) &&
    state.players.some(p => Array.isArray(p?.hand) && p.hand.length > 0);

  // só inicia timer quando a partida começou de verdade
    if (
    state.started &&
    gameVisible &&
    hasAnyHand &&
    !state.matchEnded &&
    state.faseTurno !== "DEALING"
  ) {
    startTurnTimer();
  } else {
    stopTurnTimer();
  }

  renderEndMatchOverlay();

  if (state.matchEnded) {
    document.getElementById("rebuyOverlay")?.remove();
    document.getElementById("rebuy-box")?.remove();
    return;
  }

  renderRoundInfo();
  renderDealOverlay?.();
  renderRebuyOverlay();
}

window.renderAll = renderAll;


function formatBR(n) {
  return Number(n).toLocaleString("pt-BR");
}


let rebuyUiTimer = null;


function getMyPlayer() {
  if (!Array.isArray(state.players) || state.mySeat == null) return null;
  return state.players.find(p => p && p.seat === state.mySeat) || null;
}

function stopRebuyUiTimer() {
  if (rebuyUiTimer) {
    clearTimeout(rebuyUiTimer);
    rebuyUiTimer = null;
  }
}

/* revanche*/

// =============================
// FIM DE PARTIDA: REVANCHE / VOLTAR ÀS MESAS
// =============================
function stopTurnTimer() {
  try {
    if (state.turnTimerId) clearInterval(state.turnTimerId);
  } catch {}
  state.turnTimerId = null;
  state.turnOwnerId = null;
  state.turnSecondsLeft = 0;
  state.turnTimerToken = (Number(state.turnTimerToken) || 0) + 1;
}

function resetMatchState({ keepPlayers = true } = {}) {
  // ✅ flags de fim de partida
  state.partidaEncerrada = false;
  state.matchFinalized = false;
  state.vencedor = null;

  // ✅ MUITO IMPORTANTE: destrava o guardião
  state.rodadaEncerrada = false;
  state.pontuacaoAplicadaNaRodada = false;

  // ✅ destravas gerais do turno
  state.jaComprouNoTurno = false;
  state.turnoTravado = false;
  state.faseTurno = "COMPRAR";

  // resultados/contabilidade do fim
  state.houseTake = 0;
  state.winnerPayout = 0;
  state.winnerNet = 0;

  // estado de turno/rodada
  state.currentPlayer = 0;
  state.selectedCards = [];
  state.origemCompra = null;

  // limpa outros estados de ação (segurança)
  state.cartaDoLixo = null;
  state.baixouComLixo = false;
  state.obrigacaoBaixar = false;

  // mesa
  state.table = [];
  state.lixo = [];
  state.deck = [];

  // pote
  state.pot = 0;
  state.matchPot = 0; // pote único (ante + rebuys)

  // rebuy
  state.rebuyDecisionUntil = 0;

  // coringa/obrigações
  state.mustUseJokerId = null;
  state.pendingJokerSwap = null;

  if (!keepPlayers) {
    state.players = [];
  } else {
    for (const p of state.players || []) {
      p.eliminated = false;
      p.hand = [];
      p.totalPoints = 0;
      p.roundPoints = [];
      p.pendingRebuy = false;
      p.rebuyDeclined = false;
      p.rebuyCount = 0;
      p.jogosBaixados = [];
    }
  }
}
// ✅ Revanche: permanece na mesma mesa (novo torneio, cobra buy-in de novo)
window.rematchSameTable = function rematchSameTable() {
  stopTurnTimer();

  document.getElementById("endMatchOverlay")?.remove();
  document.getElementById("rebuyOverlay")?.remove();
  document.getElementById("rebuy-box")?.remove();

  // limpa flags locais antigas enquanto espera o estado novo do servidor
  state.partidaEncerrada = false;
  state.matchFinalized = false;
  state.rodadaEncerrada = false;
  state.pontuacaoAplicadaNaRodada = false;
  state.turnoTravado = false;
  state.jaComprouNoTurno = false;
  state.faseTurno = "WAITING";

  state.roundEnded = false;
  state.winnerSeat = null;
  state.rebuyDecisionUntil = 0;

  state.selectedCards = [];
  state.origemCompra = null;
  state.cartaDoLixo = null;
  state.baixouComLixo = false;
  state.obrigacaoBaixar = false;

  if (!socket || socket.readyState !== 1 || !state.room?.id) {
  window.showGameNotice("Não foi possível iniciar a revanche.", "warn");
    return;
  }

  socket.send(JSON.stringify({
    type: "rematch",
    payload: { tableId: state.room.id }
  }));

  renderAll();
};

window.declineRematchSameTable = function declineRematchSameTable() {
  if (!socket || socket.readyState !== 1 || !state.room?.id) {
    window.showGameNotice("Não foi possível responder à revanche.", "warn");
    return;
  }

  socket.send(JSON.stringify({
    type: "rematch",
    payload: {
      tableId: state.room.id,
      accept: false
    }
  }));
};

function updateLobbyCountdowns() {
  document.querySelectorAll(".table-start-wrap[data-start-at]").forEach((wrap) => {
    const startAt = Number(wrap.dataset.startAt) || 0;
    const label = wrap.querySelector(".table-start-label");
    const fill = wrap.querySelector(".table-start-bar-fill");
if (!startAt || !fill) return;

const totalMs = 30000; // 30 segundos

const leftMs = Math.max(0, startAt - Date.now());
const pct = Math.max(0, Math.min(100, (leftMs / totalMs) * 100));

if (leftMs <= 0) {
  wrap.style.display = "none";
  return;
}

wrap.style.display = "";
fill.style.width = `${pct}%`;
  });
}

setInterval(updateLobbyCountdowns, 200);


function focusTable(tableId) {
  const card = document.querySelector(`.table-card[data-table-id="${tableId}"]`);
  if (!card) return;

  card.scrollIntoView({ behavior: "smooth", block: "center" });

  // destaque rápido (se quiser)
  card.classList.add("focus");
  setTimeout(() => card.classList.remove("focus"), 1200);
}

function openTablesAndFocus(tableId) {
  // use o mesmo identificador que seu showScreen espera:
  // no seu arquivo original é "tables"
  showScreen("tables");

  // dá um tempinho pro layout estabilizar e então foca
  setTimeout(() => focusTable(tableId), 80);
}



// =============================
// INICIAR JOGO
// =============================
function bindGameControls() {
  // ✅ Botão Próximo Jogador
  const btnNext = document.getElementById("nextPlayer");
  if (btnNext) {
    btnNext.onclick = async () => {
      await nextPlayer();
      renderAll();          // renderAll já chama startTurnTimer(30)
    };
  }

  // (opcional) destravar áudio no primeiro toque/clique
  document.addEventListener("pointerdown", () => {
  unlockAudio();
  window.unlockAudioOnce?.();
  }, { once: true });


///Começa aqui///
 document.getElementById("startGame").onclick = async () => {
  unlockAudio();
  window.unlockAudioOnce?.();

  const qtd = Number(document.getElementById("playerCount").value);

  // 1) jogadores
  initPlayers(qtd);

  // nome do humano
  const nome = document.getElementById("player-name")?.value?.trim();
  if (nome) state.players[0].name = nome;

  // garante buy-in/mesa
  const buyIn = typeof state.room?.buyIn === "number" ? state.room.buyIn : 1000;
  state.room = { ...(state.room || {}), buyIn };

  // saldo inicial
  const CHIPS_INICIAIS = Math.max(200000, buyIn * 10);
  for (const p of state.players) {
    p.eliminated = false;
    p.hand = [];
    p.jogosBaixados = p.jogosBaixados || [];
    p.jogosBaixados.length = 0;

    if (typeof p.chips !== "number" || p.chips <= 0) p.chips = CHIPS_INICIAIS;
    p.chips = Math.max(0, p.chips - buyIn);
  }

  // jogador inicial + fase inicial
  state.currentPlayer = 0;
  state.faseTurno = "COMPRAR";
  state.selectedCards = [];

  // ✅ MOSTRA O JOGO AGORA (mata a tela vazia)
  showScreen("game");
  renderAll();
  bindTableUI();

  // pote/ante
  state.matchPot = 0;
  collectAnte();

  // deck novo sempre
  initDeck();
  shuffleDeck();

  // agora a animação acontece com a UI já visível
  await dealInitialCardsAnimated(9);

  // ✅ garante render final
  renderAll();
};


}

// ✅ Voltar às mesas: sai da partida e volta pra lista de mesas
window.backToTables = function backToTables() {
  stopTurnTimer();

  // remove overlays visuais, se existirem
  document.getElementById("endMatchOverlay")?.remove();
  document.getElementById("rebuyOverlay")?.remove();

  const tableId = state.room?.id;

  // ✅ avisa o servidor que saiu da mesa
  if (socket && socket.readyState === 1 && tableId) {
    socket.send(JSON.stringify({
      type: "leaveTable",
      payload: { tableId }
    }));
  }

  // limpa estado local
  state.room = null;
  state.selectedSeat = null;
  state.mySeat = null;
  state.spectator = false;

  // reseta o estado do match/jogo
  resetMatchState({ keepPlayers: false });

  const tables = document.getElementById("tablesScreen");
  const lobby = document.getElementById("lobby");
  const game = document.getElementById("game");

  if (tables) tables.style.display = "block";
  if (lobby) lobby.style.display = "none";
  if (game) game.style.display = "none";

  try { renderTablesScreen(); } catch {}
  updateSpectatorUI();

  window.scrollTo?.(0, 0);
};


let uiNoticeTimer = null;
let lastNoticeText = "";
let lastNoticeAt = 0;

window.showGameNotice = function showGameNotice(message, type = "warn") {
  if (!message) return;

  const text = String(message).trim();
  const now = Date.now();

  // evita spam da mesma mensagem em sequência muito curta
  if (text === lastNoticeText && (now - lastNoticeAt) < 900) {
    return;
  }

  lastNoticeText = text;
  lastNoticeAt = now;

  let el = document.getElementById("gameNotice");
  if (!el) {
    el = document.createElement("div");
    el.id = "gameNotice";
    document.body.appendChild(el);
  }

  el.textContent = text;
  el.className = `game-notice show ${type}`;

  clearTimeout(uiNoticeTimer);
  uiNoticeTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2200);
};

window.alert = function (message) {
  window.showGameNotice?.(message || "Aviso.", "warn");
};

function updateSpectatorUI() {
  const isSpectator = !!state.spectator;

  // scoreboard
  const scoreboard = document.getElementById("scoreboard");
  if (scoreboard) {
    scoreboard.style.display = isSpectator ? "none" : "";
  }

  // botão para sair do modo espectador
  let exitBtn = document.getElementById("btnExitSpectatorMode");

  if (isSpectator) {
    if (!exitBtn) {
      exitBtn = document.createElement("button");
      exitBtn.id = "btnExitSpectatorMode";
      exitBtn.textContent = "Sair";
      exitBtn.style.position = "absolute";
      exitBtn.style.top = "14px";
      exitBtn.style.left = "14px";
      exitBtn.style.zIndex = "9999";
      exitBtn.style.padding = "8px 12px";
      exitBtn.style.borderRadius = "10px";
      exitBtn.style.border = "1px solid rgba(255,255,255,0.25)";
      exitBtn.style.background = "rgba(0,0,0,0.45)";
      exitBtn.style.color = "#fff";
      exitBtn.style.cursor = "pointer";
      exitBtn.onclick = () => window.backToTables?.();

      document.getElementById("game")?.appendChild(exitBtn);
    }

    exitBtn.style.display = "";
  } else if (exitBtn) {
    exitBtn.style.display = "none";
  }

  // esconder botões de ordenar por valor / naipe
  document.querySelectorAll('button[onclick*="setHandSort"]').forEach(btn => {
    btn.style.display = isSpectator ? "none" : "";
  });
}

function enforceForcedPasswordChange() {
  try {
    const raw = localStorage.getItem("pontinhoAuthUser");
    if (!raw) return false;

    const user = JSON.parse(raw);

    if (user?.must_reset_password === true || user?.must_reset_password === 1) {
      window.location.href = "./change-password.html";
      return true;
    }

    return false;
  } catch (err) {
    console.error("Erro ao validar troca obrigatória de senha:", err);
    return false;
  }
}


function clearAuthUserAndRedirect(message = "Sua sessão expirou. Faça login novamente.") {
  try {
    localStorage.removeItem("pontinhoAuthUser");
    localStorage.removeItem("pontinhoPlayerName");
    localStorage.removeItem("pontinhoAvatarUrl");
  } catch (err) {
    console.error("Erro ao limpar sessão local:", err);
  }

  alert(message);
  window.location.href = "./login.html";
}

async function validateCurrentSession() {
  try {
    if (window.location.hostname !== "localhost") {
      return true;
    }

    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      localStorage.removeItem("pontinhoAuthUser");
      return false;
    }

    return true;
  } catch (err) {
    console.warn("Erro ao validar sessão atual:", err);
    return true; // 🔥 IMPORTANTE
  }
}




(async function bootstrapApp() {
  if (enforceForcedPasswordChange()) return;

  const raw = localStorage.getItem("pontinhoAuthUser");
  if (raw) {
    const ok = await validateCurrentSession();
    if (!ok) return;
  }

  connectWS();
  renderTablesScreen();
  renderHomeLiveTables();
  bindHomeLiveTables();
  showScreen("home");

  setTimeout(() => {
    if (typeof ensureHomeStatusFeed === "function") {
      ensureHomeStatusFeed();
    }
  }, 100);
  })();


// ===== BOTÕES DA HOME =====
function openTablesFromHome(variant) {
  state.selectedVariant = variant;
  renderTablesScreen();

  document.getElementById("homeScreen").style.display = "none";
  document.getElementById("game").style.display = "none";
  document.getElementById("tablesScreen").style.display = "";
}

function bindHomeButtons() {
  const btnLogin = document.getElementById("btnLogin");
  if (btnLogin) {
    btnLogin.onclick = () => {
      window.location.href = "./login.html";
    };
  }

  const btnSignup = document.getElementById("btnSignup");
  if (btnSignup) {
    btnSignup.onclick = () => {
      window.location.href = "./signup.html";
    };
  }

  const btnProfile = document.getElementById("btnTrain");
  if (btnProfile) {
    btnProfile.onclick = () => {
      window.location.href = "./profile.html";
    };
  }

  const btnSettings = document.getElementById("btnSettings");
  if (btnSettings) {
    btnSettings.onclick = () => {
      window.location.href = "./settings.html";
    };
  }

  const btnClassic = document.getElementById("btnClassic");
  if (btnClassic) {
    btnClassic.onclick = () => {
      openTablesFromHome("CLASSIC");
    };
  }

  const btnCrazy = document.getElementById("btnCrazy");
  if (btnCrazy) {
    btnCrazy.onclick = () => {
      openTablesFromHome("CRAZY");
    };
  }

  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) {
    btnLogout.onclick = async () => {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          credentials: "include",
        });
      } catch (err) {
        console.error("Erro no logout:", err);
      }

      localStorage.removeItem("pontinhoAuthUser");
      localStorage.removeItem("pontinhoPlayerName");
      localStorage.removeItem("pontinhoAvatarUrl");

      window.location.href = "./index.html";
    };
  }
}

function renderHomeLiveTables() {
  const el = document.getElementById("homeLiveTables");
  if (!el) return;

  /*const tables = Object.values(state.tables || {}).slice(0, 3);*/
  // Mudar para mesas reais

//delete esse bloco depois
  let tables = Object.values(state.tables || {}).slice(0, 3);

  if (!tables.length) {
    tables = [
      { name: "Mesa 1", seatedCount: 2, maxSeats: 6, stake: 1000, variant: "CLASSIC" },
      { name: "Mesa 2", seatedCount: 3, maxSeats: 6, stake: 5000, variant: "CLASSIC" },
      { name: "Mesa 3", seatedCount: 1, maxSeats: 6, stake: 10000, variant: "CRAZY" }
    ];
  }
  //até aqui
  

  if (!tables.length) {
    el.innerHTML = `
      <div class="home-live-empty">
        Nenhuma mesa aberta no momento.
      </div>
    `;
    return;
  }

  el.innerHTML = tables.map((t, index) => {
    const seated = Number(t.seatedCount ?? t.playersCount ?? 0);
    const max = Number(t.maxSeats ?? 6);
    const stake = Number(
      t.stake ??
      t.mesaValor ??
      t.tableValue ??
      ((Number(t.buyIn) || 100) * 10)
    );

    const variant = String(t.variant || "CLASSIC").toUpperCase();
    const tableName = t.name || `Mesa ${index + 1}`;

    const seatsHtml = Array.from({ length: 6 }).map((_, i) => {
      const seatNum = i + 1;
      const occupied = seatNum <= seated;

      return `
        <div class="home-live-seat home-live-seat-${seatNum} ${occupied ? "occupied" : ""}">
          ${occupied ? `<img src="/assets/avatars/avatar-01.png" alt="Jogador">` : ""}
        </div>
      `;
    }).join("");

    return `
      <div class="home-live-card-visual" data-variant="${variant}">
        <div class="home-live-count">👥 ${seated}/${max}</div>

        <div class="home-live-table-visual">
          <div class="home-live-table-felt"></div>
          ${seatsHtml}
        </div>

        <div class="home-live-name">${tableName}</div>
        <div class="home-live-stake">
          Aposta: <strong>${stake.toLocaleString("pt-BR")}</strong>
        </div>

        <button type="button" class="home-live-enter">Entrar</button>
      </div>
    `;
  }).join("");
}

function bindHomeLiveTables() {
  const el = document.getElementById("homeLiveTables");
  if (!el) return;

  el.onclick = (ev) => {
    const btn = ev.target.closest(".home-live-enter");
    if (!btn) return;

    const card = btn.closest(".home-live-card-visual");
    const variant = card?.dataset?.variant || "CLASSIC";

    state.selectedVariant = variant;
    renderTablesScreen();
    showScreen("tables");
  };
}

async function refreshHomeUser() {
  const homeUserName = document.getElementById("homeUserName");
  const homeUserBalance = document.getElementById("homeUserBalance");
  const homeUserAvatar = document.getElementById("homeUserAvatar");

  const btnLogin = document.getElementById("btnLogin");
  const btnSignup = document.getElementById("btnSignup");
  const btnLogout = document.getElementById("btnLogout");
  const btnSettings = document.getElementById("btnSettings");
  const btnProfile = document.getElementById("btnTrain");
  const btnClassic = document.getElementById("btnClassic");
  const btnCrazy = document.getElementById("btnCrazy");

  function setLoggedOutHome() {
    if (homeUserName) homeUserName.textContent = "Visitante";
    if (homeUserBalance) homeUserBalance.textContent = "Saldo: —";
    if (homeUserAvatar) homeUserAvatar.src = "/assets/avatars/avatar-01.png";

    if (btnLogin) btnLogin.style.display = "";
    if (btnSignup) btnSignup.style.display = "";

    if (btnLogout) btnLogout.style.display = "none";
    if (btnSettings) btnSettings.style.display = "none";
    if (btnProfile) btnProfile.style.display = "none";
    if (btnClassic) btnClassic.style.display = "none";
    if (btnCrazy) btnCrazy.style.display = "none";
  }

  function setLoggedInHome(user) {
    if (homeUserName) homeUserName.textContent = user.username || "Usuário";
    if (homeUserBalance) {
      homeUserBalance.textContent = `Saldo: ${(Number(user.chipsBalance) || 0).toLocaleString("pt-BR")}`;
    }
    if (homeUserAvatar) {
      homeUserAvatar.src = user.avatarUrl || "/assets/avatars/avatar-01.png";
    }

    if (btnLogin) btnLogin.style.display = "none";
    if (btnSignup) btnSignup.style.display = "none";

    if (btnLogout) btnLogout.style.display = "";
    if (btnSettings) btnSettings.style.display = "";
    if (btnProfile) btnProfile.style.display = "";
    if (btnClassic) btnClassic.style.display = "";
    if (btnCrazy) btnCrazy.style.display = "";
  }

  try {
    const localUser = JSON.parse(localStorage.getItem("pontinhoAuthUser") || "null");
    if (localUser) {
      setLoggedInHome(localUser);
    } else {
      setLoggedOutHome();
    }
  } catch (err) {
    console.error("Erro lendo usuário local:", err);
    setLoggedOutHome();
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      localStorage.removeItem("pontinhoAuthUser");
      localStorage.removeItem("pontinhoPlayerName");
      localStorage.removeItem("pontinhoAvatarUrl");
      setLoggedOutHome();
      return;
    }

    const user = data.user;

    localStorage.setItem("pontinhoAuthUser", JSON.stringify(user));
    localStorage.setItem("pontinhoPlayerName", user.username || "Visitante");

    if (user.avatarUrl) {
      localStorage.setItem("pontinhoAvatarUrl", user.avatarUrl);
    } else {
      localStorage.removeItem("pontinhoAvatarUrl");
    }

    setLoggedInHome(user);
  } catch (err) {
    console.error("Erro ao carregar usuário da home:", err);
  }
}

bindGameControls();
bindHomeButtons();
refreshHomeUser();





function getCardValueForSort(card) {
  const order = {
    "A": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    "J": 11,
    "Q": 12,
    "K": 13
  };

  return order[card?.valor] || 0;
}

function applyHandPresentationOrder(hand) {
  if (!Array.isArray(hand)) return hand;

  // 1) ordenação manual tem prioridade quando handSort está desligado
  if (!state.handSort && Array.isArray(state.manualHandOrder) && state.manualHandOrder.length) {
    const byId = new Map(hand.map(card => [String(card.id), card]));
    const ordered = state.manualHandOrder.map(id => byId.get(String(id))).filter(Boolean);
    const rest = hand.filter(card => !state.manualHandOrder.includes(String(card.id)));
    return [...ordered, ...rest];
  }

  // 2) ordenação por valor
  if (state.handSort === "value") {
    return [...hand].sort((a, b) => getCardValueForSort(a) - getCardValueForSort(b));
  }

  // 3) ordenação por naipe
  if (state.handSort === "suit") {
    const suitOrder = {
      "paus": 0,
      "copas": 1,
      "espadas": 2,
      "ouros": 3,
      "♣": 0,
      "♥": 1,
      "♠": 2,
      "♦": 3
    };

    return [...hand].sort((a, b) => {
      const sa = suitOrder[a?.naipe] ?? 99;
      const sb = suitOrder[b?.naipe] ?? 99;
      if (sa !== sb) return sa - sb;
      return getCardValueForSort(a) - getCardValueForSort(b);
    });
  }

  return hand;
}

window.setHandSort = function(type) {
  const player = state.players?.[state.currentPlayer];
  if (!player || !Array.isArray(player.hand)) return;

  // antes de ordenar, salva a ordem atual como "manual"
  state.manualHandOrder = player.hand.map(card => String(card.id));
  state.handSort = type;

  if (type === "value") {
    player.hand.sort((a, b) => getCardValueForSort(a) - getCardValueForSort(b));
  }

  if (type === "suit") {
    player.hand.sort((a, b) => {
      const suitOrder = {
        "paus": 0,
        "copas": 1,
        "espadas": 2,
        "ouros": 3,
        "♣": 0,
        "♥": 1,
        "♠": 2,
        "♦": 3
      };

      const sa = suitOrder[a?.naipe] ?? 99;
      const sb = suitOrder[b?.naipe] ?? 99;

      if (sa !== sb) return sa - sb;
      return getCardValueForSort(a) - getCardValueForSort(b);
    });
  }

  renderAll();
};


function getLoggedPlayerName() {
  try {
    const authUser = JSON.parse(localStorage.getItem("pontinhoAuthUser") || "null");
    const localName = localStorage.getItem("pontinhoPlayerName") || "";

    const nome =
      authUser?.username?.trim() ||
      localName.trim() ||
      "Visitante";

    return nome;
  } catch (err) {
    console.error("Erro ao obter nome do jogador logado:", err);
    return localStorage.getItem("pontinhoPlayerName")?.trim() || "Visitante";
  }
}



export function renderTablesScreen() {
  const tablesScreenEl = document.getElementById("tablesScreen");
  if (tablesScreenEl) {
    const isCrazyMode = String(state.selectedVariant || "CLASSIC").toUpperCase() === "CRAZY";
    tablesScreenEl.classList.toggle("tables-crazy-mode", isCrazyMode);
  }

  let controls = document.getElementById("tablesVariantSwitch");


  const grid = document.getElementById("tablesGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (controls) {
    const isCrazyMode = String(state.selectedVariant || "CLASSIC").toUpperCase() === "CRAZY";

    controls.innerHTML = `
      <div class="tables-header">
        <button
          id="btnBackHomeFromTables"
          class="tables-back-btn"
          type="button"
        >
          ← Voltar
        </button>
      </div>

      <div class="tables-tabs-wrapper">
        <div class="tables-tabs">
          <button
            id="btnTabClassic"
            class="tables-tab ${!isCrazyMode ? "active" : ""}"
            type="button"
          >
            Pontinho Clássico
          </button>

          <button
            id="btnTabCrazy"
            class="tables-tab ${isCrazyMode ? "active" : ""}"
            type="button"
          >
            Pontinho Crazy
          </button>
        </div>
      </div>
    `;
    const btnBackHomeFromTables = document.getElementById("btnBackHomeFromTables");
    if (btnBackHomeFromTables) {
      btnBackHomeFromTables.onclick = () => {
        showScreen("home");
      };
    }
    const btnTabClassic = document.getElementById("btnTabClassic");
    const btnTabCrazy = document.getElementById("btnTabCrazy");

    if (btnTabClassic) {
      btnTabClassic.onclick = () => {
        state.selectedVariant = "CLASSIC";
        renderTablesScreen();
      };
    }

    if (btnTabCrazy) {
      btnTabCrazy.onclick = () => {
        state.selectedVariant = "CRAZY";
        renderTablesScreen();
      };
    }
  }

  let selected = { tableId: null, seat: null };
  const positions = ["pos1", "pos2", "pos3", "pos4", "pos5", "pos6"];

  const tables = Array.isArray(state.tableList) ? state.tableList : [];

  const selectedVariant = String(state.selectedVariant || "CLASSIC").toUpperCase();

  const visibleTables = (tables || []).filter(t => {
  const liveTable = window.state?.tables?.[t.id];
  const variant =
    String(
      t.variant ||
      liveTable?.variant ||
      (String(t.id || "").toUpperCase().startsWith("C") ? "CRAZY" : "CLASSIC")
    ).toUpperCase();

  return variant === selectedVariant;
  });

  visibleTables.forEach((t) => {
    const card = document.createElement("div");
    card.className = "table-card";
    card.dataset.tableId = t.id;

    const liveTable = window.state?.tables?.[t.id] || {};

    const seatedCount = Array.isArray(liveTable.seats)
      ? liveTable.seats.filter(Boolean).length
      : 0;

    const maxSeats = Number(liveTable.maxSeats) || 6;
    const minPlayersToStart = Number(liveTable.minPlayersToStart) || 2;
    const startAt = Number(liveTable.startAt) || 0;

 let countdownHtml = "";

  const shouldShowTimer =
  liveTable.started !== true &&
  seatedCount >= minPlayersToStart &&
  Number(startAt) > 0;

  if (shouldShowTimer) {
  const leftMs = Math.max(0, Math.min(30000, startAt - Date.now()));

  countdownHtml = `
    <div class="table-start-wrap" data-start-at="${startAt}">
      <div class="table-start-bar">
        <div
          class="table-start-bar-fill"
          style="animation: tableStartShrink ${leftMs}ms linear forwards;"
        ></div>
      </div>
    </div>
  `;
}

  if (t.id === "S1") {
  console.log("[COUNTDOWN CHECK]", {
    tableId: t.id,
    started: liveTable.started,
    seatedCount,
    minPlayersToStart,
    startAt,
    shouldShowTimer,
    countdownHtml
  });
  }

    const isCrazyMode = String(state.selectedVariant || "CLASSIC").toUpperCase() === "CRAZY";
    const tableTitle = isCrazyMode ? `${t.name} 🔥 Crazy` : t.name;



    card.innerHTML = `
      <div class="table-title">${tableTitle}</div>

      <div class="table-visual">
        <img src="./assets/image/mesa-pts.png" alt="${t.name}" onerror="this.style.display='none'">

        <div class="table-center-info">
          <div class="table-players-count">${seatedCount}/${maxSeats}</div>
          ${countdownHtml}
        </div>

        <div class="seats-overlay" data-table="${t.id}"></div>
      </div>

      <div class="table-value">Aposta: ${formatBR((Number(t.buyIn) || 0) * 10)}</div>
      <div class="table-hint">Clique em um assento vazio para entrar</div>

      <div class="table-actions">
        <button class="secondary" data-watch="${t.id}">Assistir</button>
      </div>
    `;



    const seatsEl = card.querySelector(".seats-overlay");

    for (let s = 1; s <= 6; s++) {
      const seatEl = document.createElement("div");
      seatEl.className = `seat ${positions[s - 1]}`;
      seatEl.dataset.seat = s;

      const player = liveTable.seats?.[s - 1] || null;

      if (player) {
        const inicial = (player.name?.[0] || "?").toUpperCase();
        const avatarUrl = player.avatarUrl || player.avatar || null;

        seatEl.innerHTML = avatarUrl
          ? `<img class="seat-avatar-img" src="${avatarUrl}" alt="${player.name || "Jogador"}">`
          : `<span class="seat-avatar-fallback">${inicial}</span>`;

        seatEl.classList.add("occupied");
        seatEl.title = player.name || `Jogador ${s}`;
      } else {
        seatEl.innerHTML = `<span class="seat-empty-number">${s}</span>`;
        seatEl.classList.add("empty");
        seatEl.title = `Assento ${s}`;
      }

  seatEl.onclick = () => {
  if (!socket || socket.readyState !== 1) {
    showGameNotice("WS ainda não conectou. Atualize a página.");
    return;
  }

  const nome = getLoggedPlayerName();
  const avatarUrl =
  localStorage.getItem("pontinhoAvatarUrl") ||  "/assets/avatars/avatar-01.png";
  const reconnectToken = localStorage.getItem(`buraco_reconnect_${t.id}_${s}`);

  // ✅ se eu já estou sentado nesse assento, saio dele
  if (state.room?.id === t.id && state.mySeat === s) {
    socket.send(JSON.stringify({
      type: "leaveTable",
      payload: { tableId: t.id }
    }));

    if (window.state?.tables?.[t.id]?.seats) {
      window.state.tables[t.id].seats[s - 1] = null;
    }

    state.mySeat = null;
    state.room = null;
    state.spectator = false;

    renderTablesScreen();
    return;
  }

  // ✅ se o assento está ocupado, só tenta reconectar se eu tiver token salvo dele
  if (player) {
    if (!reconnectToken) return;

    state.room = { id: t.id, buyIn: t.buyIn };

    socket.send(JSON.stringify({
      type: "joinTable",
      payload: {
        tableId: t.id,
        seat: s,
        mode: "player",
        name: nome,
        reconnectToken,
        avatarUrl
      }
    }));

    return;
  }

  // ✅ assento vazio: entra normalmente
  state.room = { id: t.id, buyIn: t.buyIn };

  socket.send(JSON.stringify({
    type: "joinTable",
    payload: {
      tableId: t.id,
      seat: s,
      mode: "player",
      name: nome,
      reconnectToken,
      avatarUrl
    }
  }));
  };

      seatsEl.appendChild(seatEl);
    }


  const playBtn = card.querySelector(`[data-play="${t.id}"]`);
  if (playBtn) {
  playBtn.onclick = () => {
    showGameNotice("Clique em um assento vazio para entrar na mesa.");
  };
  }

    card.querySelector(`[data-watch="${t.id}"]`).onclick = () => {
      if (!socket || socket.readyState !== 1) {
        showGameNotice("WS ainda não conectou. Atualize a página.");
        return;
      }

      const nome = getLoggedPlayerName();
      state.room = { id: t.id, buyIn: t.buyIn };

      socket.send(JSON.stringify({
        type: "joinTable",
        payload: { tableId: t.id, mode: "spectator", name: nome }
      }));
    };

    grid.appendChild(card);
  });

  updateLobbyCountdowns();
}

// deixa acessível para onclick no HTML (e evita o erro)
window.renderTablesScreen = renderTablesScreen;
/*window.TablesScreenrender = renderTablesScreen; // compatibilidade com o nome errado*/

