require("dotenv").config();

const jwt = require("jsonwebtoken");
const pool = require("./cachetao/server/config/db");

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");


function isJoker(card) {
  return card?.isJoker === true || card?.valor === "JOKER";
}

function getNaipe(card) {
  return card?.naipe ?? null; // "copas", "espadas", "ouros", "paus"
}

function getValor(card) {
  return card?.valor ?? null; // "A","2"...,"K" ou "JOKER"
}

function valorToNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;

  const t = v.toUpperCase();
  if (t === "A") return 1;
  if (t === "J") return 11;
  if (t === "Q") return 12;
  if (t === "K") return 13;

  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normalizeId(x) {
  return String(x);
}

function meldContainsCardId(meldCards, cardId) {
  const id = normalizeId(cardId);
  return (meldCards || []).some(c => normalizeId(c.id) === id);
}

function getCardPoints(card) {
  if (!card) return 0;

  if (isJoker(card)) return 20;

  const v = getValor(card);

  if (v === "A") return 15;
  if (v === "J" || v === "Q" || v === "K") return 10;

  const n = Number(v);
  if (Number.isFinite(n)) return n;

  return 0;
}

function getHandPoints(hand) {
  return (hand || []).reduce((sum, c) => sum + getCardPoints(c), 0);
}

function getAliveSeats(room) {
  const seats = [];
  for (let i = 0; i < (room.playersBySeat || []).length; i++) {
    const p = room.playersBySeat[i];
    if (p && !p.eliminated) seats.push(i + 1);
  }
  return seats;
}

function canFinishBatidaAfterUsingCards(room, player, idSet) {
  const remainingCards = (player.hand || []).filter(c => !idSet.has(String(c.id)));

  // mão zera ao baixar
  if (remainingCards.length === 0) {
    return true;
  }

  // pode sobrar exatamente 1 carta, desde que possa ser descartada
  if (remainingCards.length === 1) {
    const lastCard = remainingCards[0];

    if (!lastCard) return false;
    if (isJoker(lastCard)) return false;

    // jogador desconectado pode descartar para não travar o fluxo automático
    if (!player?.disconnected && canCardBeAddedToAnyMeld(room, lastCard)) {
      return false;
    }

    if (!player?.disconnected && canCardReplaceAnyJokerOnTable(room, lastCard)) {
      return false;
    }

    return true;
  }

  return false;
}

function getBuyIn(room) {
  return Math.floor((Number(room?.stake) || 0) * 0.10);
}

function getMiniAnte(room) {
  return Number(room?.miniAnte) || Math.floor((Number(room?.stake) || 0) * 0.05);
}

function getPointValue(room) {
  return Number(room?.pointValue) || 5;
}

function getHouseRakePct(room) {
  return Number(room?.houseRakePct) || 0.05;
}

function getHouseRake(room) {
  const pot = Number(room?.matchPot) || 0;
  const pct = getHouseRakePct(room);
  return Math.max(0, Math.floor(pot * pct));
}

function getWinnerPayout(room) {
  const pot = Number(room?.matchPot) || 0;
  const rake = getHouseRake(room);
  return Math.max(0, pot - rake);
}

function makeMatchId() {
  return `M${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function canClassicFinishWithTwoJokersOnly(room, player) {
  if (!room || !player) return false;
  if (room.variant !== "classic") return false;

  const hand = player.hand || [];
  if (hand.length !== 2) return false;
  if (!hand.every(isJoker)) return false;

  const melds = room.tableMelds || [];
  if (melds.length === 0) return false;

  // precisa haver somente trincas na mesa
  return melds.every(m => m && m.kind === "TRINCA");
}

function isClassicForbiddenTwoRealOneJokerSequence(meld) {
  if (!Array.isArray(meld) || meld.length !== 3) return false;

  const jokers = meld.filter(isJoker);
  const reals = meld.filter(c => !isJoker(c));

  if (jokers.length !== 1) return false;
  if (reals.length !== 2) return false;

  const naipe = getNaipe(reals[0]);
  if (!naipe) return false;

  for (const c of reals) {
    if (getNaipe(c) !== naipe) return false;
  }

  const ranksA1 = reals.map(c => valorToNumber(getValor(c)));
  if (ranksA1.some(r => r == null)) return false;

  const sortedA1 = [...ranksA1].sort((a, b) => a - b);
  if (sortedA1[1] - sortedA1[0] === 1) return true;

  // Ás alto não muda este caso específico, mas deixo consistente
  if (sortedA1.includes(1)) {
    const sortedA14 = ranksA1.map(r => (r === 1 ? 14 : r)).sort((a, b) => a - b);
    if (sortedA14[1] - sortedA14[0] === 1) return true;
  }

  return false;
}

function startNewRound(room) {
  if (room.matchEnded) {
    return;
  }

  // Cachetão Pro: limpa decisão da rodada anterior
  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.participando = false;
    p.passouRodada = false;
  }

  const aliveSeats = getAliveSeats(room);

  if (aliveSeats.length <= 1) {
    room.started = false;
    room.phase = "WAITING";
    room.dealEndsAt = 0;
    return;
  }

  if (room._dealStartTimer) {
    clearTimeout(room._dealStartTimer);
    room._dealStartTimer = null;
  }

  clearAutoTurnTimer(room);

  room.turnEndsAt = 0;
  room.buyEndsAt = 0;
  room._autoTurnSeat = null;

  // nova rodada
  room.roundNumber = (room.roundNumber || 1) + 1;
    // Cachetão Pro - limpa vira/coringa da rodada anterior
  room.cartaVira = null;
  room.coringaValor = null;
  room.coringaNaipes = [];

  // Cachetão Pro - decisão da rodada
  room.participationDecisionBySeat = {};
  room.participationEndsAt = 0;

  // reset da mecânica de BATI por rodada
  room.crazyBatidaBurnedBySeat = {};
  room.crazyBatidaClaimQueue = [];
  room._crazyBatidaSnapshot = null;
  room.crazyBatidaAttempt = null;
  room.roundAnnouncement = "";
  room.roundAnnouncementEndsAt = 0;

  if (room._crazyBatidaAttemptTimer) {
    clearTimeout(room._crazyBatidaAttemptTimer);
    room._crazyBatidaAttemptTimer = null;
  }

  room.batidaAnnouncement = "";
  room.batidaAnnouncementEndsAt = 0;

  // mantém economia antiga por enquanto
  /*const miniAnteCollected = collectMiniAnte(room);
  room.lastMiniAnteCollected = miniAnteCollected;*/

  // limpa mesa / obrigações
  // Cachetão Pro - limpa espera do duelo
  room.cachetaoDuelCountdownDone = false;
  room.tableMelds = [];
  room.discard = [];
  room.mustUseJokerBySeat = {};
  room.mustUseDiscardCardBySeat = {};
  room.roundEnded = false;
  room.winnerSeat = null;

  // novo baralho
  room.deck = shuffle(makeDeck());

  // limpa mãos e estados da rodada
  for (const p of room.playersBySeat) {
    if (!p || p.eliminated) continue;

    p.hand = [];
    p.pendingBatidaAfterDiscard = false;

    // Cachetão Pro
    p.participando = false;
    p.passouRodada = false;
    p.marrou = false;
  }

    // distribui 9 cartas para cada sobrevivente
  for (let r = 0; r < 9; r++) {
    for (const seat of aliveSeats) {
      const p = room.playersBySeat[seat - 1];
      if (!p || p.eliminated) continue;

      const card = room.deck.pop();
      if (card) p.hand.push(card);
    }
  }

  // Cachetão Pro - define NOVA vira e NOVO coringa a cada rodada
  setupCachetaoRoundJoker(room);

  advanceDealerAndCurrentSeat(room);

  room.started = true;

  // fase visual entre rodadas
  room.dealMs = Number(room.dealMs) > 0 ? Number(room.dealMs) : 1200;
  room.dealEndsAt = Date.now() + room.dealMs;
  room.phase = "DEALING";

  if (room?.id) sendState(room.id);

  room._dealStartTimer = setTimeout(() => {
    room._dealStartTimer = null;

    if (!room || room.matchEnded || room.roundEnded) return;

    // Cachetão Pro:
    // Depois de distribuir, NÃO começa COMPRAR ainda.
    // Primeiro todos escolhem Participar ou Passar.
    room.phase = "DECISAO_PARTICIPAR";
    room.dealEndsAt = 0;
    room.buyEndsAt = 0;

    // força novo timer para o primeiro jogador decidir
    room._autoTurnSeat = null;
    room.turnEndsAt = 0;
    room.buyEndsAt = 0;

    autoMarraCachetaoDecision(room);

    startTurnClock(room);

    if (room?.id) sendState(room.id);
    scheduleAutoTurn(room);
  }, room.dealMs);
}


function tryFinishCachetaoDecision(room) {
  if (!room || room.phase !== "DECISAO_PARTICIPAR") return;

  const aliveSeats = getAliveSeats(room);

  const allDecided = aliveSeats.every((seat) => {
    const p = room.playersBySeat?.[seat - 1];
    return p && (p.participando || p.passouRodada);
  });

  if (!allDecided) {
    sendState(room.id);
    return;
  }

  const playingSeats = aliveSeats.filter((seat) => {
    const p = room.playersBySeat?.[seat - 1];
    return p && p.participando && !p.eliminated;
  });

  // Quem correu devolve as cartas ao monte e perde 1 ponto
const deckAntes = room.deck.length;
let cartasDevolvidas = 0;

for (const seat of aliveSeats) {
  const p = room.playersBySeat?.[seat - 1];
  if (!p || p.eliminated) continue;

  if (p.passouRodada) {

    if (Array.isArray(p.hand) && p.hand.length) {
      cartasDevolvidas += p.hand.length;
      room.deck.push(...p.hand);
    }

    p.hand = [];
    p.jogosBaixados = [];
    p.pendingBatidaAfterDiscard = false;
    p.obrigacaoBaixar = false;

    if (p.vidas <= 0) {
      p.eliminated = true;
    }
  }
}

console.log(
  `[CACHETAO] Monte: ${deckAntes} -> ${room.deck.length} (+${cartasDevolvidas})`
);

// Cachetão Pro:
// quem corre devolve as cartas ao monte,
// então o monte precisa ser embaralhado antes do duelo.
if (cartasDevolvidas > 0) {
  shuffle(room.deck);
  console.log("[CACHETAO] Monte embaralhado após devolução.");
}

  
  // se menos de 2 jogadores decidiram jogar, não há duelo

  
  // se menos de 2 jogadores decidiram jogar, não há duelo
  if (playingSeats.length < 2) {
    room.roundAnnouncement = "Rodada sem duelo. Nova rodada em instantes.";
    room.roundAnnouncementEndsAt = Date.now() + 1500;

    sendState(room.id);

    setTimeout(() => {
      startNewRound(room);
    }, 1500);

    return;
  }

  if (!room.cachetaoDuelCountdownDone) {
    room.cachetaoDuelCountdownDone = true;

    clearAutoTurnTimer(room);

    room.phase = "AGUARDANDO_DUELO";
    room.dealMs = 10000;
    room.dealEndsAt = Date.now() + 10000;
    room.turnEndsAt = 0;
    room.buyEndsAt = 0;

    room.roundAnnouncement = "Embaralhando... Duelo começa em instantes.";
    room.roundAnnouncementEndsAt = room.dealEndsAt;

    sendState(room.id);

    setTimeout(() => {
      if (!room || room.matchEnded || room.roundEnded) return;
      if (room.phase !== "AGUARDANDO_DUELO") return;

      room.phase = "DECISAO_PARTICIPAR";
      room.dealEndsAt = 0;
      room.roundAnnouncement = "";
      room.roundAnnouncementEndsAt = 0;

      tryFinishCachetaoDecision(room);
    }, 10000);

    return;
  }

  room.tableMelds = [];
  room.discard = [];
  room.mustUseJokerBySeat = {};
  room.mustUseDiscardCardBySeat = {};
  room.roundEnded = false;
  room.winnerSeat = null;

  // começa no primeiro participante depois do dealer
  const totalSeats = room.playersBySeat?.length || 10;
  let current = Number(room.dealerSeat || 0);

  for (let i = 0; i < totalSeats; i++) {
    current++;
    if (current > totalSeats) current = 1;

    const p = room.playersBySeat?.[current - 1];

    if (!p) continue;
    if (p.eliminated) continue;
    if (!p.participando) continue;
    if (p.passouRodada) continue;

    room.currentSeat = current;
    break;
  }

  room.phase = "COMPRAR";
  room.dealEndsAt = 0;
  room.buyEndsAt = 0;

  // Cachetão Pro — jogar com a vira.
  // Somente o primeiro jogador da fase de compras pode escolher essa opção.
  room.viraDisponivelParaJogar = true;
  room.primeiroCompradorSeat = room.currentSeat;
  room.viraEmUsoPorSeat = null;

  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.jogandoComVira = false;
    p.viraBaixada = false;
  }

  room._autoTurnSeat = null;
  room.turnEndsAt = 0;

  startTurnClock(room);

  if (room?.id) sendState(room.id);
  scheduleAutoTurn(room);
}

function advanceCachetaoDecisionTurn(room) {
  if (!room || room.phase !== "DECISAO_PARTICIPAR") return;

  const totalSeats = room.playersBySeat?.length || 10;

  const aliveSeats = getAliveSeats(room);

  const allDecided = aliveSeats.every((seat) => {
    const p = room.playersBySeat?.[seat - 1];
    return p && (p.participando || p.passouRodada);
  });

  if (allDecided) {
    tryFinishCachetaoDecision(room);
    return;
  }

  let current = Number(room.currentSeat || 0);

  for (let i = 0; i < totalSeats; i++) {
    current++;

    if (current > totalSeats) current = 1;

    const p = room.playersBySeat?.[current - 1];

    if (!p) continue;
    if (p.eliminated) continue;
    if (p.participando || p.passouRodada) continue;

    room.currentSeat = current;
    room.phase = "DECISAO_PARTICIPAR";

    startTurnClock(room);

    sendState(room.id);
    scheduleAutoTurn(room);
    return;
  }

  tryFinishCachetaoDecision(room);
}

function autoDecideCachetaoParticipation(room) {
  if (!room || room.phase !== "DECISAO_PARTICIPAR") return;

  const seat = Number(room.currentSeat || 0);
  const player = room.playersBySeat?.[seat - 1];

  if (!player || player.eliminated) {
    advanceCachetaoDecisionTurn(room);
    return;
  }

  if (player.participando || player.passouRodada) {
    advanceCachetaoDecisionTurn(room);
    return;
  }

  const estaNaMarra =
    player.marra === true ||
    player.naMarra === true;

  if (estaNaMarra) {
    player.participando = true;
    player.passouRodada = false;
  } else {
    player.participando = false;
    player.passouRodada = true;

    player.vidas = Math.max(0, (Number(player.vidas) || 0) - 1);

    if (player.vidas <= 0) {
      mandarParaRebuyCachetao(room, player);
    }
  }

  advanceCachetaoDecisionTurn(room);
  tryFinishCachetaoDecision(room);
  sendState(room.id);
}

function autoMarraCachetaoDecision(room) {
  if (!room || room.phase !== "DECISAO_PARTICIPAR") return;

  let changed = false;

  for (const p of room.playersBySeat || []) {
    if (!p || p.eliminated) continue;
    if (p.participando || p.passouRodada) continue;

    const estaNaMarra =
      !!p.marra ||
      !!p.naMarra ||
      Number(p.vidas) === 1 ||
      Number(p.totalPoints) === 1;

    if (estaNaMarra) {
      p.participando = true;
      p.passouRodada = false;
      changed = true;
    }
  }

  if (changed) {
    advanceCachetaoDecisionTurn(room);
    tryFinishCachetaoDecision(room);
    sendState(room.id);
  }
}

function advanceCachetaoDecisionSeat(room) {
  if (!room || room.phase !== "DECISAO_PARTICIPAR") return;

  const aliveSeats = getAliveSeats(room);
  if (!aliveSeats.length) return;

  const allDecided = aliveSeats.every((seat) => {
    const p = room.playersBySeat?.[seat - 1];
    return p && (p.participando || p.passouRodada);
  });

  if (allDecided) {
    tryFinishCachetaoDecision(room);
    return;
  }

  let current = Number(room.currentSeat || aliveSeats[0]);

  for (let i = 0; i < aliveSeats.length; i++) {
    current++;

    if (current > 10) current = 1;

    const p = room.playersBySeat?.[current - 1];

    if (!p || p.eliminated) continue;
    if (p.participando || p.passouRodada) continue;

    room.currentSeat = current;
    sendState(room.id);
    return;
  }

  tryFinishCachetaoDecision(room);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureCrazyBatidaSnapshot(room) {
  return {
    currentSeat: room.currentSeat,
    phase: room.phase,
    turnEndsAt: Number(room.turnEndsAt) || 0,
    buyEndsAt: Number(room.buyEndsAt) || 0,
    autoTurnSeat: room._autoTurnSeat || null,

    discard: cloneJson(room.discard || []),
    tableMelds: cloneJson(room.tableMelds || []),

    mustUseDiscardCardBySeat: {
      ...(room.mustUseDiscardCardBySeat || {})
    },

    mustUseJokerBySeat: {
      ...(room.mustUseJokerBySeat || {})
    },

    discardLockForSeat:
      room.discardLockForSeat || null,

    discardLockCardId:
      room.discardLockCardId || null,

    // Cachetão Pro — estado da vira antes da tentativa
    viraDisponivelParaJogar:
      !!room.viraDisponivelParaJogar,

    primeiroCompradorSeat:
      room.primeiroCompradorSeat ?? null,

    viraEmUsoPorSeat:
      room.viraEmUsoPorSeat ?? null,

    viraNaMesa:
      room.viraNaMesa !== false,

    players: (room.playersBySeat || []).map(p =>
      p ? {
        hand: cloneJson(p.hand || []),

        pendingBatidaAfterDiscard:
          !!p.pendingBatidaAfterDiscard,

        jogandoComVira:
          !!p.jogandoComVira,

        batendoComVira:
          !!p.batendoComVira,

        viraBaixada:
          !!p.viraBaixada,

        viraDescartada:
          !!p.viraDescartada
      } : null
    )
  };
}

function restoreCrazyBatidaSnapshot(room, snapshot) {
  if (!room || !snapshot) return;

  room.currentSeat = snapshot.currentSeat;
  room.phase = snapshot.phase;
  room.turnEndsAt = Number(snapshot.turnEndsAt) || 0;
  room.buyEndsAt = Number(snapshot.buyEndsAt) || 0;
  room._autoTurnSeat = snapshot.autoTurnSeat || null;

  room.discard =
    cloneJson(snapshot.discard || []);

  room.tableMelds =
    cloneJson(snapshot.tableMelds || []);

  room.mustUseDiscardCardBySeat = {
    ...(snapshot.mustUseDiscardCardBySeat || {})
  };

  room.mustUseJokerBySeat = {
    ...(snapshot.mustUseJokerBySeat || {})
  };

  room.discardLockForSeat =
    snapshot.discardLockForSeat || null;

  room.discardLockCardId =
    snapshot.discardLockCardId || null;

  room.viraDisponivelParaJogar =
    !!snapshot.viraDisponivelParaJogar;

  room.primeiroCompradorSeat =
    snapshot.primeiroCompradorSeat ?? null;

  room.viraEmUsoPorSeat =
    snapshot.viraEmUsoPorSeat ?? null;

  room.viraNaMesa =
    snapshot.viraNaMesa !== false;

  for (
    let i = 0;
    i < (room.playersBySeat || []).length;
    i++
  ) {
    const p = room.playersBySeat[i];
    const snapP = snapshot.players?.[i];

    if (!p || !snapP) continue;

    p.hand =
      cloneJson(snapP.hand || []);

    p.pendingBatidaAfterDiscard =
      !!snapP.pendingBatidaAfterDiscard;

    p.jogandoComVira =
      !!snapP.jogandoComVira;

    p.batendoComVira =
      !!snapP.batendoComVira;

    p.viraBaixada =
      !!snapP.viraBaixada;

    p.viraDescartada =
      !!snapP.viraDescartada;
  }
}


function clearCrazyBatidaAttempt(room, options = {}) {
  if (!room) return;

  const { restoreSnapshot = false, resumeTurn = false } = options;
  const snapshot = room._crazyBatidaSnapshot || null;

  if (room._crazyBatidaAttemptTimer) {
    clearTimeout(room._crazyBatidaAttemptTimer);
    room._crazyBatidaAttemptTimer = null;
  }

  if (restoreSnapshot && snapshot) {
    restoreCrazyBatidaSnapshot(room, snapshot);
  }

  room.crazyBatidaAttempt = null;

  if (restoreSnapshot) {
    // mantém snapshot para o próximo da fila usar o mesmo descarte original
  } else {
    room._crazyBatidaSnapshot = null;
    room.crazyBatidaClaimQueue = [];
  }

  if (restoreSnapshot) {
    room.batidaAnnouncement = "";
    room.batidaAnnouncementEndsAt = 0;
  }

  if (resumeTurn) {
    clearAutoTurnTimer(room);
    startTurnClock(room);
  }
}

function isCrazyBatidaAttemptActive(room) {
  return !!room?.crazyBatidaAttempt?.active;
}

function isCrazyBatidaAttemptSeat(room, seat) {
  return Number(room?.crazyBatidaAttempt?.claimantSeat || 0) === Number(seat || 0);
}

function enqueueCrazyBatidaClaim(room, seat, prioritySeat = 0) {
  if (!room) return;

  room.crazyBatidaClaimQueue = Array.isArray(room.crazyBatidaClaimQueue)
    ? room.crazyBatidaClaimQueue
    : [];

  const nSeat = Number(seat || 0);
  const nPrioritySeat = Number(prioritySeat || 0);

  if (!nSeat) return;

  room.crazyBatidaClaimQueue = room.crazyBatidaClaimQueue.filter(s => Number(s) !== nSeat);

  if (nPrioritySeat && nSeat === nPrioritySeat) {
    room.crazyBatidaClaimQueue.unshift(nSeat);
    return;
  }

  room.crazyBatidaClaimQueue.push(nSeat);
}

function isCrazyBatidaBurned(room, seat) {
  return !!room?.crazyBatidaBurnedBySeat?.[Number(seat || 0)];
}

function markCrazyBatidaBurned(room, seat) {
  if (!room) return;
  room.crazyBatidaBurnedBySeat = room.crazyBatidaBurnedBySeat || {};
  room.crazyBatidaBurnedBySeat[Number(seat || 0)] = true;
}

function devolverJogosDoJogadorParaMao(room, playerSeat) {
  const player = room.playersBySeat?.[playerSeat - 1];
  if (!player) return;

  const ownMelds = (room.tableMelds || []).filter(m => Number(m.seat) === Number(playerSeat));
  const otherMelds = (room.tableMelds || []).filter(m => Number(m.seat) !== Number(playerSeat));

  for (const meld of ownMelds) {
    player.hand = player.hand || [];
    player.hand.push(...(meld.cards || []));
  }

  room.tableMelds = otherMelds;
  player.pendingBatidaAfterDiscard = false;
}

function dequeueCrazyBatidaClaim(room) {
  if (!room || !Array.isArray(room.crazyBatidaClaimQueue)) return 0;

  while (room.crazyBatidaClaimQueue.length) {
    const seat = Number(room.crazyBatidaClaimQueue.shift() || 0);
    if (!seat) continue;

    const p = room.playersBySeat?.[seat - 1];
    if (!p || p.eliminated) continue;

    return seat;
  }

  return 0;
}

function removeCrazyBatidaClaimFromQueue(room, seat) {
  if (!room || !Array.isArray(room.crazyBatidaClaimQueue)) return;

  const nSeat = Number(seat || 0);
  room.crazyBatidaClaimQueue = room.crazyBatidaClaimQueue.filter(s => Number(s) !== nSeat);
}

function startCrazyBatidaAttemptForSeat(room, seat, ms = 25000) {
  const player = room.playersBySeat?.[seat - 1];
  if (!room || !player) {
    return { ok: false, msg: "Jogador inválido para BATI." };
  }

  const topCard = room.discard?.[room.discard.length - 1];
  if (!topCard) {
    return { ok: false, msg: "Não há carta no lixo para disputar." };
  }

  const prioritySeat =
    Number(room.crazyBatidaAttempt?.prioritySeat || 0) ||
    Number(room.currentSeat || 0);

  removeCrazyBatidaClaimFromQueue(room, seat);

  clearAutoTurnTimer(room);

  const stolen = room.discard.pop();
  player.hand = [...(player.hand || []), stolen];

  markDiscardCardRequired(room, seat, stolen.id);

  room.crazyBatidaAttempt = {
    active: true,
    claimantSeat: seat,
    prioritySeat,
    discardCardId: stolen.id,
    startedAt: Date.now(),
    expiresAt: Date.now() + ms
  };

  room.batidaAnnouncement = `${player.name || "Alguém"} Bateu!`;
  room.batidaAnnouncementEndsAt = Date.now() + 2200;

  room.currentSeat = seat;
  room.phase = "BAIXAR";
  room.turnEndsAt = room.crazyBatidaAttempt.expiresAt;
  room.buyEndsAt = 0;
  room._autoTurnSeat = seat;

  if (room._crazyBatidaAttemptTimer) {
    clearTimeout(room._crazyBatidaAttemptTimer);
    room._crazyBatidaAttemptTimer = null;
  }

  room._crazyBatidaAttemptTimer = setTimeout(() => {
    room._crazyBatidaAttemptTimer = null;

    if (!isCrazyBatidaAttemptActive(room)) return;

    const failedSeat = Number(room.crazyBatidaAttempt?.claimantSeat || 0);
    markCrazyBatidaBurned(room, failedSeat);

    clearCrazyBatidaAttempt(room, {
      restoreSnapshot: true,
      resumeTurn: false
    });

    room.batidaAnnouncement = "";
    room.batidaAnnouncementEndsAt = 0;

    removeCrazyBatidaClaimFromQueue(room, failedSeat);

    const nextSeat = dequeueCrazyBatidaClaim(room);
    if (nextSeat) {
      startCrazyBatidaAttemptForSeat(room, nextSeat, ms);
    } else {
      room._crazyBatidaSnapshot = null;
      room.crazyBatidaClaimQueue = [];
      clearAutoTurnTimer(room);
      startTurnClock(room);
    }

    if (room?.id) sendState(room.id);
  }, ms);

  return { ok: true };
}

function startBatidaComViraAttemptForSeat(
  room,
  seat,
  ms = 25000
) {
  const player =
    room?.playersBySeat?.[seat - 1];

  if (!room || !player) {
    return {
      ok: false,
      msg: "Jogador inválido para BATI com a vira."
    };
  }

  if (
    !player.participando ||
    player.passouRodada ||
    player.eliminated
  ) {
    return {
      ok: false,
      msg: "Você não está participando desta rodada."
    };
  }

  if (!room.cartaVira || room.viraNaMesa === false) {
    return {
      ok: false,
      msg: "A vira não está disponível."
    };
  }

  const prioritySeat =
    Number(
      room.crazyBatidaAttempt?.prioritySeat || 0
    ) ||
    Number(room.currentSeat || 0);

  removeCrazyBatidaClaimFromQueue(room, seat);
  clearAutoTurnTimer(room);

  // A vira continua fora da mão.
  player.jogandoComVira = true;
  player.batendoComVira = true;
  player.viraBaixada = false;
  player.viraDescartada = false;

  room.viraEmUsoPorSeat = seat;
  room.viraDisponivelParaJogar = false;
  room.viraNaMesa = true;

  room.crazyBatidaAttempt = {
    active: true,
    claimantSeat: seat,
    prioritySeat,
    discardCardId: null,

    // diferencia esta tentativa do BATI pelo lixo
    usesVira: true,

    startedAt: Date.now(),
    expiresAt: Date.now() + ms
  };

  room.batidaAnnouncement =
    `${player.name || "Alguém"} pediu BATI com a Vira!`;

  room.batidaAnnouncementEndsAt =
    Date.now() + 2200;

  room.currentSeat = seat;
  room.phase = "BAIXAR";
  room.turnEndsAt =
    room.crazyBatidaAttempt.expiresAt;

  room.buyEndsAt = 0;
  room._autoTurnSeat = seat;

  if (room._crazyBatidaAttemptTimer) {
    clearTimeout(
      room._crazyBatidaAttemptTimer
    );

    room._crazyBatidaAttemptTimer = null;
  }

  room._crazyBatidaAttemptTimer =
    setTimeout(() => {
      room._crazyBatidaAttemptTimer = null;

      if (!isCrazyBatidaAttemptActive(room)) {
        return;
      }

      const tentativaAtual =
        room.crazyBatidaAttempt;

      if (!tentativaAtual?.usesVira) {
        return;
      }

      const failedSeat =
        Number(
          tentativaAtual.claimantSeat || 0
        );

      markCrazyBatidaBurned(
        room,
        failedSeat
      );

      clearCrazyBatidaAttempt(room, {
        restoreSnapshot: true,
        resumeTurn: false
      });

      room.batidaAnnouncement = "";
      room.batidaAnnouncementEndsAt = 0;

      removeCrazyBatidaClaimFromQueue(
        room,
        failedSeat
      );

      const nextSeat =
        dequeueCrazyBatidaClaim(room);

      if (nextSeat) {
        startBatidaComViraAttemptForSeat(
          room,
          nextSeat,
          ms
        );
      } else {
        room._crazyBatidaSnapshot = null;
        room.crazyBatidaClaimQueue = [];

        clearAutoTurnTimer(room);
        startTurnClock(room);
      }

      if (room?.id) {
        sendState(room.id);
      }
    }, ms);

  return { ok: true };
}


function getActivePlayers(room) {
  return Array.isArray(room.playersBySeat)
    ? room.playersBySeat.filter(Boolean)
    : [];
}

function allPlayersOffline(room) {
  const players = getActivePlayers(room);
  if (!players.length) return false;

  return players.every(p => !!p.disconnected);
}

function markRoomAbandonedIfNeeded(room) {
  if (!room?.started || room.matchEnded) return false;

  if (!allPlayersOffline(room)) {
    room.abandonedAt = 0;
    return false;
  }

  if (!room.abandonedAt) {
    room.abandonedAt = Date.now();
    console.log(`[ABANDONED] Mesa ${room.id}: todos offline. Iniciando janela de 3 minutos.`);
  }

  return true;
}

function shouldCloseAbandonedRoom(room) {
  if (!markRoomAbandonedIfNeeded(room)) return false;

  return Date.now() - Number(room.abandonedAt || 0) >= 180000;
}

function closeAbandonedRoom(room) {
  console.log(`[ABANDONED] Mesa ${room.id}: fechando mesa abandonada.`);

  room.started = false;
  room.matchEnded = false;
  room.roundEnded = false;

  room.phase = "WAITING";
  room.currentSeat = null;

  room.deck = [];
  room.discard = [];
  room.tableMelds = [];

  room.turnEndsAt = 0;
  room.buyEndsAt = 0;
  room.dealEndsAt = 0;

  room.abandonedAt = 0;
  room.startAt = 0;

  room.playersBySeat = room.playersBySeat.map(() => null);

  room.matchPot = 0;
  room.roundNumber = 0;

  room.crazyBatidaAttempt = null;
  room.crazyBatidaBurnedBySeat = {};

  broadcastLobbyTable(room);
  sendState(room.id);
}


function canSeatActDuringCrazyBatidaAttempt(room, seat, actionType) {
  if (!isCrazyBatidaAttemptActive(room)) return false;
  if (!isCrazyBatidaAttemptSeat(room, seat)) return false;

  return [
    "playMeld",
    "addToMeld",
    "swapJoker",
    "discard",
    "cancelCrazyBatidaAttempt"
  ].includes(actionType);
}


function revealBatidaThenEndRound(room, winnerSeat, ms = 1800) {
  if (!room) return;
  if (room.roundEnded) return;

  clearCrazyBatidaAttempt(room, { restoreSnapshot: false, resumeTurn: false });

  room.pendingBatidaReveal = true;
  room.pendingBatidaRevealEndsAt = Date.now() + ms;
  room.phase = "WAITING";

  clearAutoTurnTimer(room);
  room.turnEndsAt = 0;
  room._autoTurnSeat = null;
  room.buyEndsAt = 0;

  if (room._pendingBatidaRevealTimeoutId) {
    clearTimeout(room._pendingBatidaRevealTimeoutId);
    room._pendingBatidaRevealTimeoutId = null;
  }

  if (room?.id) sendState(room.id);

  room._pendingBatidaRevealTimeoutId = setTimeout(() => {
    room._pendingBatidaRevealTimeoutId = null;

    room.pendingBatidaReveal = false;
    room.pendingBatidaRevealEndsAt = 0;

    // 👇 limpa mensagem depois
    room.batidaAnnouncement = "";
    room.batidaAnnouncementEndsAt = 0;

    endRound(room, winnerSeat);

    if (room?.id) sendState(room.id);
  }, ms);
}

function handleStartBatidaComViraAttempt(
  room,
  player,
  playerSeat
) {
  if (!isCrazy(room)) {
    return {
      ok: false,
      msg: "BATI com a vira só existe no Cachetão Pro."
    };
  }

  if (!room.started || room.roundEnded) {
    return {
      ok: false,
      msg: "A rodada já terminou."
    };
  }

  if (room.pendingBatidaReveal) {
    return {
      ok: false,
      msg: "Aguarde a exibição da batida."
    };
  }

  if (
    !player ||
    !player.participando ||
    player.passouRodada ||
    player.eliminated
  ) {
    return {
      ok: false,
      msg: "Você não está participando desta rodada."
    };
  }

  if (isCrazyBatidaBurned(room, playerSeat)) {
    return {
      ok: false,
      msg: "Você já tentou BATER nesta rodada."
    };
  }

  const activeAttempt =
    room.crazyBatidaAttempt || null;

  // Já existe uma tentativa em andamento.
  if (activeAttempt?.active) {
    if (!activeAttempt.usesVira) {
      return {
        ok: false,
        msg: "Já existe uma tentativa de BATI em andamento."
      };
    }

    const claimantSeat =
      Number(
        activeAttempt.claimantSeat || 0
      );

    const prioritySeat =
      Number(
        activeAttempt.prioritySeat ||
        room.currentSeat ||
        0
      );

    if (
      claimantSeat ===
      Number(playerSeat || 0)
    ) {
      return {
        ok: false,
        msg: "Você já está tentando BATI com a vira."
      };
    }

    // O primeiro comprador mantém a prioridade.
    if (
      prioritySeat &&
      Number(playerSeat || 0) === prioritySeat &&
      claimantSeat !== prioritySeat
    ) {
      enqueueCrazyBatidaClaim(
        room,
        claimantSeat,
        prioritySeat
      );

      clearCrazyBatidaAttempt(room, {
        restoreSnapshot: true,
        resumeTurn: false
      });

      const started =
        startBatidaComViraAttemptForSeat(
          room,
          playerSeat,
          25000
        );

      if (room?.id) {
        sendState(room.id);
      }

      return started.ok
        ? null
        : started;
    }

    enqueueCrazyBatidaClaim(
      room,
      playerSeat,
      prioritySeat
    );

    if (room?.id) {
      sendState(room.id);
    }

    return null;
  }

  // A janela existe somente antes da primeira compra.
  if (
    room.phase !== "COMPRAR" ||
    !room.viraDisponivelParaJogar
  ) {
    return {
      ok: false,
      msg: "BATI com a vira só pode ser pedido antes da primeira compra."
    };
  }

  if (
    !room.cartaVira ||
    room.viraNaMesa === false
  ) {
    return {
      ok: false,
      msg: "A vira não está disponível."
    };
  }

  if (!room._crazyBatidaSnapshot) {
    room._crazyBatidaSnapshot =
      captureCrazyBatidaSnapshot(room);
  }

  room.crazyBatidaClaimQueue =
    Array.isArray(room.crazyBatidaClaimQueue)
      ? room.crazyBatidaClaimQueue
      : [];

  const started =
    startBatidaComViraAttemptForSeat(
      room,
      playerSeat,
      25000
    );

  if (room?.id) {
    sendState(room.id);
  }

  return started.ok
    ? null
    : started;
}


function handleStartCrazyBatidaAttempt(room, player, playerSeat) {
  if (!isCrazy(room)) {
    return { ok: false, msg: "Batida fora do turno só existe no Crazy." };
  }

  if (!room.started || room.roundEnded) {
    return { ok: false, msg: "A rodada já terminou." };
  }

  if (room.pendingBatidaReveal) {
    return { ok: false, msg: "Aguarde a exibição da batida." };
  }

  if (room.phase !== "COMPRAR" && !isCrazyBatidaAttemptActive(room)) {
    return { ok: false, msg: "BATI só pode ser pedido antes da compra do próximo jogador." };
  }

  if (isCrazyBatidaBurned(room, playerSeat)) {
  return { ok: false, msg: "Você já tentou BATER nesta rodada." };
  }

  const prioritySeat = Number(
    room.crazyBatidaAttempt?.prioritySeat || room.currentSeat || 0
  );

  const activeAttempt = room.crazyBatidaAttempt || null;

  // Já existe tentativa ativa
  if (activeAttempt?.active) {
    const claimantSeat = Number(activeAttempt.claimantSeat || 0);

    if (claimantSeat === Number(playerSeat || 0)) {
      return { ok: false, msg: "Você já está tentando BATI." };
    }

    // Se o jogador da vez clicou depois, ele toma a prioridade imediatamente
    if (
      prioritySeat &&
      Number(playerSeat || 0) === prioritySeat &&
      claimantSeat !== prioritySeat
    ) {
      enqueueCrazyBatidaClaim(room, claimantSeat, prioritySeat);

      clearCrazyBatidaAttempt(room, {
        restoreSnapshot: true,
        resumeTurn: false
      });

      const started = startCrazyBatidaAttemptForSeat(room, playerSeat, 25000);
      if (room?.id) sendState(room.id);
      return started.ok ? null : started;
    }

    // senão, só entra na fila
    enqueueCrazyBatidaClaim(room, playerSeat, prioritySeat);
    if (room?.id) sendState(room.id);
    return null;
  }

  const topCard = room.discard?.[room.discard.length - 1];
  if (!topCard) {
    return { ok: false, msg: "Não há carta no lixo para disputar." };
  }

  // Snapshot só uma vez por disputa daquele descarte
  if (!room._crazyBatidaSnapshot) {
    room._crazyBatidaSnapshot = captureCrazyBatidaSnapshot(room);
  }

  room.crazyBatidaClaimQueue = Array.isArray(room.crazyBatidaClaimQueue)
    ? room.crazyBatidaClaimQueue
    : [];

  const started = startCrazyBatidaAttemptForSeat(room, playerSeat, 25000);
  if (room?.id) sendState(room.id);
  return started.ok ? null : started;
}



function handleCancelCrazyBatidaAttempt(room, playerSeat) {
  if (!isCrazyBatidaAttemptActive(room)) {
    return { ok: false, msg: "Não há tentativa de BATI ativa." };
  }

  if (!isCrazyBatidaAttemptSeat(room, playerSeat)) {
    return { ok: false, msg: "Só quem pediu BATI pode cancelar." };
  }

  clearCrazyBatidaAttempt(room, {
    restoreSnapshot: true,
    resumeTurn: false
  });

  markCrazyBatidaBurned(room, playerSeat);

  room.batidaAnnouncement = "";
  room.batidaAnnouncementEndsAt = 0;

  removeCrazyBatidaClaimFromQueue(room, playerSeat);

  const nextSeat = dequeueCrazyBatidaClaim(room);
  if (nextSeat) {
    startCrazyBatidaAttemptForSeat(room, nextSeat, 25000);
  } else {
    room._crazyBatidaSnapshot = null;
    room.crazyBatidaClaimQueue = [];
    clearAutoTurnTimer(room);
    startTurnClock(room);
  }

  if (room?.id) sendState(room.id);
  return null;
}

function endRoundByEmptyDeck(room) {
  if (room.roundEnded) return;

  room.roundEnded = true;
  room.winnerSeat = null;
  room.roundAnnouncement = "Baralho acabou! Rodada encerrada por pontos.";
  room.roundAnnouncementEndsAt = Date.now() + 5000;

  clearAutoTurnTimer(room);
  room.turnEndsAt = 0;
  room._autoTurnSeat = null;
  room.buyEndsAt = 0;

  // 1) calcula pontos da rodada para TODOS os jogadores vivos
  for (let i = 0; i < room.playersBySeat.length; i++) {
    const p = room.playersBySeat[i];
    if (!p) continue;

    if (p.eliminated) {
      p.lastRoundPoints = 0;
      continue;
    }

    const pts = getHandPoints(p.hand || []);
    p.lastRoundPoints = pts;
    p.totalPoints = (p.totalPoints || 0) + pts;
  }

  // 2) não há vencedor da rodada, então não há pagamento por pontos
  const pointTransfers = [];

  // 3) processa eliminações / rebuy
  for (let i = 0; i < room.playersBySeat.length; i++) {
    const p = room.playersBySeat[i];
    if (!p) continue;

    if (p.totalPoints > 100) {
      const wasEliminated = !!p.eliminated;

      p.eliminated = true;
      p.hand = [];

      if (!wasEliminated) {
        if ((p.rebuyCount || 0) < 3) {
          if (p.disconnected) {
            p.pendingRebuy = true;
            p.rebuyDeclined = false;
          } else {
            p.pendingRebuy = false;
            p.rebuyDeclined = false;
          }
        } else {
          p.pendingRebuy = false;
          p.rebuyDeclined = true;
        }
      }
    }
  }

  // 4) log econômico da rodada
  pushRoundEconomicLog(
    room,
    null,
    pointTransfers,
    room.lastMiniAnteCollected || 0,
    []
  );

  // 5) abre janela de rebuy / próxima rodada
  scheduleNextRoundWithRebuy(room, 10000);

  // 6) avisa o cliente agora
  if (room?.id) sendState(room.id);
}


function endRound(room, winnerSeat) {
  if (room.roundEnded) return;

  room.roundEnded = true;
  room.winnerSeat = winnerSeat;

  clearCrazyBatidaAttempt(room, { restoreSnapshot: false, resumeTurn: false });
  room._crazyBatidaSnapshot = null;
  room.crazyBatidaClaimQueue = [];

  clearAutoTurnTimer(room);
  room.turnEndsAt = 0;
  room._autoTurnSeat = null;
  room.buyEndsAt = 0;

  room.pendingBatidaReveal = false;
  room.pendingBatidaRevealEndsAt = 0;
  room.batidaAnnouncement = "";
  room.batidaAnnouncementEndsAt = 0;

  if (room._pendingBatidaRevealTimeoutId) {
    clearTimeout(room._pendingBatidaRevealTimeoutId);
    room._pendingBatidaRevealTimeoutId = null;
  }

  // Cachetão Pro:
  // Quem jogou e perdeu perde 2 pontos.
  // Quem correu já perdeu 1 ponto no momento da decisão.
  // Quem ganhou não perde ponto.
  for (let i = 0; i < room.playersBySeat.length; i++) {
    const p = room.playersBySeat[i];
    if (!p) continue;
    if (p.eliminated) continue;

    const seat = i + 1;

    p.lastRoundPoints = 0;

    if (seat === Number(winnerSeat)) {
      continue;
    }

    if (p.participando && !p.passouRodada) {
      p.vidas = Math.max(0, (Number(p.vidas) || 0) - 2);
      p.totalPoints = p.vidas;
      p.lastRoundPoints = 2;

    if (p.vidas <= 0) {
      mandarParaRebuyCachetao(room, p);
    }
    }
  }

  // Verifica se a partida terminou
  const alivePlayers = (room.playersBySeat || []).filter(p => p && !p.eliminated);

  if (alivePlayers.length <= 1) {
  const winner = alivePlayers[0] || null;

  room.matchEnded = true;
  room.matchWinnerSeat = winner
    ? room.playersBySeat.indexOf(winner) + 1
    : winnerSeat;

  // limpa estado de rodada/marra antes da revanche
  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.participando = false;
    p.passouRodada = false;

    p.marra = false;
    p.naMarra = false;
    p.emMarra = false;
    p.isMarra = false;
    p.cachetaoMarra = false;
    p.obrigadoJogar = false;
  }

  finalizeMatchEconomy(room);

  if (room?.id) sendState(room.id);
  return;
}

      // Cachetão Pro: agenda próxima rodada usando janela de rebuy
    scheduleNextRoundWithRebuy(room, 15000);

    if (room?.id) sendState(room.id);
}

function isCrazyBatidaOpenEndedSequence(meld, room, player, idSet) {
  if (!Array.isArray(meld) || meld.length < 3) return false;
  if (!room || room.variant === "classic") return false; 

  /*mudar para permitir 4♥ 5♥ 🃏
  if (!room) return false;*/

  const jokers = meld.filter(isJoker);
  const reals = meld.filter(c => !isJoker(c));

  // esta exceção vale só para 1 coringa na sequência
  if (jokers.length !== 1) return false;
  if (reals.length < 2) return false;

  // todas as cartas reais devem ter o mesmo naipe
  const naipe = getNaipe(reals[0]);
  if (!naipe) return false;
  for (const c of reals) {
    if (getNaipe(c) !== naipe) return false;
  }

  const ranksA1 = reals.map(c => valorToNumber(getValor(c)));
  if (ranksA1.some(r => r == null)) return false;

  function checkOpenEnded(ranks) {
    const sorted = [...ranks].sort((a, b) => a - b);

    // não pode repetir
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i] === sorted[i + 1]) return false;
    }

    // cartas reais já precisam estar consecutivas
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] - sorted[i] !== 1) return false;
    }

    return true;
  }

  let aceHigh = false;
  let ok = checkOpenEnded(ranksA1);

  if (!ok && ranksA1.includes(1)) {
    const ranksA14 = ranksA1.map(r => (r === 1 ? 14 : r));
    ok = checkOpenEnded(ranksA14);
    aceHigh = ok;
  }

  if (!ok) return false;

  // precisa ser para batida:
  // depois de baixar, sobra 0 cartas
  // ou sobra exatamente 1 carta descartável
  const remainingCards = (player.hand || []).filter(c => !idSet.has(String(c.id)));

  if (remainingCards.length === 0) {
    return { ok: true, aceHigh };
  }

  if (remainingCards.length === 1) {
    const lastCard = remainingCards[0];

    if (isJoker(lastCard)) return false;
    if (!player.disconnected && canCardBeAddedToAnyMeld(room, lastCard)) return false;
    if (!player.disconnected && canCardReplaceAnyJokerOnTable(room, lastCard)) return false;

    return { ok: true, aceHigh };
  }

  return false;
}


function hasRebuyChoices(room) {
  if (!room.started && room.phase === "WAITING") return false;

  return (room.playersBySeat || []).some(pl =>
    pl &&
    pl.eliminated === true &&
    pl.disconnected !== true &&
    pl.pendingRebuy !== true &&
    pl.rebuyDeclined !== true &&
    (pl.rebuyCount || 0) < 3
  );
}

function getRebuyCost(room, p) {
  const ante = typeof room.buyIn === "number" && room.buyIn > 0 ? room.buyIn : 0;
  const times = Math.pow(2, p.rebuyCount || 0);
  return ante * times;
}


function getCachetaoRebuyReturnVidas(room) {
  const vivos = (room.playersBySeat || [])
    .filter(p => p && !p.eliminated)
    .map(p => Number(p.vidas ?? p.totalPoints ?? 0))
    .filter(v => v > 0);

  if (!vivos.length) return 1;

  return Math.min(...vivos);
}

function todosVivosNaMarra(room) {
  const vivos = (room.playersBySeat || [])
    .filter(p => p && !p.eliminated && !p.pendingRebuy);

  if (vivos.length < 2) return false;

  return vivos.every(p =>
    !!p.marra ||
    !!p.naMarra ||
    Number(p.vidas ?? p.totalPoints ?? 0) === 1
  );
}

function mandarParaRebuyCachetao(room, player) {
  if (!room || !player) return;

  player.eliminated = true;
  player.hand = [];
  player.jogosBaixados = [];

  const rebuyCount = Number(player.rebuyCount) || 0;
  const cost = Number(getRebuyCost(room, player)) || 0;
  const chips = Number(player.chips) || 0;

  if (
    rebuyCount < 3 &&
    cost > 0 &&
    chips >= cost &&
    !todosVivosNaMarra(room)
  ) {
    player.pendingRebuy = false;

console.log("[CACHEIPRO REBUY ABRIU]", {
  player: player.name,
  vidas: player.vidas,
  rebuyCount: player.rebuyCount,
  cost,
  chips,
  rebuyDecisionUntil: room.rebuyDecisionUntil
});

    player.rebuyDeclined = false;
    return;
  }

    console.log("[CACHEIPRO REBUY NÃO ABRIU]", {
      player: player.name,
      rebuyCount,
      motivo:
        rebuyCount >= 3
          ? "Limite de 3 rebuys atingido"
          : todosVivosNaMarra(room)
          ? "Todos os jogadores vivos estão na Marra"
          : chips < cost
          ? "Saldo insuficiente"
          : "Outro motivo",
      chips
    });


  player.pendingRebuy = false;
  player.rebuyDeclined = true;
}



function applyPendingRebuys(room) {
  // Cachetão Pro:
  // volta com o menor ponto entre os jogadores ativos
  const active = (room.playersBySeat || [])
    .filter(pl => pl && !pl.eliminated && !pl.pendingRebuy);

  const minVidas = active.length
    ? Math.min(...active.map(pl => Number(pl.vidas ?? pl.totalPoints ?? 0)).filter(v => v > 0))
    : 1;

  const returnVidas = Number.isFinite(minVidas) && minVidas > 0 ? minVidas : 1;

  const appliedRebuys = [];

  for (let i = 0; i < (room.playersBySeat || []).length; i++) {
    const pl = room.playersBySeat[i];
    if (!pl || !pl.pendingRebuy) continue;

    if ((pl.rebuyCount || 0) >= 3) {
      pl.pendingRebuy = false;
      pl.eliminated = true;

      if (pl.disconnected) {
        room.playersBySeat[i] = null;
      }

      continue;
    }

    const cost = Number(getRebuyCost(room, pl)) || 0;

    pl.chips = Number(pl.chips);
    if (!Number.isFinite(pl.chips)) pl.chips = 0;

    if (pl.chips < cost || cost <= 0) {
      pl.pendingRebuy = false;
      pl.eliminated = true;

      if (pl.disconnected) {
        room.playersBySeat[i] = null;
      }

      continue;
    }

    const rebuyCountBefore = pl.rebuyCount || 0;

    pl.chips -= cost;

    // Cachetão Pro/Pontinho: mantém o saldo da mesa sincronizado para HUD/scoreboard
    pl.tableChips = Number(pl.tableChips);
    if (!Number.isFinite(pl.tableChips)) {
      pl.tableChips = Number(pl.chips) || 0;
    }

    pl.tableChips = Math.max(0, pl.tableChips - cost);

    room.matchPot = Number(room.matchPot) || 0;
    room.matchPot += cost;

    pl.eliminated = false;
    pl.pendingRebuy = false;
    pl.rebuyDeclined = false;
    pl.rebuyCount = rebuyCountBefore + 1;

    pl.hand = [];
    pl.jogosBaixados = [];
    pl.obrigacaoBaixar = false;

    // Cachetão Pro: volta com o menor ponto entre os ativos
    pl.vidas = returnVidas;
    pl.totalPoints = returnVidas;

    pl.marra = returnVidas === 1;
    pl.naMarra = returnVidas === 1;

    appliedRebuys.push({
      seat: i + 1,
      name: pl.name,
      rebuyCountBefore,
      rebuyCountAfter: pl.rebuyCount,
      cost,
      returnVidas
    });
  }

  return appliedRebuys;
}

/* Revanche*/

function resetRoomForRematch(room) {
  if (!room) return;

  if (room.nextRoundTimeoutId) {
    clearTimeout(room.nextRoundTimeoutId);
    room.nextRoundTimeoutId = null;
  }

  if (room._startTimerId) {
    clearTimeout(room._startTimerId);
    room._startTimerId = null;
  }

  room.started = false;
  room.startAt = 0;
  room.phase = "WAITING";
  room.currentSeat = 1;
  room.crazyBatidaBurnedBySeat = {};
  room.roundEnded = false;
  room.winnerSeat = null;
  room.rebuyDecisionUntil = 0;

  room.matchEnded = false;
  room.matchWinnerSeat = null;
  room.keepSeatVotes = {};

  room.deck = [];
  room.discard = [];
  room.tableMelds = [];

  room.roundNumber = 0;
  room.matchPot = 0;

  for (const p of room.playersBySeat || []) {
    if (!p) continue;
    p.nextMatchReady = false;

    p.hand = [];
    p.totalPoints = 10;
    p.vidas = 10;
    p.lastRoundPoints = 0;
    p.pendingBatidaAfterDiscard = false;

    p.eliminated = false;
    p.pendingRebuy = false;
    p.rebuyDeclined = false;
    p.rebuyCount = 0;

    p.jogosBaixados = [];
    p.obrigacaoBaixar = false;
    p.participando = false;
    p.passouRodada = false;
    p.decidiuParticipar = false;
    
    p.marra = false;
    p.emMarra = false;
    p.naMarra = false;
    p.isMarra = false;
    p.cachetaoMarra = false;
    p.obrigadoJogar = false;
    
  }
  cleanupEmptyRoomInstances();
}


function scheduleNextRoundWithRebuy(room, ms = 20000) {
  room.rebuyDecisionUntil = 0;
  room.lastAppliedRebuys = [];

  // Se sobrou apenas 1 jogador vivo, a partida acabou.
  const alivePlayers = (room.playersBySeat || []).filter(pl => pl && !pl.eliminated);

  if (alivePlayers.length <= 1) {
    room.rebuyDecisionUntil = 0;

    if (room.nextRoundTimeoutId) {
      clearTimeout(room.nextRoundTimeoutId);
      room.nextRoundTimeoutId = null;
    }

    room.matchEnded = true;
    room.matchWinnerSeat = room.playersBySeat.indexOf(alivePlayers[0]) + 1;


    finalizeMatchEconomy(room);
    if (room?.id) sendState(room.id);
    return;
  }

  // Só conectado precisa de janela de decisão.
  // Desconectado com rebuy disponível já deve ter sido marcado
  // com pendingRebuy = true no endRound().
  const hasConnectedChoices = (room.playersBySeat || []).some(pl =>
    pl &&
    pl.eliminated === true &&
    pl.disconnected !== true &&
    pl.pendingRebuy !== true &&
    pl.rebuyDeclined !== true &&
    (pl.rebuyCount || 0) < 3
  );

  if (room.nextRoundTimeoutId) {
    clearTimeout(room.nextRoundTimeoutId);
    room.nextRoundTimeoutId = null;
  }

    // Se não há jogador conectado precisando decidir rebuy,
    // não usa o tempo completo da janela de rebuy.
    if (!hasConnectedChoices) {
      room.rebuyDecisionUntil = 0;

      const rebuys = applyPendingRebuys(room);
      room.lastAppliedRebuys = rebuys;

      // Recalcula vivos após aplicar os rebuys automáticos
      const aliveAfterRebuy = (room.playersBySeat || []).filter(pl => pl && !pl.eliminated);
      if (aliveAfterRebuy.length <= 1) {
        room.matchEnded = true;
        room.matchWinnerSeat = room.playersBySeat.indexOf(aliveAfterRebuy[0]) + 1;

        finalizeMatchEconomy(room);
        if (room?.id) sendState(room.id);
        return;
      }

      const nextRoundDelayMs = 1000;

      room.nextRoundTimeoutId = setTimeout(() => {
        room.nextRoundTimeoutId = null;
        room.rebuyDecisionUntil = 0;

        startNewRound(room);
        if (room?.id) sendState(room.id);
      }, nextRoundDelayMs);

      if (room?.id) sendState(room.id);
      return;
    }

    room.rebuyDecisionUntil = Date.now() + ms;

    if (room?.id) sendState(room.id);

    room.nextRoundTimeoutId = setTimeout(() => {
    room.nextRoundTimeoutId = null;
    room.rebuyDecisionUntil = 0;

    // quem está conectado e não aceitou até o fim = recusou
    for (const pl of room.playersBySeat || []) {
      if (!pl) continue;

      if (
        pl.eliminated === true &&
        pl.disconnected !== true &&
        pl.pendingRebuy !== true &&
        (pl.rebuyCount || 0) < 3
      ) {
        pl.rebuyDeclined = true;
      }
    }

    const rebuys = applyPendingRebuys(room);
    room.lastAppliedRebuys = rebuys;

    // Recalcula vivos após decisões/rebuys
    const aliveAfterWindow = (room.playersBySeat || []).filter(pl => pl && !pl.eliminated);
    if (aliveAfterWindow.length <= 1) {
      room.matchEnded = true;
      room.matchWinnerSeat = room.playersBySeat.indexOf(aliveAfterWindow[0]) + 1;

      finalizeMatchEconomy(room);
      if (room?.id) sendState(room.id);
      return;
    }

    startNewRound(room);
    if (room?.id) sendState(room.id);
  }, ms);
}

function canAddCardToMeld(room, meld, card) {
  if (!meld || !Array.isArray(meld.cards) || !card) return false;

  const merged = [...(meld.cards || []), card];

  // sequência
  if (meld.kind === "SEQUENCIA") {
    const v = validateMeldCards(room, merged);
    return !!v.ok;
  }

  // trinca
  if (meld.kind === "TRINCA") {
    const baseRank = meld.rankValue ?? getValor((meld.cards || [])[0]);

    if (getValor(card) !== baseRank) {
      return false;
    }

    if (room.variant === "classic") {
      const allowed = new Set((meld.lockedSuits || []).map(s => String(s)));
      if (!allowed.has(String(getNaipe(card)))) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function canCardBeAddedToAnyMeld(room, card) {
  const melds = room.tableMelds || [];

  for (const meld of melds) {
    if (!meld || !Array.isArray(meld.cards) || meld.cards.length === 0) continue;

    // TRINCA
    if (meld.kind === "TRINCA") {
  if (isClassic(room) && isJoker(card)) continue;

  const baseValor = getValor(meld.cards[0]);
  if (getValor(card) !== baseValor) continue;

  const currentSuits = [...new Set(meld.cards.map(c => getNaipe(c)).filter(Boolean))];
  const cardSuit = getNaipe(card);

  if (isClassic(room)) {
    if (!currentSuits.includes(cardSuit)) continue;
  }

  if (isCrazy(room)) {
    // no crazy só impede passar de 4 naipes diferentes
    const mergedSuits = [...new Set([...currentSuits, cardSuit].filter(Boolean))];
    if (mergedSuits.length > 4) continue;
  }

  return true;
  }

    // SEQUÊNCIA
    if (meld.kind === "SEQUENCIA") {
      const merged = [...meld.cards, card];
      const v = validateMeldCards(room, merged);
      if (v.ok) return true;
    }
  }

  return false;
  }


function validateCrazyTrincaShape(cards, { initial = false, forBatida = false } = {}) {
  if (!Array.isArray(cards)) {
    return { ok: false, msg: "Trinca inválida." };
  }

  if (cards.length < 3 || cards.length > 8) {
    return {
      ok: false,
      msg: initial
        ? "No crazy, a trinca inicial deve ter de 3 a 8 cartas."
        : "No crazy, a trinca deve ter de 3 a 8 cartas."
    };
  }

  const jokers = cards.filter(isJoker);
  const realCards = cards.filter(c => !isJoker(c));

  const suitCounts = {};
  for (const c of realCards) {
    const s = getNaipe(c);
    if (!s) continue;
    suitCounts[s] = (suitCounts[s] || 0) + 1;
  }

  const distinctRealSuitCount = Object.keys(suitCounts).length;
  const effectiveSuitCount = distinctRealSuitCount + jokers.length;

  const hasTooManySameSuit = Object.values(suitCounts).some(n => n > 2);

  if (forBatida) {
    if (effectiveSuitCount < 3) {
      return {
        ok: false,
        msg: "No crazy, para batida, a trinca precisa ter pelo menos 3 naipes diferentes. O coringa pode completar um naipe faltante."
      };
    }
  } else {
    if (distinctRealSuitCount < 3) {
      return {
        ok: false,
        msg: initial
          ? "A trinca inicial precisa ter pelo menos 3 naipes reais diferentes. Para bater, selecione TODAS as cartas da mão e abaixe os jogos juntos."
          : "No crazy, a trinca precisa manter pelo menos 3 naipes reais diferentes."
      };
    }
  }

  if (hasTooManySameSuit) {
    return {
      ok: false,
      msg: "No crazy, só pode haver até 2 cartas reais do mesmo naipe na trinca."
    };
  }

  return { ok: true };
}



function validateMeldCards(room, cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return { ok: false, msg: "Mínimo 3 cartas." };
  }

  const jokers = cards.filter(c => isMeldJoker(c, room));
  const nonJokers = cards.filter(c => !isMeldJoker(c, room));

  // ordena cartas reais por valor
  const sortedReal = [...nonJokers].sort((a, b) => {
    return valorToNumber(getValor(a)) - valorToNumber(getValor(b));
  });

  // se só tem joker, inválido
  if (nonJokers.length === 0) {
    return { ok: false, msg: "Sequência inválida." };
  }

    // -------------------------
  // TRINCA (base)
  // -------------------------
  {
    const valores = nonJokers.map(c => getValor(c));
    const allValorOk =
      valores.every(v => v != null) &&
      valores.every(v => v === valores[0]);

    if (allValorOk) {
      const hasJokerInTrinca = cards.some(c => isMeldJoker(c, room));

      if (isClassic(room) && hasJokerInTrinca) {
        return { ok: false, msg: "Trinca com coringa somente para bater no modo Crazy." };
      }

      if (isCrazy(room)) {
        const realCards = cards.filter(c => !isMeldJoker(c, room));
        const jokerCount = cards.length - realCards.length;

        const realSuits = realCards
          .map(c => getNaipe(c))
          .filter(Boolean);

        const uniqueRealSuits = new Set(realSuits);

        // Se NÃO tem coringa, exige pelo menos 3 naipes diferentes.
        if (jokerCount === 0 && uniqueRealSuits.size < 3) {
          return {
            ok: false,
            msg: "Trinca precisa ter pelo menos 3 naipes diferentes."
          };
        }

        // Se TEM coringa, o coringa não conta com o naipe físico dele.
        // Só as cartas reais precisam ter naipes diferentes entre si.
        if (jokerCount > 0 && uniqueRealSuits.size !== realSuits.length) {
          return {
            ok: false,
            msg: "Trinca inválida: naipes reais repetidos."
          };
        }

        // Validação antiga só deve rodar quando NÃO tem coringa.
        if (jokerCount === 0) {
          const crazyTrincaCheck = validateCrazyTrincaShape(cards, { initial: true });
          if (!crazyTrincaCheck.ok) {
            return crazyTrincaCheck;
          }
        }
      }

      return { ok: true, kind: "TRINCA" };
    }
  }

  // -------------------------
  // SEQUÊNCIA
  // Regra base:
  // - coringa no meio (gaveta) pode
  // - coringa na ponta NÃO valida aqui
  //   (a ponta fica reservada para a exceção de batida)
  // -------------------------
  const naipe = getNaipe(nonJokers[0]);
  if (!naipe) {
    return { ok: false, msg: "Sequência inválida." };
  }

  for (const c of nonJokers) {
    if (getNaipe(c) !== naipe) {
      return { ok: false, msg: "Sequência inválida." };
    }
  }

    function checkSequenceFlexible(ranksSortedAsc, jokersCount, opts = {}) {
    const minRank = opts.aceHigh ? 2 : 1;
    const maxRank = opts.aceHigh ? 14 : 13;

    // não pode repetir cartas reais
    for (let i = 0; i < ranksSortedAsc.length - 1; i++) {
      if (ranksSortedAsc[i] === ranksSortedAsc[i + 1]) {
        return { ok: false, msg: "Sequência inválida: cartas repetidas." };
      }
    }

    let internalNeeded = 0;

    for (let i = 0; i < ranksSortedAsc.length - 1; i++) {
      const a = ranksSortedAsc[i];
      const b = ranksSortedAsc[i + 1];
      const diff = b - a;

      if (diff === 1) continue;

      if (diff > 1) {
        internalNeeded += diff - 1;
        continue;
      }

      return { ok: false, msg: "Sequência inválida." };
    }

    if (internalNeeded > jokersCount) {
      return {
        ok: false,
        msg: "Sequência inválida: faltam cartas para completar a sequência."
      };
    }

    const leftover = jokersCount - internalNeeded;

    // Cachetão Pro:
    // coringa sobrando pode ir na ponta da sequência
    // Ex: 5♠ 6♠ CORINGA
    // Ex: CORINGA K♦ A♦
    // Ex: CORINGA CORINGA 3♣
    if (leftover > 0) {
      const first = ranksSortedAsc[0];
      const last = ranksSortedAsc[ranksSortedAsc.length - 1];

      const canExtendLeft = first - leftover >= minRank;
      const canExtendRight = last + leftover <= maxRank;

      // também permite dividir coringas nas duas pontas
      let canSplit = false;
      for (let left = 1; left < leftover; left++) {
        const right = leftover - left;
        if (first - left >= minRank && last + right <= maxRank) {
          canSplit = true;
          break;
        }
      }

      if (!canExtendLeft && !canExtendRight && !canSplit) {
        return { ok: false, msg: "Sequência inválida: coringa não encaixa na ponta." };
      }
    }

    return {
      ok: true,
      endJokers: leftover
    };
  }

  // ranks reais com A=1
  const ranksA1 = sortedReal.map(c => valorToNumber(getValor(c)));
  if (ranksA1.some(r => r == null)) {
    return { ok: false, msg: "Sequência inválida: valor inválido." };
  }

  // tenta com A=1 (Ás baixo)
  const attempt1 = checkSequenceFlexible([...ranksA1].sort((a, b) => a - b), jokers.length, { aceHigh: false });
  if (attempt1.ok) {
    return { ok: true, kind: "SEQUENCIA", naipe, aceHigh: false };
  }

  // tenta com A=14 (Ás alto), só se tiver Ás
  const hasAce = ranksA1.includes(1);
  if (hasAce) {
    const ranksA14 = ranksA1.map(r => (r === 1 ? 14 : r));
    const attempt2 = checkSequenceFlexible([...ranksA14].sort((a, b) => a - b), jokers.length, { aceHigh: true });
    if (attempt2.ok) {
      return { ok: true, kind: "SEQUENCIA", naipe, aceHigh: true };
    }
  }

  // se a tentativa com Ás alto falhar, mantemos a mensagem mais útil
  if (attempt1.msg === "Coringa na ponta só vale para batida no modo Crazy.") {
    return attempt1;
  }

  return attempt1;
}



function sortSequenceCards(cards, aceHigh) {
  const jokers = cards.filter(c => c.isJoker);
  const nonJokers = cards.filter(c => !c.isJoker);

  let ranks = nonJokers.map(c => ({
    card: c,
    rank: valorToNumber(c.valor)
  }));

  // ✅ se a validação disse que é Ás alto, transforma A=14
  if (aceHigh) {
    ranks = ranks.map(r => ({
      card: r.card,
      rank: r.rank === 1 ? 14 : r.rank
    }));
  }

  ranks.sort((a, b) => a.rank - b.rank);

  const ordered = [];
  for (let i = 0; i < ranks.length; i++) {
    ordered.push(ranks[i].card);

    if (i < ranks.length - 1) {
      const diff = ranks[i + 1].rank - ranks[i].rank;

      // ✅ encaixa o coringa exatamente no gap de 2 (gaveta)
      if (diff === 2 && jokers.length > 0) {
        ordered.push(jokers.shift());
      }
    }
  }

  // segurança: se sobrou joker (não deveria, pois validação já garante), NÃO some
  while (jokers.length > 0) ordered.push(jokers.shift());

  return ordered;
}

function makeReconnectToken() {
  return randomUUID();
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function heartbeat() {
  this.isAlive = true;
}

const wsHeartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log("[WS] conexão morta encerrada pelo heartbeat");
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => {
  clearInterval(wsHeartbeatInterval);
});

const PORT = Number(process.env.PORT) || 3000;
app.use(express.static("cachetao"));

function getCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader) return null;

  const cookies = String(cookieHeader).split(";");

  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

async function getAuthUserFromWsRequest(req) {
  try {
    const token = getCookieFromHeader(req.headers.cookie, "pontinho_token");

    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `
      SELECT id, username, email, chips_balance, is_admin, is_blocked, session_version
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.userId]
    );

    const user = result.rows[0];
    if (!user) return null;
    if (user.is_blocked === true) return null;

    const tokenSessionVersion = Number(decoded.sessionVersion || 1);
    const dbSessionVersion = Number(user.session_version || 1);

    if (tokenSessionVersion !== dbSessionVersion) return null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      chipsBalance: Number(user.chips_balance) || 0,
      isAdmin: user.is_admin === true || user.is_admin === 1,
    };
  } catch (err) {
    console.error("[WS AUTH] sessão inválida:", err.message);
    return null;
  }
}

// --------------------
// Config de mesas
// --------------------
const TABLES = [
  { id: "K1", name: "Mesa 1", buyIn: 1000, variant: "CACHETAO" },
  { id: "K2", name: "Mesa 2", buyIn: 5000, variant: "CACHETAO" },
  { id: "K3", name: "Mesa 3", buyIn: 10000, variant: "CACHETAO" },
  { id: "K4", name: "Mesa 4", buyIn: 20000, variant: "CACHETAO" },
  { id: "K5", name: "Mesa 5", buyIn: 50000, variant: "CACHETAO" },
  { id: "K6", name: "Mesa 6", buyIn: 100000, variant: "CACHETAO" }
];

const rooms = new Map();
for (const t of TABLES) {
  rooms.set(t.id, makeRoom(t));
}

const roomInstanceCounters = new Map();

for (const t of TABLES) {
  roomInstanceCounters.set(t.id, 1);
}

function getBaseTableConfig(tableGroupId) {
  return TABLES.find(t => String(t.id) === String(tableGroupId)) || null;
}

function hasFreeSeat(room, seat) {
  const s = Number(seat);
  return s >= 1 && s <= room.playersBySeat.length &&
         !room.playersBySeat?.[s - 1];
}

function findOrCreateRoomForGroup(tableGroupId, seat) {
  const groupId = String(tableGroupId);

  for (const room of rooms.values()) {
    const sameGroup = String(room.tableGroupId || room.id) === groupId;
    if (!sameGroup) continue;

    const canJoin =
      !room.started &&
      !room.matchEnded &&
      hasFreeSeat(room, seat);

    if (canJoin) {
      return room;
    }
  }

  const base = getBaseTableConfig(groupId);
  if (!base) return null;

  const nextNo = (Number(roomInstanceCounters.get(groupId)) || 1) + 1;
  roomInstanceCounters.set(groupId, nextNo);

  const newRoomId = `${groupId}#${nextNo}`;

  const room = makeRoom({
    ...base,
    id: newRoomId
  });

  room.tableGroupId = groupId;
  room.baseTableId = groupId;
  room.instanceNo = nextNo;

  rooms.set(newRoomId, room);
  return room;
}

const clients = new Map(); // clientId -> { ws, name, tableId, seat, mode }
const RECONNECT_GRACE_MS = 20000;

function makeRoom(t) {
  return {
    id: t.id,

    tableGroupId: t.tableGroupId || t.baseTableId || t.id,
    baseTableId: t.baseTableId || t.tableGroupId || t.id,
    instanceNo: Number(t.instanceNo) || 1,

    name: t.name,
    buyIn: Math.floor((Number(t.buyIn) || 1000) * 0.10), // 10% da mesa

    variant: String(t?.variant || "CLASSIC").toUpperCase(),

    playersBySeat: Array(10).fill(null),
    spectators: new Set(),
        deck: [],
    discard: [],
    tableMelds: [],

    // Cachetão Pro - vira/coringa da rodada
    cartaVira: null,
    coringaValor: null,
    coringaNaipes: [],

    started: false,
    startAt: 0,
    currentSeat: 1,
    phase: "COMPRAR",
    minPlayersToStart: 5, /* muda nº de jogadores para começar*/
    mustUseJokerBySeat: {},
    mustUseDiscardCardBySeat: {},

    roundEnded: false,
    matchEnded: false,
    matchWinnerSeat: null,
    winnerSeat: null,

    // rebuy / economia
    rebuyDecisionUntil: 0,
    nextRoundTimeoutId: null,
    _autoTurnScheduled: false,
    stake: Number(t.buyIn) || 1000,        // valor base da mesa
    miniAnte: 50,       // 5% da mesa por jogador por rodada
    pointValue: 5,      // cada ponto vale 5 fichas
    houseRakePct: 0.05, // 5% do pote final
    matchPot: 0,        // pote acumulado da partida
    matchId: null,
    roundNumber: 0,
    economicLogs: [],
    lastAppliedRebuys: [],
    lastMiniAnteCollected: 0,
    dealMs: 1200,
    dealEndsAt: 0,
    _dealStartTimer: null,
  };
}

// --------------------
// Baralho (exemplo)
// --------------------
// Ajuste aqui para bater com seu jogo (valores/naipes/coringas)
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

// 🔥 Formato compatível com o seu render.js / deck.js do front
let serverCardId = 0;

function makeDeck() {
  const suits = ["espadas", "copas", "ouros", "paus"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  const deck = [];

  // Cachetão Pro:
  // 2 baralhos de 52 cartas
  // Sem coringas impressos
  for (let copy = 1; copy <= 2; copy++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({
          id: `${rank}_${suit}_${copy}_${Math.random().toString(36).slice(2, 8)}`,
          valor: rank,
          naipe: suit
        });
      }
    }
  }

  return deck;
}

function getNextRank(rank) {
  const order = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const idx = order.indexOf(String(rank));

  if (idx < 0) return null;

  return order[(idx + 1) % order.length];
}

function getSameColorSuits(naipe) {
  if (naipe === "espadas" || naipe === "paus") {
    return ["espadas", "paus"];
  }

  if (naipe === "copas" || naipe === "ouros") {
    return ["copas", "ouros"];
  }

  return [];
}

function setupCachetaoRoundJoker(room) {
  if (!room || !Array.isArray(room.deck)) return;

  const vira = room.deck.pop();

  if (!vira) {
    room.cartaVira = null;
    room.coringaValor = null;
    room.coringaNaipes = [];

    room.viraNaMesa = false;
    room.viraDisponivelParaJogar = false;
    room.primeiroCompradorSeat = null;
    room.viraEmUsoPorSeat = null;

    return;
  }

  room.cartaVira = vira;
  room.coringaValor = getNextRank(vira.valor);
  room.coringaNaipes = getSameColorSuits(vira.naipe);

  // Nova rodada: restaura a nova vira na mesa
  room.viraNaMesa = true;
  room.viraDisponivelParaJogar = false;
  room.primeiroCompradorSeat = null;
  room.viraEmUsoPorSeat = null;

  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.jogandoComVira = false;
    p.viraBaixada = false;
    p.viraDescartada = false;
    p.batendoComVira = false;
  }
}

function isCachetaoJoker(card, room) {
  if (!card || !room) return false;

  return (
    String(card.valor) === String(room.coringaValor) &&
    Array.isArray(room.coringaNaipes) &&
    room.coringaNaipes.includes(card.naipe)
  );
}


function isMeldJoker(card, room) {
  return isJoker(card) || isCachetaoJoker(card, room);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --------------------
// Helpers WS
// --------------------
function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, payload }));
}

function broadcastToRoom(roomId, type, payload) {
  for (const c of clients.values()) {
    if (c.tableId === roomId && c.ws.readyState === c.ws.OPEN) {
      send(c.ws, type, payload);
    }
  }
}


function getOnlineStatusSnapshot() {
  let onlinePlayers = 0;

  for (const [, client] of clients) {
    if (client?.ws?.readyState === 1) {
      onlinePlayers++;
    }
  }

  let openTables = 0;

  for (const room of rooms.values()) {
    const hasPlayers = (room.playersBySeat || []).some(Boolean);
    const hasSpectators = room.spectators && room.spectators.size > 0;

    if (hasPlayers || hasSpectators || room.started) {
      openTables++;
    }
  }

  return {
    onlinePlayers,
    openTables
  };
}

function broadcastOnlineStatus() {
  const snapshot = getOnlineStatusSnapshot();

  for (const [, client] of clients) {
    if (!client?.ws || client.ws.readyState !== 1) continue;

    client.ws.send(JSON.stringify({
      type: "online_status",
      payload: snapshot
    }));
  }
}




function applyRoundPointPayments(room, winnerSeat) {
  const pointValue = getPointValue(room);
  const transfers = [];

  const winner = room.playersBySeat?.[winnerSeat - 1];
  if (!winner) return transfers;

  winner.tableChips = Number(winner.tableChips) || 0;

  for (let i = 0; i < (room.playersBySeat || []).length; i++) {
    const p = room.playersBySeat[i];
    if (!p) continue;
    if (i + 1 === winnerSeat) continue;
    if (p.eliminated) continue;

    p.tableChips = Number(p.tableChips) || 0;

    const points = Number(p.lastRoundPoints) || 0;
    const chipsToPay = points * pointValue;
    const paid = Math.min(p.tableChips, chipsToPay);

    // paga os pontos da mão para o vencedor
    p.tableChips -= paid;
    winner.tableChips += paid;

    // NÃO elimina por tableChips zerado aqui

    transfers.push({
      fromSeat: i + 1,
      toSeat: winnerSeat,
      points,
      chips: paid,
      fullyPaid: paid >= chipsToPay
    });
  }

  return transfers;
}



function pushRoundEconomicLog(room, winnerSeat, pointTransfers, miniAnteCollected = 0, rebuys = []) {
  room.economicLogs = room.economicLogs || [];

  room.economicLogs.push({
    type: "round_end",
    tableId: room.id,
    matchId: room.matchId,
    roundNumber: room.roundNumber,
    timestamp: Date.now(),

    variant: room.variant,
    tableStake: room.stake,

    roundWinnerSeat: winnerSeat,
    pointValue: getPointValue(room),
    pointTransfers,
    miniAntePerPlayer: getMiniAnte(room),
    miniAnteCollected,
    rebuys,

    matchPot: Number(room.matchPot) || 0,

    seats: (room.playersBySeat || []).map((p, idx) =>
      p ? {
        seat: idx + 1,
        name: p.name,
        chips: Number(p.chips) || 0,
        totalPoints: Number(p.totalPoints) || 0,
        lastRoundPoints: Number(p.lastRoundPoints) || 0,
        eliminated: !!p.eliminated,
        rebuyCount: Number(p.rebuyCount) || 0
      } : null
    )
  });
}

function roomSnapshotPublic(room) {
  const mesaStack = (Number(room?.buyIn) || 0) * 10;

  const seats = room.playersBySeat.map((p, i) => p ? ({
    seat: i + 1,
    name: p.name,
    chips: p.chips,
    tableChips: typeof p.tableChips === "number" ? p.tableChips : mesaStack,
    avatarUrl: p.avatarUrl || null,
    disconnected: !!p.disconnected
  }) : null);


  return {
    id: room.id,
    name: room.name,
    buyIn: room.buyIn,
    ante: Math.ceil((room.buyIn || 0) / 2),
    started: room.started,
    startAt: room.startAt || 0,
    minPlayersToStart: room.minPlayersToStart || 2,
    currentSeat: room.currentSeat,
    phase: room.phase,
    seats,
    tableMelds: room.tableMelds,
    discardTop: room.discard.at(-1) || null,
    deckCount: room.deck.length,
    spectators: room.spectators.size,
  };
}


function broadcastLobbyTable(room) {
  const groupId = String(room.tableGroupId || room.baseTableId || room.id);
  const lobbyRoom = getLobbyRoomForGroup(groupId) || room;

  const snapshot = roomSnapshotPublic(lobbyRoom);

  // importante: no lobby, o card continua sendo o id base: C1, C2...
  snapshot.id = groupId;
  snapshot.realRoomId = lobbyRoom.id;

  for (const [, client] of clients) {
    if (!client?.ws || client.ws.readyState !== 1) continue;

    // Não manda snapshot de lobby para quem está dentro de uma room real diferente.
    // Isso evita misturar C1 com C1#2 durante o jogo.
    if (
        client.tableId &&
        client.tableId !== snapshot.realRoomId
      ) {
      continue;
    }

    client.ws.send(JSON.stringify({
      type: "table_public",
      payload: snapshot
    }));
  }
}

function getLobbyRoomForGroup(tableGroupId) {
  const groupId = String(tableGroupId);

  // prioridade 1: room do grupo que ainda não começou
  for (const room of rooms.values()) {
    if (String(room.tableGroupId || room.id) !== groupId) continue;

    if (!room.started && !room.matchEnded) {
      return room;
    }
  }

  // prioridade 2: se todas começaram, cria nova instância vazia
  const base = getBaseTableConfig(groupId);
  if (!base) return rooms.get(groupId) || null;

  return findOrCreateRoomForGroup(groupId, 1);
}

function isBaseRoom(room) {
  return String(room.id) === String(room.baseTableId || room.tableGroupId || room.id);
}

function isRoomEmpty(room) {
  const hasPlayers = (room.playersBySeat || []).some(Boolean);
  const hasSpectators = room.spectators && room.spectators.size > 0;

  return !hasPlayers && !hasSpectators;
}

function cleanupEmptyRoomInstances() {
  for (const [roomId, room] of rooms.entries()) {
    if (!room) continue;
    if (isBaseRoom(room)) continue;
    if (room.started && !room.matchEnded) continue;
    if (!isRoomEmpty(room)) continue;

    rooms.delete(roomId);
    console.log("[ROOM CLEANUP] removida instância vazia:", roomId);
  }
}


async function persistMatchStats(room) {
  try {
    if (!room?.playersBySeat?.length) return;

    const winnerSeat = Number(room.matchWinnerSeat) || 0;

    for (let seat = 1; seat <= room.playersBySeat.length; seat++) {
    const p = room.playersBySeat[seat - 1];

      if (!p?.userId) continue;

      const startChips = Number(p.matchStartChips);
      const endChips = Number(p.chips) || 0;

      await pool.query(
        `
        UPDATE users
        SET chips_balance = $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [endChips, p.userId]
      );


      if (!Number.isFinite(startChips)) continue;

      const delta = endChips - startChips;
      const isWinner = seat === winnerSeat;

      const profitToAdd = delta > 0 ? delta : 0;
      const lossToAdd = delta < 0 ? Math.abs(delta) : 0;

      await pool.query(
        `
        INSERT INTO user_stats (
          user_id,
          matches_played,
          wins,
          losses,
          total_profit,
          total_loss,
          updated_at
        )
        VALUES ($1, 1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          matches_played = user_stats.matches_played + 1,
          wins = user_stats.wins + EXCLUDED.wins,
          losses = user_stats.losses + EXCLUDED.losses,
          total_profit = user_stats.total_profit + EXCLUDED.total_profit,
          total_loss = user_stats.total_loss + EXCLUDED.total_loss,
          updated_at = NOW()
        `,
        [
          p.userId,
          isWinner ? 1 : 0,
          isWinner ? 0 : 1,
          profitToAdd,
          lossToAdd,
        ]
      );
    }
  } catch (err) {
    console.error("persistMatchStats error:", err);
  }
}

function finalizeMatchEconomy(room) {
  const winnerSeat = room.matchWinnerSeat;
  const winner = room.playersBySeat?.[winnerSeat - 1];
  if (!winner) return;

  const rake = getHouseRake(room);
  const payout = getWinnerPayout(room);

  winner.chips += payout;

  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.chips = Number(p.chips) || 0;
    p.tableChips = Number(p.tableChips) || 0;

    p.chips += p.tableChips;
    p.tableChips = 0;
  }

  persistMatchStats(room);

  room.economicLogs = room.economicLogs || [];
  room.economicLogs.push({
    type: "match_end",
    tableId: room.id,
    matchId: room.matchId,
    timestamp: Date.now(),

    variant: room.variant,
    tableStake: room.stake,

    winnerSeat,
    winnerName: winner.name,

    matchPot: Number(room.matchPot) || 0,
    houseRakePct: getHouseRakePct(room),
    houseRake: rake,
    winnerPayout: payout,

    roundsPlayed: Number(room.roundNumber) || 0,

    finalSeats: (room.playersBySeat || []).map((p, idx) =>
      p ? {
        seat: idx + 1,
        name: p.name,
        chips: Number(p.chips) || 0,
        totalPoints: Number(p.totalPoints) || 0,
        eliminated: !!p.eliminated,
        rebuyCount: Number(p.rebuyCount) || 0
      } : null
    )
  });
}

function sendState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.version = (room.version ?? 0) + 1;

  const payload = {
    tableId: room.id,
    version: room.version,
    started: !!room.started,
    phase: room.phase,
    currentSeat: room.currentSeat,
    dealerSeat: Number(room.dealerSeat) || 0,
    buyIn: room.buyIn,
    maxSeats: room.playersBySeat.length,
    ante: Math.ceil((room.buyIn || 0) / 2),
    variant: getRoomVariant(room),
    turnEndsAt: Number(room.turnEndsAt) || 0,
    turnMs: Number(room.turnMs) || 30000,
    buyEndsAt: Number(room.buyEndsAt) || 0,
    buyMs: Number(room.buyMs) || 15000,
    dealEndsAt: Number(room.dealEndsAt) || 0,
    dealMs: Number(room.dealMs) || 1200,
    matchEnded: room.matchEnded || false,
    matchWinnerSeat: room.matchWinnerSeat || null,
    /*rematchRequestedBySeat: room.rematchRequestedBySeat || null,*/
    deckCount: room.deck.length,
    discardTop: room.discard?.[room.discard.length - 1] || null,
    cartaVira: room.cartaVira || null,
    viraDisponivelParaJogar: !!room.viraDisponivelParaJogar,
    primeiroCompradorSeat: Number(room.primeiroCompradorSeat) || 0,
    viraEmUsoPorSeat: Number(room.viraEmUsoPorSeat) || 0,
    viraNaMesa: room.viraNaMesa !== false,
    coringaValor: room.coringaValor || null,
    coringaNaipes: Array.isArray(room.coringaNaipes) ? room.coringaNaipes : [],
    matchPot: Number(room.matchPot) || 0,
    houseRakePct: getHouseRakePct(room),
    houseRake: getHouseRake(room),
    winnerPayout: getWinnerPayout(room),
    roundNumber: Number(room.roundNumber) || 0,
    batidaAnnouncement: String(room.batidaAnnouncement || ""),
    batidaAnnouncementEndsAt: Number(room.batidaAnnouncementEndsAt) || 0,
    roundAnnouncement: String(room.roundAnnouncement || ""),
    roundAnnouncementEndsAt: Number(room.roundAnnouncementEndsAt) || 0,
    crazyBatidaAttemptActive: !!room.crazyBatidaAttempt?.active,
    crazyBatidaAttemptSeat: Number(room.crazyBatidaAttempt?.claimantSeat) || 0,
    crazyBatidaAttemptPrioritySeat: Number(room.crazyBatidaAttempt?.prioritySeat) || 0,
    crazyBatidaAttemptExpiresAt: Number(room.crazyBatidaAttempt?.expiresAt) || 0,
    crazyBatidaAttemptUsesVira: !!room.crazyBatidaAttempt?.usesVira,
    crazyBatidaBurnedBySeat: room.crazyBatidaBurnedBySeat || {},

    // ✅ esses campos são da rodada/sala, não do jogador
    roundEnded: !!room.roundEnded,
    winnerSeat: room.winnerSeat ?? null,
    rebuyDecisionUntil: room.rebuyDecisionUntil || 0,
    startAt: room.startAt || 0,
    minPlayersToStart: room.minPlayersToStart || 5,

    seats: room.playersBySeat.map((p, idx) =>
      p ? {
        seat: idx + 1,
        name: p.name,
        avatarUrl: p.avatarUrl || "/assets/avatars/avatar-01.png",
        chips: p.chips,
        tableChips: typeof p.tableChips === "number"
          ? p.tableChips
          : (((Number(room.buyIn) || 0) * 10) - (Number(room.buyIn) || 0)),
        totalPoints: typeof p.vidas === "number" ? p.vidas : (p.totalPoints || 0),
        vidas: typeof p.vidas === "number" ? p.vidas : 10,
        lastRoundPoints: p.lastRoundPoints || 0,
        handCount: Array.isArray(p.hand) ? p.hand.length : 0,
        eliminated: !!p.eliminated,
        participando: !!p.participando,
        passouRodada: !!p.passouRodada,
        rebuyCount: p.rebuyCount || 0,
        pendingRebuy: !!p.pendingRebuy,
        rebuyDeclined: !!p.rebuyDeclined,
        disconnected: !!p.disconnected,
      } : null
    ),

    tableMelds: room.tableMelds || []
  };

    for (let seat = 1; seat <= room.playersBySeat.length; seat++) {
  const player = room.playersBySeat[seat - 1];
  if (!player) continue;

    const client = clients.get(player.clientId);
    if (!client?.ws || client.ws.readyState !== 1) continue;

    client.ws.send(JSON.stringify({
      type: "state_public",
      payload
    }));

      client.ws.send(JSON.stringify({
      type: "state_private",
      payload: {
        seat,
        hand: player.hand,
        canRematch: !!room.matchEnded
      }
    }));
  }

  // ✅ espectadores também recebem estado público
  for (const spectatorClientId of room.spectators || []) {
    const spectator = clients.get(spectatorClientId);
    if (!spectator?.ws || spectator.ws.readyState !== 1) continue;

    spectator.ws.send(JSON.stringify({
      type: "state_public",
      payload
    }));
  }
  broadcastLobbyTable(room);
  scheduleAutoTurn(room);
}


function connectedSeatedCount(room) {
  if (!room?.playersBySeat) return 0;

  return room.playersBySeat.filter(p => {
    if (!p) return false;
    if (p.disconnected === true) return false;
    if (p.eliminated === true) return false;
    if (p.nextMatchReady === false) return false;
    return true;
  }).length;
}

/* H E L P E R S */

function clearStartTimer(room) {
  if (!room?._startTimerId) return;
  clearTimeout(room._startTimerId);
  room._startTimerId = null;
}

function resetStartCountdown(room) {
  if (!room) return;
  room.startAt = 0;
  clearStartTimer(room);
}

function getClientPlayer(room, client) {
  const seat = client?.seat;
  if (!seat) return null;
  return room?.playersBySeat?.[seat - 1] || null;
}

function isOutOfTurnAllowed(actionType) {
  return (
    actionType === "rebuy" ||
    actionType === "declineRebuy" ||
    actionType === "startCrazyBatidaAttempt" ||
    actionType === "startBatidaComViraAttempt" ||
    actionType === "cancelCrazyBatidaAttempt"
  );
}

function clearClientTableState(client) {
  if (!client) return;
  client.tableId = null;
  client.seat = null;
  client.mode = null;
}

function removeClientFromSpectators(room, clientId) {
  if (!room?.spectators) return;
  room.spectators.delete(clientId);
}

function removePlayerFromSeat(room, seat, clientId) {
  if (!room || !seat) return false;

  const p = room.playersBySeat?.[seat - 1];
  if (!p || p.clientId !== clientId) return false;

  // Se a partida ainda não começou, devolve somente as fichas reservadas da mesa
  if (!room.started && !room.matchEnded) {
    const tableChips = Number(p.tableChips) || 0;
    const refund = tableChips;

    p.chips = Number(p.chips) || 0;
    p.chips += refund;
    p.tableChips = 0;

    const client = clients.get(clientId);
    if (client) {
      client.chips = Number(client.chips) || 0;
      client.chips += refund;
      client.chipsBalance = client.chips;
    }
  }

  room.playersBySeat[seat - 1] = null;
  return true;
}

function joinAsSpectator(room, client, clientId, tableId, ws) {
  room.spectators.add(clientId);

  client.tableId = tableId;
  client.seat = null;
  client.mode = "spectator";

  send(ws, "joined", { tableId, mode: "spectator" });
  broadcastRoomState(room);
}

function attachClientToExistingPlayer(existing, client, clientId, tableId, seat) {
  if (existing.disconnectTimer) {
    clearTimeout(existing.disconnectTimer);
    existing.disconnectTimer = null;
  }

  existing.clientId = clientId;
  existing.disconnected = false;
  existing.disconnectDeadline = 0;

  client.tableId = tableId;
  client.seat = seat;
  client.mode = "player";
  client.name = existing.name;
  client.avatarUrl = existing.avatarUrl;
}


function createPlayerForSeat(room, seat, clientId, client, avatarUrl) {
  const buyIn = Number(room?.buyIn) || 0;
  const mesaStack = buyIn * 10;
  const mesaStackLiquido = mesaStack - buyIn;

  const saldoAtual = Number(client.chips ?? client.chipsBalance ?? 0);

  // cobra buy-in do saldo geral
  /*client.chips = saldoAtual - mesaStack;*/ // caso queira cobrar o stack completo já no buy-in, use mesaStack ao invés de mesaStackLiquido
  client.chips = saldoAtual - mesaStackLiquido;
  client.chipsBalance = client.chips;

  room.matchPot = Number(room.matchPot) || 0;
  room.matchPot += buyIn;

  room.playersBySeat[seat - 1] = {
    clientId,
    userId: client.userId || client.user?.id || null,

    reconnectToken: makeReconnectToken(),
    name: client.name,
    avatarUrl: avatarUrl || "/assets/avatars/avatar-01.png",

    // saldo geral já com buy-in descontado
    chips: client.chips,

    // fichas da mesa
    tableChips: mesaStackLiquido,

    hand: [],

    // Cachetão Pro
    vidas: 10,
    participando: false,
    passouRodada: false,
    marrou: false,

    // Mantidos por enquanto para não quebrar telas antigas
    totalPoints: 0,
    lastRoundPoints: 0,

    eliminated: false,

    rebuyCount: 0,
    pendingRebuy: false,
    rebuyDeclined: false,
    pendingBatidaAfterDiscard: false,

    disconnected: false,
    nextMatchReady: true,
    disconnectDeadline: 0,
    disconnectTimer: null,

    jogosBaixados: [],
    obrigacaoBaixar: false,
  };

  return room.playersBySeat[seat - 1];
}


function ensurePhase(room, allowedPhases) {
  if (!room) return { ok: false, msg: "Mesa inexistente." };

  const phases = Array.isArray(allowedPhases) ? allowedPhases : [allowedPhases];
  if (!phases.includes(room.phase)) {
    return { ok: false, msg: "Fase inválida." };
  }

  return { ok: true };
}

function goToBuyPhase(room) {
  room.phase = "COMPRAR";
}

function goToLayPhase(room) {
  room.phase = "BAIXAR";
}

function advanceTurn(room) {
  const totalSeats = room.playersBySeat?.length || 10;
  let current = Number(room.currentSeat || 0);

    // Cachetão Pro:
  // ao sair do turno do primeiro comprador, encerra definitivamente
  // a opção de Jogar com a Vira.
  if (
    room.viraDisponivelParaJogar &&
    Number(room.currentSeat) === Number(room.primeiroCompradorSeat)
  ) {
    room.viraDisponivelParaJogar = false;
    room.primeiroCompradorSeat = null;
  }

  for (let i = 0; i < totalSeats; i++) {
    current++;

    if (current > totalSeats) current = 1;

    const p = room.playersBySeat?.[current - 1];

    if (!p) continue;
    if (p.eliminated) continue;
    if (p.passouRodada) continue;
    if (!p.participando) continue;

    room.currentSeat = current;
    room.phase = "COMPRAR";
    startTurnClock(room);
    return;
  }

  // Segurança: se ninguém puder jogar, encerra a rodada
  room.roundEnded = true;
  room.phase = "WAITING";
  room.turnEndsAt = 0;
  room.buyEndsAt = 0;

  sendState(room.id);
}

function broadcastRoomState(room) {
  if (!room?.id) return;
  if (room?.id) sendState(room.id);
}

function getRoomVariant(room) {
  return String(room?.variant || "CLASSIC").toUpperCase();
}

function isClassic(room) {
  return getRoomVariant(room) === "CLASSIC";
}

function isCrazy(room) {
  const variant = getRoomVariant(room);
  return (
    variant === "CRAZY" ||
    variant === "CACHETAO" ||
    variant === "CACHETAO_PRO"
  );
}

function ensureDiscardStateMaps(room) {
  room.mustUseDiscardCardBySeat = room.mustUseDiscardCardBySeat || {};
  room.mustUseJokerBySeat = room.mustUseJokerBySeat || {};
}

function ensureDiscardLockState(room) {
  room.discardLockForSeat = room.discardLockForSeat || null;
  room.discardLockCardId = room.discardLockCardId || null;
}

function getRequiredDiscardCardId(room, seat) {
  ensureDiscardStateMaps(room);
  return room.mustUseDiscardCardBySeat[seat];
}

function getRequiredJokerCardId(room, seat) {
  ensureDiscardStateMaps(room);
  return room.mustUseJokerBySeat[seat];
}

function markDiscardCardRequired(room, seat, cardId) {
  ensureDiscardStateMaps(room);
  room.mustUseDiscardCardBySeat[seat] = cardId;
}

function markJokerRequired(room, seat, cardId) {
  ensureDiscardStateMaps(room);
  room.mustUseJokerBySeat[seat] = cardId;
}

function clearRequiredDiscardCard(room, seat) {
  ensureDiscardStateMaps(room);
  delete room.mustUseDiscardCardBySeat[seat];
}

function clearRequiredJoker(room, seat) {
  ensureDiscardStateMaps(room);
  delete room.mustUseJokerBySeat[seat];

  ensurePendingJokerReturnState(room);
  delete room.pendingJokerReturnBySeat[seat];
}

function ensurePendingJokerReturnState(room) {
  room.pendingJokerReturnBySeat = room.pendingJokerReturnBySeat || {};
}

function markPendingJokerReturn(room, seat, payload) {
  ensurePendingJokerReturnState(room);
  room.pendingJokerReturnBySeat[seat] = payload;
}

function getPendingJokerReturn(room, seat) {
  ensurePendingJokerReturnState(room);
  return room.pendingJokerReturnBySeat[seat] || null;
}

function clearPendingJokerReturn(room, seat) {
  ensurePendingJokerReturnState(room);
  delete room.pendingJokerReturnBySeat[seat];
}

function revertPendingJokerReturn(room, seat, player) {
  const pending = getPendingJokerReturn(room, seat);
  if (!pending || !player) return false;

  const meld = room.tableMelds?.[pending.meldIndex];
  if (!meld || !Array.isArray(meld.cards)) {
    clearPendingJokerReturn(room, seat);
    clearRequiredJoker(room, seat);
    return false;
  }

  const jokerInHandIdx = (player.hand || []).findIndex(
    c => String(c?.id) === String(pending.jokerId)
  );
  if (jokerInHandIdx < 0) {
    clearPendingJokerReturn(room, seat);
    clearRequiredJoker(room, seat);
    return false;
  }

  const realCardIdxInMeld = meld.cards.findIndex(
    c => String(c?.id) === String(pending.realCardId)
  );
  if (realCardIdxInMeld < 0) {
    clearPendingJokerReturn(room, seat);
    clearRequiredJoker(room, seat);
    return false;
  }

  const jokerCard = player.hand.splice(jokerInHandIdx, 1)[0];
  const realCard = meld.cards[realCardIdxInMeld];

  meld.cards[realCardIdxInMeld] = jokerCard;
  player.hand.push(realCard);

  clearPendingJokerReturn(room, seat);
  clearRequiredJoker(room, seat);
  return true;
}

function clearDiscardLock(room) {
  ensureDiscardLockState(room);
  room.discardLockForSeat = null;
  room.discardLockCardId = null;
}

function lockDiscardForNextSeat(room, cardId) {
  ensureDiscardLockState(room);
  room.discardLockForSeat = nextOccupiedSeat(room, room.currentSeat);
  room.discardLockCardId = cardId;
}

function isDiscardLockedForSeat(room, seat, topCard) {
  ensureDiscardLockState(room);

  return (
    room.discardLockForSeat === seat &&
    room.discardLockCardId != null &&
    topCard != null &&
    String(topCard.id) === String(room.discardLockCardId)
  );
}



function shouldForceBatida(room, player) {
  const hand = player.hand || [];
  if (hand.length === 0) return true;

  const jokers = hand.filter(c => isJoker(c));
  const nonJokers = hand.filter(c => !isJoker(c));

  // 1) só coringa(s) na mão -> não pode descartar -> bate
  if (jokers.length > 0 && nonJokers.length === 0) {
    return true;
  }

  // 2) exatamente 1 coringa + 1 carta real que entra obrigatoriamente na mesa
  // -> caso raro aceito por você
  if (hand.length === 2 && jokers.length === 1 && nonJokers.length === 1) {
    const real = nonJokers[0];
    if (
      canCardBeAddedToAnyMeld(room, real) ||
      canCardReplaceAnyJokerOnTable(room, real)
    ) {
      return true;
    }
  }

  // Fora desses casos raros, NÃO força batida automática
  return false;
}

function handlePlayWithViraAction(room, player, playerSeat) {
  const phaseCheck = ensurePhase(room, "COMPRAR");
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  if (!room.cartaVira) {
    return {
      ok: false,
      msg: "A vira desta rodada não está disponível."
    };
  }

  if (!room.viraDisponivelParaJogar) {
    return {
      ok: false,
      msg: "A opção de jogar com a vira já foi encerrada."
    };
  }

  if (Number(playerSeat) !== Number(room.primeiroCompradorSeat)) {
    return {
      ok: false,
      msg: "Somente o primeiro jogador da rodada pode jogar com a vira."
    };
  }

  if (Number(room.currentSeat) !== Number(playerSeat)) {
    return {
      ok: false,
      msg: "Não é sua vez."
    };
  }

  if (player.jogandoComVira) {
    return {
      ok: false,
      msg: "Você já declarou que está jogando com a vira."
    };
  }

  // Não coloca a vira fisicamente na mão.
  // Ela continuará na mesa e precisará ser selecionada em um jogo.
  player.jogandoComVira = true;
  player.viraBaixada = false;
  player.viraDescartada = false;
  room.viraNaMesa = true;

  room.viraEmUsoPorSeat = playerSeat;
  room.viraDisponivelParaJogar = false;

  goToLayPhase(room);
  room.buyEndsAt = 0;

  return null;
}

function handleDrawDeckAction(room, player, playerSeat) {
  const phaseCheck = ensurePhase(room, "COMPRAR");
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  // A primeira compra normal encerra a opção de jogar com a vira.
  if (
    room.viraDisponivelParaJogar &&
    Number(playerSeat) === Number(room.primeiroCompradorSeat)
  ) {
    room.viraDisponivelParaJogar = false;
  }

  const card = room.deck.pop();
  if (!card) {
    endRoundByEmptyDeck(room);
    return null;
  }

  player.hand = player.hand || [];
  player.hand.push(card);

  // se este era o jogador bloqueado do lixo e escolheu comprar do monte,
  // a trava anti-"3 cantos" se encerra
  if (room.discardLockForSeat === playerSeat) {
    clearDiscardLock(room);
  }

  goToLayPhase(room);
  room.buyEndsAt = 0;
  return null;
}



function handleDiscardAction(room, player, playerSeat, action) {
  const phaseCheck = ensurePhase(room, ["BAIXAR", "DESCARTAR"]);
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  const requiredDiscard = getRequiredDiscardCardId(room, playerSeat);
  const requiredJoker = getRequiredJokerCardId(room, playerSeat);

  const cardId =
    action?.cardId ??
    action?.payload?.cardId ??
    action?.card?.id;

    const descartandoVira =
    String(cardId) === "__VIRA__";

    if (
      player.batendoComVira &&
      descartandoVira
    ) {
      return {
        ok: false,
        msg: "No BATI com a vira, ela precisa ser usada em um jogo."
      };
    }

    if (
      player.batendoComVira &&
      !player.viraBaixada
    ) {
      return {
        ok: false,
        msg: "Use a vira em um dos jogos antes de descartar."
      };
    }

  if (cardId === undefined || cardId === null || cardId === "") {
    return { ok: false, msg: "Ação inválida." };
  }

  let idx = -1;
  let card = null;

  if (descartandoVira) {
    if (!player.jogandoComVira) {
      return {
        ok: false,
        msg: "Você não está jogando com a vira."
      };
    }

    if (player.viraBaixada) {
      return {
        ok: false,
        msg: "A vira já foi usada em um jogo."
      };
    }

    if (player.viraDescartada) {
      return {
        ok: false,
        msg: "A vira já foi descartada."
      };
    }

    if (!room.viraNaMesa || !room.cartaVira) {
      return {
        ok: false,
        msg: "A vira não está mais disponível."
      };
    }

    if (
      Number(room.viraEmUsoPorSeat) !== Number(playerSeat)
    ) {
      return {
        ok: false,
        msg: "A vira não pertence a este jogador."
      };
    }

    card = room.cartaVira;
  } else {
    idx = (player.hand || []).findIndex(
      c => String(c.id) === String(cardId)
    );

    if (idx < 0) {
      return { ok: false, msg: "Carta inválida." };
    }

    card = player.hand[idx];
  }
  const ownMelds = (room.tableMelds || []).filter(m => Number(m.seat) === Number(playerSeat));

  // Cachetão Pro:
  // Se baixou jogo mas ainda não está em batida com descarte,
  // tentou descartar sem bater: volta tudo para a mão e Queimou.
  if (ownMelds.length > 0 && !player.pendingBatidaAfterDiscard) {
    devolverJogosDoJogadorParaMao(room, playerSeat);
    markCrazyBatidaBurned(room, playerSeat);

    return {
      ok: false,
      msg: "Batida inválida. Você queimou."
    };
  }

    // Cachetão Pro: não pode descartar o coringa da rodada
  if (!descartandoVira && isCachetaoJoker(card, room)) {
    return {
      ok: false,
      msg: "Não é permitido descartar o coringa da rodada."
    };
  }

  clearDiscardLock(room);

  if (descartandoVira) {
    player.viraDescartada = true;
    player.viraBaixada = false;
    player.jogandoComVira = false;

    room.viraNaMesa = false;
    room.viraEmUsoPorSeat = null;
  } else {
    player.hand.splice(idx, 1);
  }
  room.discard.push(card);

  if (requiredDiscard != null && String(card.id) === String(requiredDiscard)) {
    clearRequiredDiscardCard(room, playerSeat);
    lockDiscardForNextSeat(room, card.id);
  }

  if ((player.hand || []).length === 0 || player.pendingBatidaAfterDiscard) {
    player.pendingBatidaAfterDiscard = false;
    endRound(room, playerSeat);
    return null;
  }

  advanceTurn(room);
  return null;
}


function refreshStartCountdown(room) {
  if (!room) return;

  // Só bloqueia se existe partida ativa.
  // Se matchEnded === true, pode iniciar novo countdown.
  if (room.started && !room.matchEnded) return;

  const minPlayers = Number(room.minPlayersToStart) || 2;
  const count = connectedSeatedCount(room);

  if (count < minPlayers) {
    resetStartCountdown(room);
    clearAutoTurnTimer(room);
    room.turnEndsAt = 0;
    room._autoTurnSeat = null;
    room.buyEndsAt = 0;
    return;
  }

  if (!room.startAt) {
    room.startAt = Date.now() + 30000;
  }

  broadcastRoomState(room);
  broadcastLobbyTable(room);
  scheduleMatchStart(room);
}

function seatedCount(room) {
  return room.playersBySeat.filter(Boolean).length;
}





function tryStartMatch(room) {

  const minPlayers = Number(room.minPlayersToStart) || 2;
  const count = connectedSeatedCount(room);

  if (room.started && !room.matchEnded) {
    return;
  }

  if (count < minPlayers) {
    resetStartCountdown(room);
    broadcastRoomState(room);
    return;
  }

  if (!room.startAt) {
    room.startAt = Date.now() + 30000;
    broadcastRoomState(room);
    scheduleMatchStart(room);
    return;
  }

  const msLeft = room.startAt - Date.now();

  if (msLeft > 0) {
    scheduleMatchStart(room);
    return;
  }

  resetStartCountdown(room);

// RESET COMPLETO DE NOVA PARTIDA
room.matchEnded = false;
room.roundEnded = false;
room.matchWinnerSeat = null;
room.winnerSeat = null;
room.rebuyDecisionUntil = 0;
room.lastAppliedRebuys = [];

if (room.nextRoundTimeoutId) {
  clearTimeout(room.nextRoundTimeoutId);
  room.nextRoundTimeoutId = null;
}

room.deck = [];
room.discard = [];
room.tableMelds = [];
room.mustUseJokerBySeat = {};
room.mustUseDiscardCardBySeat = {};

const stake = Number(room.stake) || 1000;
const initialTableChips = Math.max(0, stake - getBuyIn(room));

  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.tableChips = initialTableChips;

    p.eliminated = false;
    p.pendingRebuy = false;
    p.rebuyDeclined = false;
    p.pendingBatidaAfterDiscard = false;
    p.rebuyCount = 0;

    p.totalPoints = 0;
    p.lastRoundPoints = 0;
    p.vidas = 10;
    p.participando = false;
    p.passouRodada = false;
    p.marrou = false;
    p.hand = [];
    p.jogosBaixados = [];
    p.obrigacaoBaixar = false;
  }




  room.started = true;
  room.phase = "DEALING";
  broadcastLobbyTable(room);

  room.matchEnded = false;
  room.roundEnded = false;
  room.matchWinnerSeat = null;
  room.winnerSeat = null;
  room.rebuyDecisionUntil = 0;
  room.currentSeat = null;
  room.turnEndsAt = 0;
  room.buyEndsAt = 0;
  room._autoTurnSeat = null;

  room.deck = [];
  room.discard = [];
  room.tableMelds = [];
/*
  // dealer rotativo: quem compra primeiro é o próximo jogador ativo depois do dealer
  room.dealerSeat = getNextDealerSeat(room);*/


   for (let s = 1; s <= 10; s++) {
    if (room.playersBySeat[s - 1]) {
      room.currentSeat = s;
      break;
    }
  }

  advanceDealerAndCurrentSeat(room);

  room.matchId = makeMatchId();
  room.roundNumber = 1;
  room.matchPot = 0;
  room.economicLogs = [];

  const buyIn = getBuyIn(room);

  for (const p of room.playersBySeat || []) {
    if (!p) continue;

    p.nextMatchReady = true;
    p.disconnected = false;
    p.eliminated = false;
    p.pendingRebuy = false;
    p.rebuyDeclined = false;
    p.pendingBatidaAfterDiscard = false;
    p.jogosBaixados = [];
    p.obrigacaoBaixar = false;
    p.totalPoints = 0;
    p.lastRoundPoints = 0;

    p.chips = Number(p.chips) || 0;
    p.matchStartChips = Number(p.chips) || 0;

    p.chips -= buyIn;
    room.matchPot += buyIn;
  }

  room.deck = shuffle(makeDeck());
  room.discard = [];
  room.tableMelds = [];

  for (let s = 1; s <= 10; s++) {
    const p = room.playersBySeat[s - 1];
    if (!p) continue;

    p.hand = [];

    for (let i = 0; i < 9; i++) {
      const card = room.deck.pop();
      if (card) p.hand.push(card);
    }
  }

  setupCachetaoRoundJoker(room);

  room.dealMs = Number(room.dealMs) > 0 ? Number(room.dealMs) : 1200;
  room.dealEndsAt = Date.now() + room.dealMs;

  broadcastRoomState(room);

  if (room._dealStartTimer) {
    clearTimeout(room._dealStartTimer);
    room._dealStartTimer = null;
  }

  room._dealStartTimer = setTimeout(() => {
  room._dealStartTimer = null;

  if (!room || room.matchEnded || room.roundEnded) return;

  // Cachetão Pro:
  // depois da primeira distribuição, todos decidem JOGAR ou CORRER
  room.phase = "DECISAO_PARTICIPAR";
  room.dealEndsAt = 0;
  room.buyEndsAt = 0;

  if (room.dealerSeat) {
  room.currentSeat = nextOccupiedSeat(
    room,
    room.dealerSeat
  );
}

  // força novo relógio da decisão
  room._autoTurnSeat = null;
  room.turnEndsAt = 0;
  startTurnClock(room);

  if (room?.id) sendState(room.id);
  scheduleAutoTurn(room);
}, room.dealMs);
}


function scheduleMatchStart(room) {
  if (!room) return;

  // Só bloqueia se existe partida ativa.
  // Se matchEnded === true, o countdown da revanche pode rodar.
  if (room.started && !room.matchEnded) return;

  if (!room.startAt) return;

  const delay = Math.max(0, room.startAt - Date.now()) + 50;

  clearStartTimer(room);

  room._startTimerId = setTimeout(() => {
    tryStartMatch(room);
  }, delay);
}


function isPlayersTurn(room, clientId) {
  const currentPlayer = room.playersBySeat[room.currentSeat - 1];
  return currentPlayer?.clientId === clientId;
}






function nextOccupiedSeat(room, fromSeat) {
  const total = room.playersBySeat.length;

  for (let step = 1; step <= total; step++) {
    const seat = ((fromSeat - 1 + step) % total) + 1;
    const p = room.playersBySeat[seat - 1];

    // ✅ só pode ser próximo se:
    // - existe jogador
    // - não está eliminado
    if (p && !p.eliminated) {
      return seat;
    }
  }

  return fromSeat;
}

function getNextDealerSeat(room) {
  const players = room.playersBySeat || [];
  const total = players.length || 10;
  const lastDealer = Number(room.dealerSeat) || 0;

  for (let step = 1; step <= total; step++) {
    const seat = ((lastDealer - 1 + step) % total) + 1;
    const p = players[seat - 1];

    if (p && !p.eliminated) {
      return seat;
    }
  }

  return null;
}

function advanceDealerAndCurrentSeat(room) {
  room.dealerSeat = getNextDealerSeat(room);

  if (room.dealerSeat) {
    // A decisão começa no primeiro jogador vivo depois do dealer.
    // O dealer será o último a decidir.
    room.currentSeat = nextOccupiedSeat(
      room,
      room.dealerSeat
    );
  } else {
    room.currentSeat = null;
  }
}


function getCardRankValue(card) {
  const rank = String(card?.rank || "");
  const map = {
    "A": 14,
    "K": 13,
    "Q": 12,
    "J": 11,
    "10": 10,
    "9": 9,
    "8": 8,
    "7": 7,
    "6": 6,
    "5": 5,
    "4": 4,
    "3": 3,
    "2": 2,
    "JK": 20,
    "JOKER": 20
  };
  return map[rank] || 0;
}

function getHighestDiscardIndex(hand) {
  if (!Array.isArray(hand) || !hand.length) return -1;

  let bestIdx = 0;
  let bestVal = -1;

  for (let i = 0; i < hand.length; i++) {
    const val = getCardRankValue(hand[i]);
    if (val > bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function getAutoDiscardIndex(room, seat, hand) {
  if (!Array.isArray(hand) || !hand.length) return -1;

  ensureDiscardStateMaps(room);

  const requiredDiscard = room.mustUseDiscardCardBySeat?.[seat];
  const requiredJoker = room.mustUseJokerBySeat?.[seat];

    // 1) se está obrigado a devolver a carta do lixo,
  // só devolve se NÃO for coringa da rodada
  if (requiredDiscard != null) {
    const idx = hand.findIndex(c => String(c?.id) === String(requiredDiscard));

    if (idx >= 0) {
      const card = hand[idx];

      if (!isMeldJoker(card, room)) {
        return idx;
      }
    }
  }

  // 3) fallback: maior carta NÃO-coringa
  let bestIdx = -1;
  let bestVal = -1;

  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    if (!card) continue;
    if (isMeldJoker(card, room)) continue;

    const val = getCardRankValue(card);
    if (val > bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function clearAutoTurnTimer(room) {
  if (!room?._autoTurnTimer) return;
  clearTimeout(room._autoTurnTimer);
  room._autoTurnTimer = null;
}

function getTurnDurationMs(room) {
  return Number(room?.turnMs) > 0 ? Number(room.turnMs) : 30000;
}

function getBuyDurationMs(room) {
  return Number(room?.buyMs) > 0 ? Number(room.buyMs) : 15000;
}

function startTurnClock(room) {
  const now = Date.now();
  const turnMs = Number(room.turnMs) > 0 ? Number(room.turnMs) : 30000;
  const buyMs = Number(room.buyMs) > 0 ? Number(room.buyMs) : 15000;

  room.turnMs = turnMs;
  room.buyMs = buyMs;
  room.turnEndsAt = now + turnMs;
  room.buyEndsAt = now + buyMs;
  room._autoTurnSeat = room.currentSeat || null;
}





function ensureTurnDeadline(room) {
  const seat = room?.currentSeat;
  if (!room || !seat) return 0;

  const now = Date.now();
  const turnMs = getTurnDurationMs(room);

  // só cria novo prazo quando realmente começa um NOVO turno
  if (
    room._autoTurnSeat !== seat ||
    !room.turnEndsAt ||
    room.turnEndsAt <= now
  ) {
    room._autoTurnSeat = seat;
    room.turnEndsAt = now + turnMs;
  }

  return room.turnEndsAt;
}



function scheduleAutoTurn(room) {
  if (shouldCloseAbandonedRoom(room)) {
  closeAbandonedRoom(room);
  return;
  }
  if (!room || !room.started || room.roundEnded) return;
  if (room.phase === "DEALING") return;

  if (room._autoTurnTimer) {
    clearTimeout(room._autoTurnTimer);
    room._autoTurnTimer = null;
  }

  const seat = room.currentSeat;
  if (!seat) return;

  const current = room.playersBySeat?.[seat - 1];
  if (!current || current.eliminated) return;

  const now = Date.now();

  // só cria novo relógio quando muda o jogador do turno
  if (room._autoTurnSeat !== seat || !room.turnEndsAt || room.turnEndsAt <= now) {
    startTurnClock(room);
  }

  let deadline = room.turnEndsAt;

  // enquanto estiver em COMPRAR, o primeiro gatilho é o buyEndsAt
  if (room.phase === "COMPRAR" && room.buyEndsAt) {
    deadline = Math.min(room.buyEndsAt, room.turnEndsAt);
  }

  const delay = Math.max(0, deadline - Date.now());

  room._autoTurnTimer = setTimeout(() => {
    room._autoTurnTimer = null;

    if (!room || !room.started || room.roundEnded) return;

    const seatNow = room.currentSeat;
    if (!seatNow) return;

    const currentNow = room.playersBySeat?.[seatNow - 1];
    if (!currentNow || currentNow.eliminated) return;

    const now2 = Date.now();

    // Cachetão Pro: decisão automática Jogar/Correr
    if (room.phase === "DECISAO_PARTICIPAR" && room.turnEndsAt && now2 >= room.turnEndsAt) {
      autoDecideCachetaoParticipation(room);
      return;
    }
    // 1) Se ainda está em COMPRAR e bateu 15s, compra automático
    if (room.phase === "COMPRAR" && room.buyEndsAt && now2 >= room.buyEndsAt) {
      const bought = room.deck.pop();
      if (bought) {
        currentNow.hand.push(bought);
      }

      room.phase = "BAIXAR";

      // mantém o mesmo turnEndsAt; só encerra a janela de compra
      room.buyEndsAt = 0;

      if (room?.id) sendState(room.id);
      scheduleAutoTurn(room);
      return;
    }

    // 2) Se bateu o total do turno, descarta automático
    if ((room.phase === "BAIXAR" || room.phase === "DESCARTAR" || room.phase === "COMPRAR") &&
        room.turnEndsAt && now2 >= room.turnEndsAt) {

      // se ainda estava em COMPRAR e venceu o total, compra antes de descartar
      if (room.phase === "COMPRAR") {
        const bought = room.deck.pop();
        if (bought) {
          currentNow.hand.push(bought);
        }
        room.phase = "BAIXAR";
      }

      revertPendingJokerReturn?.(room, seatNow, currentNow);

      const idx = getAutoDiscardIndex(room, seatNow, currentNow.hand);

      if (idx >= 0) {
        const card = currentNow.hand.splice(idx, 1)[0];
        if (card) {
          room.discard.push(card);

          const requiredDiscard = room.mustUseDiscardCardBySeat?.[seatNow];
          if (requiredDiscard != null && String(card.id) === String(requiredDiscard)) {
            clearRequiredDiscardCard(room, seatNow);
            lockDiscardForNextSeat(room, card.id);
          }
        }
      }

      advanceTurn(room);
      if (room?.id) sendState(room.id);
      scheduleAutoTurn(room);
      return;
    }

    // segurança
    scheduleAutoTurn(room);
  }, delay);
}


function canReplaceJokerInMeld(meld, jokerIndex, realCard) {
  if (!meld || !Array.isArray(meld.cards)) return false;
  if (!realCard) return false;

  const oldJoker = meld.cards[jokerIndex];
  if (!oldJoker || !isJoker(oldJoker)) return false;

  const merged = meld.cards.map((c, i) => (i === jokerIndex ? realCard : c));
  const v = validateMeldCards(room, merged);
  return !!v.ok;
}

function canCardReplaceAnyJokerOnTable(room, card) {
  const melds = room.tableMelds || [];
  if (!card || isJoker(card)) return false;

  for (const meld of melds) {
    if (!meld || !Array.isArray(meld.cards) || meld.cards.length === 0) continue;
    if (meld.kind !== "SEQUENCIA") continue;

    for (let i = 0; i < meld.cards.length; i++) {
      const c = meld.cards[i];
      if (!isJoker(c)) continue;

      const merged = meld.cards.map((x, idx) => (idx === i ? card : x));
      const v = validateMeldCards(room, merged);
      if (v.ok) return true;
    }
  }

  return false;
}

function ensureActiveRoundPlayer(player) {
  if (!player) {
    return { ok: false, msg: "Você não está sentado nesta mesa." };
  }

  if (!Array.isArray(player.hand) || player.hand.length === 0) {
    return { ok: false, msg: "Você não está ativo nesta rodada." };
  }

  return { ok: true };
}



function handleDrawDiscardAction(room, player, playerSeat) {
  const phaseCheck = ensurePhase(room, "COMPRAR");
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  // Qualquer compra normal do primeiro comprador encerra a janela da vira.
  if (
    room.viraDisponivelParaJogar &&
    Number(playerSeat) === Number(room.primeiroCompradorSeat)
  ) {
    room.viraDisponivelParaJogar = false;
  }

  // Cachetão Pro:
  // quem Queimou não pode pegar carta do lixo.
  // Só pode comprar do monte.
  if (isCrazyBatidaBurned(room, playerSeat)) {
    return {
      ok: false,
      msg: "Você queimou. Agora só pode comprar do monte."
    };
  }

  ensureDiscardLockState(room);

  ensureDiscardLockState(room);

  const topCard = room.discard?.[room.discard.length - 1];
  if (!topCard) {
    return { ok: false, msg: "Lixo vazio." };
  }

  // NOVA REGRA: não pode pegar coringa do lixo
    // Cachetão Pro: não pode pegar coringa do lixo
  if (isMeldJoker(topCard, room)) {
    return { ok: false, msg: "Não é permitido pegar coringa do lixo." };
  }

  if (isDiscardLockedForSeat(room, playerSeat, topCard)) {
    return { ok: false, msg: "Você não pode pegar essa carta do lixo." };
  }

  const card = room.discard.pop();
  if (!card) {
    return { ok: false, msg: "Lixo vazio." };
  }

  player.hand = player.hand || [];
  player.hand.push(card);

  // Cachetão Pro:
  // pegou do lixo, mas NÃO é obrigado a baixar jogo.
  // Vai direto para descarte.
  clearRequiredDiscardCard(room, playerSeat);

  room.phase = "DESCARTAR";
  room.buyEndsAt = 0;

  return null;
}

function handleSwapJokerAction(room, player, playerSeat, action) {
  const phaseCheck = ensurePhase(room, "BAIXAR");
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  const meldIndex = action.payload?.meldIndex;
  const jokerIndex = action.payload?.jokerIndex;
  const cardId = action.payload?.cardId;

  if (!Number.isInteger(meldIndex) || !Number.isInteger(jokerIndex)) {
    return { ok: false, msg: "Parâmetros inválidos." };
  }

  if (cardId === undefined || cardId === null || cardId === "") {
    return { ok: false, msg: "cardId é obrigatório." };
  }

  const meld = room.tableMelds?.[meldIndex];
  if (!meld || !Array.isArray(meld.cards)) {
    return { ok: false, msg: "Jogo inválido." };
  }

  const oldJoker = meld.cards[jokerIndex];
  if (!oldJoker || !isJoker(oldJoker)) {
    return { ok: false, msg: "Não há coringa nessa posição." };
  }

  const handIdx = (player.hand || []).findIndex(c => String(c.id) === String(cardId));
  if (handIdx < 0) {
    return { ok: false, msg: "Você não tem essa carta na mão." };
  }

  const realCard = player.hand[handIdx];
  const merged = meld.cards.map((c, i) => (i === jokerIndex ? realCard : c));

  const v = validateMeldCards(room, merged);
  if (!v.ok) {
    return { ok: false, msg: v.msg };
  }

  player.hand.splice(handIdx, 1);
  player.hand.push(oldJoker);

  meld.cards = (v.kind === "SEQUENCIA")
    ? sortSequenceCards(merged, v.aceHigh)
    : merged;

  meld.kind = v.kind;

  markJokerRequired(room, playerSeat, oldJoker.id);

  markPendingJokerReturn(room, playerSeat, {
    meldIndex,
    jokerId: oldJoker.id,
    realCardId: realCard.id,
  });

  return null;
}

function validateBatidaGroupSpecial(room, cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return { ok: false };
  }

  const jokers = cards.filter(c => isJoker(c));
  const nonJokers = cards.filter(c => !isJoker(c));

  // 1) TRINCA CRAZY COM CORINGA — só para batida
  // Ex:
  // A♣ A♣ A♠ 🃏 => válido para batida
  // 8♥ 8♦ 8♥ 8♦ 🃏 => válido para batida
  if (isCrazy(room) && jokers.length >= 1 && nonJokers.length >= 1) {
    const baseValor = getValor(nonJokers[0]);
    const allSameValue = nonJokers.every(c => getValor(c) === baseValor);

    if (allSameValue) {
      const realSuits = nonJokers.map(c => getNaipe(c)).filter(Boolean);
      const distinctRealSuits = [...new Set(realSuits)];

      const effectiveSuitCount = distinctRealSuits.length + jokers.length;
      const hasEnoughEffectiveSuits = effectiveSuitCount >= 3;

      if (hasEnoughEffectiveSuits) {
        return {
          ok: true,
          kind: "TRINCA"
        };
      }
    }
  }

  const normal = validateMeldCards(room, cards);
  if (normal.ok) {
    return normal;
  }

  // 2) dois coringas + uma carta
  if (cards.length === 3 && jokers.length === 2 && nonJokers.length === 1) {
    return {
      ok: true,
      kind: "SEQUENCIA",
      aceHigh: false
    };
  }

  // 3) SEQUÊNCIA DE BATIDA COM CORINGA NA PONTA
  if (nonJokers.length >= 2) {
    const sameSuit = nonJokers.every(c => getNaipe(c) === getNaipe(nonJokers[0]));
    if (sameSuit) {
      const naipe = getNaipe(nonJokers[0]);

      function checkRanks(ranksSortedAsc, jokersCount, allowEnds) {
        for (let i = 0; i < ranksSortedAsc.length - 1; i++) {
          if (ranksSortedAsc[i] === ranksSortedAsc[i + 1]) {
            return { ok: false };
          }
        }

        let internalNeeded = 0;
        for (let i = 0; i < ranksSortedAsc.length - 1; i++) {
          const diff = ranksSortedAsc[i + 1] - ranksSortedAsc[i];
          if (diff < 1) return { ok: false };
          if (diff > 1) internalNeeded += (diff - 1);
        }

        if (internalNeeded > jokersCount) {
          return { ok: false };
        }

        const leftover = jokersCount - internalNeeded;
        if (!allowEnds && leftover > 0) {
          return { ok: false };
        }

        return { ok: true };
      }

      const ranksA1 = nonJokers
        .map(c => valorToNumber(getValor(c)))
        .filter(v => v != null)
        .sort((a, b) => a - b);

      if (ranksA1.length === nonJokers.length) {
        const allowEnds = isCrazy(room);

        const a1 = checkRanks(ranksA1, jokers.length, allowEnds);
        if (a1.ok) {
          return {
            ok: true,
            kind: "SEQUENCIA",
            naipe,
            aceHigh: false
          };
        }

        if (ranksA1.includes(1)) {
          const ranksA14 = ranksA1
            .map(r => (r === 1 ? 14 : r))
            .sort((a, b) => a - b);

          const a14 = checkRanks(ranksA14, jokers.length, allowEnds);
          if (a14.ok) {
            return {
              ok: true,
              kind: "SEQUENCIA",
              naipe,
              aceHigh: true
            };
          }
        }
      }
    }
  }

  return { ok: false };
}

function tryBuildGlobalBatidaGroups(room, cards) {
  if (!isCrazy(room)) return null;
  if (!Array.isArray(cards) || cards.length < 6) return null;

  const byId = c => String(c?.id);

  function combinations(arr, choose, start = 0, prefix = [], out = []) {
    if (prefix.length === choose) {
      out.push(prefix.slice());
      return out;
    }

    for (let i = start; i <= arr.length - (choose - prefix.length); i++) {
      prefix.push(arr[i]);
      combinations(arr, choose, i + 1, prefix, out);
      prefix.pop();
    }

    return out;
  }

  function removeCards(source, used) {
    const usedIds = new Set(used.map(byId));
    return source.filter(c => !usedIds.has(byId(c)));
  }

  function normalizeGroup(group) {
    const v = validateBatidaGroupSpecial(room, group);
    if (!v.ok) return null;

    const cardsOut =
      v.kind === "SEQUENCIA"
        ? sortSequenceCards(group, v.aceHigh)
        : group.slice();

    const meld = {
      kind: v.kind,
      cards: cardsOut
    };

    if (v.kind === "TRINCA") {
      meld.allowedSuits = [...new Set(cardsOut.map(c => getNaipe(c)).filter(Boolean))];
    }

    return meld;
  }

  function recurse(remaining) {
    if (!remaining.length) return [];

    const anchor = remaining.find(c => !isJoker(c)) || remaining[0];
    if (!anchor) return null;

    const others = remaining.filter(c => byId(c) !== byId(anchor));
    const candidates = [];

    for (let size = remaining.length; size >= 3; size--) {
      const combos = combinations(others, size - 1);
      for (const combo of combos) {
        const group = [anchor, ...combo];
        const normalized = normalizeGroup(group);
        if (normalized) {
          candidates.push(normalized);
        }
      }
    }

    for (const candidate of candidates) {
      const nextRemaining = removeCards(remaining, candidate.cards);
      const tail = recurse(nextRemaining);
      if (tail) {
        return [candidate, ...tail];
      }
    }

    return null;
  }

  const groups = recurse(cards);
  if (!groups || !groups.length) return null;
  if (groups.length < 2) return null;

  return groups;
}









/*/ aqui fiz */

function canUseBatidaException(room, player, selectedCards, context = {}) {
  const handSizeBefore = Array.isArray(player?.hand) ? player.hand.length : 0;
  const usedCount = Array.isArray(selectedCards) ? selectedCards.length : 0;

  // vale para:
  // - batida sem descarte
  // - batida com descarte
  const willBatidaWithoutDiscard = handSizeBefore === usedCount;
  const willBatidaWithDiscard = handSizeBefore === usedCount + 1;

  const forceBatidaAttempt = !!context.forceBatidaAttempt;

  if (!forceBatidaAttempt && !willBatidaWithoutDiscard && !willBatidaWithDiscard) {
    return { ok: false };
  }

  const cards = selectedCards || [];
  const jokers = cards.filter(c => isJoker(c));
  const nonJokers = cards.filter(c => !isJoker(c));

  // 1) dois coringas + uma carta
  if (cards.length === 3 && jokers.length === 2 && nonJokers.length === 1) {
    return {
      ok: true,
      reason: "BATIDA_2_JOKERS_1_CARD",
      kind: "SEQUENCIA"
    };
  }

  // 2) TRINCA COM CORINGA — só no CRAZY e só para batida
  {
    const allTrincaCards =
      context.mode === "addToMeld" && context.meld?.kind === "TRINCA"
        ? [...(context.meld.cards || []), ...cards]
        : cards;

    const trincaJokers = allTrincaCards.filter(c => isJoker(c));
    const trincaNonJokers = allTrincaCards.filter(c => !isJoker(c));

    if (
      isCrazy(room) &&
      trincaJokers.length >= 1 &&
      trincaNonJokers.length >= 1 &&
      allTrincaCards.length >= 3 &&
      allTrincaCards.length <= 8
    ) {
      const baseValor = getValor(trincaNonJokers[0]);
      const allSameValue = trincaNonJokers.every(c => getValor(c) === baseValor);

      if (allSameValue) {
        const realSuits = trincaNonJokers.map(c => getNaipe(c)).filter(Boolean);
        const distinctRealSuits = [...new Set(realSuits)];
        const totalSuitSlots = distinctRealSuits.length + trincaJokers.length;

        const batidaRealSuits = nonJokers
          .map(c => getNaipe(c))
          .filter(Boolean);

        const batidaUniqueRealSuits = new Set(batidaRealSuits);

        if (batidaUniqueRealSuits.size !== batidaRealSuits.length) {
          return {
            ok: false,
            msg: "Trinca com coringa precisa ter naipes reais diferentes."
          };
        }

        if (totalSuitSlots >= 3 && totalSuitSlots <= 8) {
          return {
            ok: true,
            reason: "BATIDA_TRINCA_WITH_JOKER_CRAZY",
            kind: "TRINCA"
          };
        }
      }
    }
  }

  // 3) sequência especial de batida com coringas
  if (nonJokers.length >= 2) {
    const sameSuit = nonJokers.every(c => getNaipe(c) === getNaipe(nonJokers[0]));
    if (sameSuit && jokers.length >= 1) {
      const classic = String(room?.variant || "CLASSIC").toUpperCase() === "CLASSIC";

      if (classic && jokers.length === 1 && cards.length >= 3) {
        const realRanks = nonJokers
          .map(c => valorToNumber(getValor(c)))
          .filter(v => v != null)
          .sort((a, b) => a - b);

        if (realRanks.length >= 2) {
          let internalNeeded = 0;
          for (let i = 0; i < realRanks.length - 1; i++) {
            const diff = realRanks[i + 1] - realRanks[i];
            if (diff > 1) internalNeeded += (diff - 1);
          }

          if (internalNeeded < jokers.length) {
            return { ok: false };
          }
        }
      }

      return {
        ok: true,
        reason: "BATIDA_SEQUENCE_EXCEPTION",
        kind: "SEQUENCIA"
      };
    }
  }

  // 4) adicionar coringa em sequência existente qualquer só para bater
  if (
    context.mode === "addToMeld" &&
    context.meld?.kind === "SEQUENCIA" &&
    jokers.length >= 1
  ) {
    return {
      ok: true,
      reason: "BATIDA_ADD_JOKER_TO_EXISTING_SEQUENCE",
      kind: "SEQUENCIA"
    };
  }

  // 5) BATIDA GLOBAL — só no CRAZY e só no playMeld
  if (context.mode === "playMeld" && isCrazy(room)) {
    const groups = tryBuildGlobalBatidaGroups(room, cards);
    if (groups && groups.length >= 2) {
      return {
        ok: true,
        reason: "BATIDA_GLOBAL",
        kind: "MULTI",
        groups
      };
    }
  }

  return { ok: false };
}

function handlePlayMeldAction(room, player, playerSeat, action) {
  const phaseCheck = ensurePhase(room, "BAIXAR");
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  const cardIds = action.payload?.cardIds || [];
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return { ok: false, msg: "Nenhuma carta selecionada." };
  }

  const hand = player.hand || [];

  const querUsarVira = cardIds.some(
    id => String(id) === "__VIRA__"
  );

  if (querUsarVira) {
    if (!player.jogandoComVira) {
      return {
        ok: false,
        msg: "Você não declarou que está jogando com a vira."
      };
    }

    if (player.viraBaixada) {
      return {
        ok: false,
        msg: "A vira já foi usada em outro jogo."
      };
    }

    if (
      Number(room.viraEmUsoPorSeat) !== Number(playerSeat)
    ) {
      return {
        ok: false,
        msg: "A vira não está disponível para este jogador."
      };
    }

    if (!room.cartaVira) {
      return {
        ok: false,
        msg: "A vira desta rodada não está disponível."
      };
    }
  }

  const selected = cardIds.map(id => {
    if (String(id) === "__VIRA__") {
      return room.cartaVira;
    }

    return hand.find(
      c => String(c.id) === String(id)
    );
  });

  if (selected.some(c => !c)) {
    return { ok: false, msg: "Carta inválida." };
  }

  const handSizeBefore =
    hand.length;

  // A vira é virtual e não existe dentro de player.hand.
  const selectedPhysicalCount =
    cardIds.filter(
      id => String(id) !== "__VIRA__"
    ).length;

  const willBatidaWithoutDiscard =
    handSizeBefore === selectedPhysicalCount;

  const willBatidaWithDiscard =
    handSizeBefore ===
    selectedPhysicalCount + 1;


  const willBatidaNow = willBatidaWithoutDiscard || willBatidaWithDiscard;

  // Quem declarou BATI com a vira precisa
// obrigatoriamente utilizá-la em um dos jogos.
if (
  willBatidaNow &&
  player.batendoComVira &&
  !player.viraBaixada &&
  !querUsarVira
) {
  return {
    ok: false,
    msg: "Para bater com a vira, selecione-a em um dos jogos."
  };
}

  // 1) EXCEÇÃO DE BATIDA — prioridade máxima
  if (willBatidaNow) {
    const batidaEx = canUseBatidaException(room, player, selected, {
      mode: "playMeld",
      forceBatidaAttempt: !!player.pendingBatidaAfterDiscard || !!room.pendingBatidaClaim
    });

    if (batidaEx.ok) {
      const handCardIds = cardIds.filter(
        id => String(id) !== "__VIRA__"
      );

      player.hand = hand.filter(
        c => !handCardIds.some(
          id => String(id) === String(c.id)
        )
      );

      room.tableMelds = room.tableMelds || [];

      if (batidaEx.reason === "BATIDA_GLOBAL" && Array.isArray(batidaEx.groups)) {
        for (const g of batidaEx.groups) {
          room.tableMelds.push({
            kind: g.kind,
            cards: g.cards,
            seat: playerSeat,
            ...(g.allowedSuits ? { allowedSuits: g.allowedSuits } : {})
          });
        }
      } else {
        room.tableMelds.push({
          kind: batidaEx.kind || "SEQUENCIA",
          cards: selected,
          seat: playerSeat
        });
      }

      if (querUsarVira) {
      player.viraBaixada = true;
      player.viraDescartada = false;
      room.viraNaMesa = false;
}

      const requiredDiscard = getRequiredDiscardCardId(room, playerSeat);
      if (requiredDiscard != null) {
        const used = selected.some(c => String(c.id) === String(requiredDiscard));
        if (used) clearRequiredDiscardCard(room, playerSeat);
      }

      const requiredJoker = getRequiredJokerCardId(room, playerSeat);
      if (requiredJoker != null) {
        const used = selected.some(c => String(c.id) === String(requiredJoker));
        if (used) clearRequiredJoker(room, playerSeat);
      }

      // batida sem descarte
      if ((player.hand || []).length === 0) {
        revealBatidaThenEndRound(room, playerSeat);
        return null;
      }

      // se a carta restante força batida, encerra agora
      if (shouldForceBatida(room, player)) {
        endRound(room, playerSeat);
        return null;
      }

      // batida com descarte
      if ((player.hand || []).length === 1) {
        player.pendingBatidaAfterDiscard = true;
        return null;
      }
    }
  }

  // 2) VALIDAÇÃO NORMAL
  const validated = validateMeldCards(room, selected);
  if (!validated.ok) {
    return { ok: false, msg: validated.msg };
  }

    if (validated.kind === "TRINCA") {
    const suits = selected.map(c => getNaipe(c)).filter(Boolean);
    const distinctSuits = [...new Set(suits)];

    if (isClassic(room)) {
      // no clássico continua exigindo 3 cartas e 3 naipes diferentes
      if (distinctSuits.length !== selected.length) {
        return { ok: false, msg: "A trinca inicial não pode ter naipe repetido." };
      }

      if (selected.length !== 3) {
        return { ok: false, msg: "No clássico, a trinca inicial precisa ter 3 cartas." };
      }
    }

    if (isCrazy(room)) {
      const temCoringaNaTrinca = selected.some(c => isMeldJoker(c, room));

      if (!temCoringaNaTrinca) {
        const crazyTrincaCheck = validateCrazyTrincaShape(selected, { initial: true });
        if (!crazyTrincaCheck.ok) {
          return crazyTrincaCheck;
        }
      }
    }
  }

  // 3) APLICA
  const handCardIds = cardIds.filter(
    id => String(id) !== "__VIRA__"
  );

  player.hand = hand.filter(
    c => !handCardIds.some(
      id => String(id) === String(c.id)
    )
  );

  let meldCards = selected;
  if (validated.kind === "SEQUENCIA") {
    meldCards = sortSequenceCards(selected, validated.aceHigh);
  }

  const meld = {
    kind: validated.kind,
    cards: meldCards,
    seat: playerSeat
  };

  if (validated.kind === "TRINCA") {
    meld.allowedSuits = [...new Set(selected.map(c => getNaipe(c)).filter(Boolean))];
  }

  room.tableMelds = room.tableMelds || [];
  room.tableMelds.push(meld);
  if (querUsarVira) {
    player.viraBaixada = true;
    player.viraDescartada = false;
    room.viraNaMesa = false;
  }

  // 4) LIMPA OBRIGAÇÕES
  const requiredDiscard = getRequiredDiscardCardId(room, playerSeat);
  if (requiredDiscard != null) {
    const used = selected.some(c => String(c.id) === String(requiredDiscard));
    if (used) {
      clearRequiredDiscardCard(room, playerSeat);
    }
  }

  const requiredJoker = getRequiredJokerCardId(room, playerSeat);
  if (requiredJoker != null) {
    const used = selected.some(c => String(c.id) === String(requiredJoker));
    if (used) {
      clearRequiredJoker(room, playerSeat);
    }
  }

  // 5) FIM DE RODADA
  if ((player.hand || []).length === 0) {
    revealBatidaThenEndRound(room, playerSeat);
    return null;
  }

    if (shouldForceBatida(room, player)) {
    endRound(room, playerSeat);
    return null;
  }

  // Cachetão Pro:
  // baixou jogos válidos e sobrou 1 carta = batida com descarte
  if ((player.hand || []).length === 1) {
    player.pendingBatidaAfterDiscard = true;
    return null;
  }

  return null;
}


function handleAddToMeldAction(room, player, playerSeat, action) {
  const phaseCheck = ensurePhase(room, "BAIXAR");
  if (!phaseCheck.ok) return phaseCheck;

  const activeCheck = ensureActiveRoundPlayer(player);
  if (!activeCheck.ok) return activeCheck;

  const meldIndex = action.payload?.meldIndex;
  const cardIds = action.payload?.cardIds || [];

  if (!Number.isInteger(meldIndex)) {
    return { ok: false, msg: "Jogada inválida." };
  }

  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return { ok: false, msg: "Nenhuma carta selecionada." };
  }

  const meld = room.tableMelds?.[meldIndex];
  if (!meld) {
    return { ok: false, msg: "Jogo inválido." };
  }

  const hand = player.hand || [];
  const cards = cardIds.map(id =>
    hand.find(c => String(c.id) === String(id))
  );

  if (cards.some(c => !c)) {
    return { ok: false, msg: "Carta inválida." };
  }

  const handSizeBefore = hand.length;
  const willBatidaWithoutDiscard = handSizeBefore === cards.length;
  const willBatidaWithDiscard = handSizeBefore === cards.length + 1;
  const willBatidaNow = willBatidaWithoutDiscard || willBatidaWithDiscard;
  const merged = [...(meld.cards || []), ...cards];

  // 1) EXCEÇÃO DE BATIDA — prioridade máxima
  if (willBatidaNow) {
    const batidaEx = canUseBatidaException(room, player, cards, {
      mode: "addToMeld",
      meld
    });

    if (batidaEx.ok) {
      player.hand = hand.filter(
        c => !cardIds.some(id => String(id) === String(c.id))
      );

      meld.cards = [...(meld.cards || []), ...cards];
      meld.kind = batidaEx.kind || meld.kind || "SEQUENCIA";

      const requiredDiscard = getRequiredDiscardCardId(room, playerSeat);
      if (requiredDiscard != null) {
        const used = cards.some(c => String(c.id) === String(requiredDiscard));
        if (used) clearRequiredDiscardCard(room, playerSeat);
      }

      const requiredJoker = getRequiredJokerCardId(room, playerSeat);
      if (requiredJoker != null) {
        const used = cards.some(c => String(c.id) === String(requiredJoker));
        if (used) clearRequiredJoker(room, playerSeat);
      }

      // batida sem descarte
      if ((player.hand || []).length === 0) {
        revealBatidaThenEndRound(room, playerSeat);
        return null;
      }

      // se a carta restante não pode/ não deve ser descartada, encerra agora
      if (shouldForceBatida(room, player)) {
        endRound(room, playerSeat);
        return null;
      }

      // batida com descarte normal
      if ((player.hand || []).length === 1) {
        player.pendingBatidaAfterDiscard = true;
        return null;
      }
    }
  }

  // 2) VALIDAÇÃO NORMAL
  let validated = null;

    if (meld.kind === "TRINCA") {
    const currentCards = meld.cards || [];
    const allCards = merged;

    const baseValor = getValor(currentCards[0]);
    const allSameValue = allCards.every(c => getValor(c) === baseValor);
    if (!allSameValue) {
      return { ok: false, msg: "Trinca precisa ter cartas do mesmo valor." };
    }

    if (isClassic(room) && allCards.some(c => isJoker(c))) {
      return { ok: false, msg: "Trinca com coringa não vale." };
    }

    const currentSuits = [...new Set(currentCards.map(c => getNaipe(c)).filter(Boolean))];
    const newSuits = cards.map(c => getNaipe(c)).filter(Boolean);
    const distinctMergedSuits = [...new Set(allCards.map(c => getNaipe(c)).filter(Boolean))];

    if (isClassic(room)) {
      const invalidSuit = newSuits.some(s => !currentSuits.includes(s));
      if (invalidSuit) {
        return { ok: false, msg: "Só pode adicionar os mesmos naipes da trinca." };
      }

      if (distinctMergedSuits.length !== 3) {
        return { ok: false, msg: "Trinca precisa manter 3 naipes." };
      }
    }

    if (isCrazy(room)) {
      const crazyTrincaCheck = validateCrazyTrincaShape(allCards, { initial: false });
      if (!crazyTrincaCheck.ok) {
        return crazyTrincaCheck;
      }
    }

    validated = { ok: true, kind: "TRINCA" };
  
  } else {
    validated = validateMeldCards(room, merged);
    if (!validated.ok) {
      return { ok: false, msg: validated.msg };
    }
  }

  // 3) APLICA
  player.hand = hand.filter(
    c => !cardIds.some(id => String(id) === String(c.id))
  );

  if (meld.kind === "TRINCA") {
    meld.cards = merged;
    meld.allowedSuits =
      Array.isArray(meld.allowedSuits) && meld.allowedSuits.length
        ? meld.allowedSuits
        : [...new Set(merged.map(c => getNaipe(c)).filter(Boolean))];
  } else {
    meld.cards = validated.kind === "SEQUENCIA"
      ? sortSequenceCards(merged, validated.aceHigh)
      : merged;

    meld.kind = validated.kind;
  }

  // 4) LIMPA OBRIGAÇÕES
  const requiredDiscard = getRequiredDiscardCardId(room, playerSeat);
  if (requiredDiscard != null) {
    const used = cards.some(c => String(c.id) === String(requiredDiscard));
    if (used) {
      clearRequiredDiscardCard(room, playerSeat);
    }
  }

  const requiredJoker = getRequiredJokerCardId(room, playerSeat);
  if (requiredJoker != null) {
    const used = cards.some(c => String(c.id) === String(requiredJoker));
    if (used) {
      clearRequiredJoker(room, playerSeat);
    }
  }

  // 5) FIM DE RODADA
  if ((player.hand || []).length === 0) {
    revealBatidaThenEndRound(room, playerSeat);
    return null;
  }

  if (shouldForceBatida(room, player)) {
    endRound(room, playerSeat);
    return null;
  }

  return null;
}

// --------------------
// Ações autoritativas
// --------------------
function handleAction(clientId, tableId, action) {

  const room = rooms.get(tableId);
  const client = clients.get(clientId);

  if (!room) return { ok: false, msg: "Mesa inexistente." };
  if (!client) return { ok: false, msg: "Cliente inexistente." };

  if (!room.started && action?.type !== "rebuy") {
    return { ok: false, msg: "A Partida ainda não começou." };
  }

  if (client.mode !== "player") {
    return { ok: false, msg: "Espectador não pode jogar." };
  }

  const playerSeat = client.seat;
  const player = getClientPlayer(room, client);

  if (!player) {
    return { ok: false, msg: "Você não está sentado nesta mesa." };
  }

// -------------------------
// CACHETÃO PRO - DECISÃO JOGAR / CORRER
// -------------------------
if (
  action?.type === "jogarRodada" ||
  action?.type === "correrRodada" ||
  action?.type === "marraRodada"
) {

  if (room.phase !== "DECISAO_PARTICIPAR") {
    return { ok: false, msg: "Fora do momento de decisão." };
  }

  const seat = Number(playerSeat);

  if (Number(room.currentSeat) !== seat) {
    return { ok: false, msg: "Aguarde sua vez de decidir." };
  }

  if (player.eliminated) {
    return { ok: false, msg: "Você foi eliminado." };
  }

  if (player.participando || player.passouRodada) {
    return { ok: false, msg: "Você já decidiu esta rodada." };
  }

  const estaNaMarra =
  player.marra === true ||
  player.naMarra === true;

if (action.type === "correrRodada" && estaNaMarra) {
  return {
    ok: false,
    msg: "Você está na Marra e é obrigado a jogar."
  };
}

if (action.type === "jogarRodada" || action.type === "marraRodada") {
  player.participando = true;
  player.passouRodada = false;

  if (estaNaMarra) {
    player.marra = true;
    player.naMarra = true;
  }
}

  if (action.type === "correrRodada") {
  player.participando = false;
  player.passouRodada = true;

    // Quem corre perde 1 ponto
    player.vidas = Math.max(0, (Number(player.vidas) || 0) - 1);

    if (player.vidas <= 0) {
      mandarParaRebuyCachetao(room, player);
    }
  }

  advanceCachetaoDecisionTurn(room);

  return { ok: true };
}

    const crazyAttemptSeatCanAct = canSeatActDuringCrazyBatidaAttempt(
    room,
    playerSeat,
    action?.type
  );

  if (isCrazyBatidaAttemptActive(room) && !crazyAttemptSeatCanAct && action?.type !== "startCrazyBatidaAttempt") {
    return { ok: false, msg: "Aguarde a tentativa de BATI." };
  }

// Cachetão Pro:
// quem correu a rodada fica apenas assistindo.
// Não pode comprar, pegar lixo, baixar ou descartar.
if (
  player.passouRodada &&
  action?.type !== "startCrazyBatidaAttempt" &&
  action?.type !== "cancelCrazyBatidaAttempt"
) {
  return {
    ok: false,
    msg: "Você correu esta rodada. Aguarde a próxima."
  };
}


  if (!isOutOfTurnAllowed(action?.type) && !crazyAttemptSeatCanAct) {
    if (!isPlayersTurn(room, clientId)) {
      return { ok: false, msg: "Não é sua vez." };
    }

    if (player.eliminated) {
      return { ok: false, msg: "Você foi eliminado. Aguarde a decisão de rebuy." };
    }
  }


  switch (action.type) {

    case "playWithVira": {
    const err = handlePlayWithViraAction(
      room,
      player,
      playerSeat
    );

    if (err) return err;
    break;
  }

  case "drawDeck": {
  const err = handleDrawDeckAction(room, player, playerSeat);
  if (err) return err;
  break;
}

//CASES//

case "swapJoker": {
  const err = handleSwapJokerAction(room, player, playerSeat, action);
  if (err) return err;
  break;
}

case "addToMeld": {
  const err = handleAddToMeldAction(room, player, playerSeat, action);
  if (err) return err;
  break;
}

case "startBatidaComViraAttempt": {
  const err =
    handleStartBatidaComViraAttempt(
      room,
      player,
      playerSeat
    );

  if (err) return err;
  break;
}


case "startCrazyBatidaAttempt": {
  const err = handleStartCrazyBatidaAttempt(room, player, playerSeat);
  if (err) return err;
  break;
}

case "cancelCrazyBatidaAttempt": {
  const err = handleCancelCrazyBatidaAttempt(room, playerSeat);
  if (err) return err;
  break;
}



case "rebuy": {
  if (!player) {
    return { ok: false, msg: "Você não está sentado nesta mesa." };
  }

  if (!player.eliminated) {
    return { ok: false, msg: "Você não está eliminado." };
  }

  if (player.disconnected) {
    return { ok: false, msg: "Jogador desconectado usa rebuy automático." };
  }

  if ((player.rebuyCount || 0) >= 3) {
    return { ok: false, msg: "Você atingiu o limite de Rebuy." };
  }

  const cost = Number(getRebuyCost(room, player)) || 0;

  if ((Number(player.chips) || 0) < cost) {
    return { ok: false, msg: "Saldo insuficiente para Rebuy." };
  }

  if (player.pendingRebuy === true) {
    return { ok: false, msg: "Rebuy já solicitado." };
  }

  if (!room.rebuyDecisionUntil || Date.now() > room.rebuyDecisionUntil) {
    return { ok: false, msg: "Janela de Rebuy encerrada." };
  }

  player.pendingRebuy = true;
  player.rebuyDeclined = false;

  // Se não há mais ninguém precisando decidir, não espera o timer acabar.
  if (!hasRebuyChoices(room)) {
    if (room.nextRoundTimeoutId) {
      clearTimeout(room.nextRoundTimeoutId);
      room.nextRoundTimeoutId = null;
    }

    room.rebuyDecisionUntil = 0;

    const rebuys = applyPendingRebuys(room);
    room.lastAppliedRebuys = rebuys;

    const aliveAfterRebuy = (room.playersBySeat || []).filter(pl => pl && !pl.eliminated);

    if (aliveAfterRebuy.length <= 1) {
      room.matchEnded = true;
      room.matchWinnerSeat = room.playersBySeat.indexOf(aliveAfterRebuy[0]) + 1;

      finalizeMatchEconomy(room);
      if (room?.id) sendState(room.id);
      return { ok: true };
    }

    startNewRound(room);
    if (room?.id) sendState(room.id);
    return { ok: true };
  }

  break;
}

case "declineRebuy": {

  console.log("[SERVER] declineRebuy recebido", {
  player: player?.name,
  seat: player?.seat,
  tableId: room?.id
});

  if (!player) {
    return { ok: false, msg: "Você não está sentado nesta mesa." };
  }

  if (!player.eliminated) {
    return { ok: false, msg: "Você não está eliminado." };
  }

  if (!room.rebuyDecisionUntil || Date.now() > room.rebuyDecisionUntil) {
    return { ok: false, msg: "Janela de Rebuy encerrada." };
  }

  player.pendingRebuy = false;
  player.rebuyDeclined = true;

  // Se não há mais ninguém precisando decidir, não espera o timer acabar.
  if (!hasRebuyChoices(room)) {
    if (room.nextRoundTimeoutId) {
      clearTimeout(room.nextRoundTimeoutId);
      room.nextRoundTimeoutId = null;
    }

    room.rebuyDecisionUntil = 0;

    const rebuys = applyPendingRebuys(room);
    room.lastAppliedRebuys = rebuys;

    const aliveAfterRebuy = (room.playersBySeat || []).filter(pl => pl && !pl.eliminated);

    if (aliveAfterRebuy.length <= 1) {
      room.matchEnded = true;
      room.matchWinnerSeat = room.playersBySeat.indexOf(aliveAfterRebuy[0]) + 1;

      finalizeMatchEconomy(room);
      if (room?.id) sendState(room.id);
      return { ok: true };
    }

    startNewRound(room);
    if (room?.id) sendState(room.id);
    return { ok: true };
  }

  if (room?.id) sendState(room.id);

  return { ok: true };
}


case "drawDiscard": {
  const err = handleDrawDiscardAction(room, player, playerSeat);
  if (err) return err;
  break;
}


case "playMeld": {
  const err = handlePlayMeldAction(room, player, playerSeat, action);
  if (err) return err;
  break;
}

/*
case "debugHand": {
  if (!player) return { ok: false };

  debugSetHand(room, playerSeat, action.payload?.cards || []);
  return null;
}

*/

case "discard": {
  const err = handleDiscardAction(room, player, playerSeat, action);
  if (err) return err;
  break;
}

default:
  return { ok: false, msg: "Ação desconhecida." };
}

sanitizeRoom(room);
if (room?.id) sendState(room.id);
return { ok: true };
}



function finalizeDisconnectedPlayer(tableId, seat, expectedClientId) {
  const room = rooms.get(tableId);
  if (!room) return;

  const p = room.playersBySeat[seat - 1];
  if (!p) return;

  // só remove se ainda for exatamente o mesmo jogador desconectado
  if (p.clientId !== expectedClientId) return;
  if (!p.disconnected) return;

  room.playersBySeat[seat - 1] = null;

  refreshStartCountdown(room);
  sendState(tableId);

  // se era a vez dele, avança
  if (room.started && room.currentSeat === seat) {
    room.currentSeat = nextOccupiedSeat(room, room.currentSeat);
    room.phase = "COMPRAR";
  }

  if (room?.id) sendState(room.id);
}



// --------------------
// Join/Leave
// --------------------
function leaveCurrentTable(clientId) {
  const client = clients.get(clientId);
  if (!client?.tableId) return;

  const room = rooms.get(client.tableId);
  if (!room) {
    clearClientTableState(client);
    return;
  }

  removeClientFromSpectators(room, clientId);

  const seat = client.seat;
  if (seat) {
    removePlayerFromSeat(room, seat, clientId);
  }

  clearClientTableState(client);

  refreshStartCountdown(room);
  broadcastRoomState(room);
  cleanupEmptyRoomInstances();
  broadcastOnlineStatus();
}


/*
function tryResolveRematchAfterSeatChange(room) {
  if (!room) return;
  if (!room.matchEnded) return;

  const seatedPlayers = (room.playersBySeat || [])
    .map((p, idx) => ({ p, seat: idx + 1 }))
    .filter(x => !!x.p);

  // só considera para revanche quem participou da partida anterior E ainda está sentado
  const eligibleStillSeated = seatedPlayers.filter(({ p }) =>
    Array.isArray(room.rematchEligiblePlayers) &&
    room.rematchEligiblePlayers.includes(p.clientId)
  );

  // se ninguém elegível da partida anterior ficou sentado,
  // a mesa precisa voltar ao estado normal de espera
  if (eligibleStillSeated.length === 0) {
    resetRoomForRematch(room);
    resetStartCountdown(room);
    broadcastRoomState(room);
    return;
  }

  // se todos os elegíveis que ainda estão sentados aceitaram, a mesa volta para WAITING
  const allAccepted = eligibleStillSeated.every(({ seat }) => room.rematchResponses?.[seat] === true);

  if (!allAccepted) return;

  resetRoomForRematch(room);

  // volta para o fluxo normal de espera / countdown
  refreshStartCountdown(room);
  broadcastRoomState(room);
}
*/

function sanitizeRoom(room) {
  // Precedência (quem “ganha” se tiver duplicado):
  // 1) mesa (tableMelds)
  // 2) mãos (playersBySeat[].hand)
  // 3) lixo (discard)
  // 4) deck
  const seen = new Set();

  // mesa
  room.tableMelds = room.tableMelds || [];
  for (const meld of room.tableMelds) {
    meld.cards = (meld.cards || []).filter(c => {
      const id = String(c?.id);
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // mãos
  for (const p of room.playersBySeat || []) {
    if (!p) continue;
    p.hand = (p.hand || []).filter(c => {
      const id = String(c?.id);
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // lixo
  room.discard = room.discard || [];
  room.discard = room.discard.filter(c => {
    const id = String(c?.id);
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // deck
  room.deck = room.deck || [];
  room.deck = room.deck.filter(c => {
    const id = String(c?.id);
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}


wss.on("connection", async (ws, req) => {

  ws.isAlive = true;
  ws.on("pong", heartbeat);

  const clientId = randomUUID();
  const authUser = await getAuthUserFromWsRequest(req);

  clients.set(clientId, {
  ws,
  name: authUser?.username || "Visitante",

  userId: authUser?.id || null,
  email: authUser?.email || null,

  chips: authUser?.chipsBalance || 0,
  chipsBalance: authUser?.chipsBalance || 0,

  tableId: null,
  seat: null,
  mode: null,

  // segurança
  lastActionAt: 0,
  lastSeq: 0
});

  broadcastOnlineStatus();

  send(ws, "hello", {
    clientId,
    tables: TABLES.map(t => {
      const r = rooms.get(t.id);
      return roomSnapshotPublic(r);
    }),
    online: clients.size,
  });

 ws.on("message", async (raw) => {

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const c = clients.get(clientId);
if (!c) return;

// -------------------------
// LEAVE TABLE
// -------------------------
if (msg.type === "leaveTable") {
  const tableId = msg.payload?.tableId || c.tableId;

  if (tableId && rooms.has(tableId)) {
    const room = rooms.get(tableId);
    const seat = Number(c.seat);

    if (seat >= 1 && seat <= (room.playersBySeat?.length || 10)) {
      const p = room.playersBySeat?.[seat - 1];

      if (p && p.clientId === clientId) {
        if (!room.started || room.matchEnded) {
          removePlayerFromSeat(room, seat, clientId);
        } else {
          p.disconnected = true;
        }
      }
    }

    const stillSeated = (room.playersBySeat || []).some(Boolean);

    // se a partida acabou e ninguém ficou sentado, limpa a mesa
    if (room.matchEnded && !stillSeated) {
      resetRoomForRematch(room);
      resetStartCountdown(room);
    }

    broadcastLobbyTable(room);
    sendState(room.id);
  }

  c.tableId = null;
  c.seat = null;
  c.mode = null;

  return;
}


// -------------------------
// JOIN TABLE GROUP
// Escolhe/cria uma instância real da mesa antes de entrar.
// Ex: cliente pede C1, servidor pode colocar em C1 ou C1#2.
// -------------------------
if (msg.type === "joinTableGroup") {


  const payload = msg.payload || {};
  const tableGroupId = payload.tableId;
  const seat = Number(payload.seat);

  if (!getBaseTableConfig(tableGroupId)) {
    return send(ws, "error", { message: "Mesa inválida." });
  }

  if (!(seat >= 1 && seat <= 10)) {
    return send(ws, "error", { message: "Assento inválido." });
  }

  const realRoom = findOrCreateRoomForGroup(tableGroupId, seat);

  if (!realRoom) {
    return send(ws, "error", {
      message: "Não foi possível encontrar uma mesa disponível."
    });
  }

  // reaproveita o fluxo antigo, mas agora com o tableId real
  msg.type = "joinTable";
  msg.payload = {
    ...payload,
    tableId: realRoom.id
  };

  // deixa cair no joinTable abaixo
}



    // -------------------------
    // JOIN TABLE
    // -------------------------
  if (msg.type === "joinTable") {

  const { tableId, seat, mode, name, reconnectToken } = msg.payload || {};

  if (!rooms.has(tableId)) {
    return send(ws, "error", { message: "Mesa inválida." });
  }

  const clientChips = Number(c.chipsBalance ?? c.chips ?? 0);

    if (name) {
      c.name = String(name).slice(0, 20);
    }


  // sai da mesa atual antes de entrar em outra
  leaveCurrentTable(clientId);

  const room = rooms.get(tableId);

  if (mode === "spectator") {
    joinAsSpectator(room, c, clientId, tableId, ws);
    return;
  }

  const s = Number(seat);

  if (!(s >= 1 && s <= 10)) {
    return send(ws, "error", { message: "Assento inválido." });
  }

  const existing = room.playersBySeat[s - 1];

  // ===== RECONEXÃO / ASSENTO JÁ OCUPADO =====
  if (existing) {
    const existingClient = existing.clientId ? clients.get(existing.clientId) : null;

    const stillConnected =
      existingClient &&
      existingClient.ws &&
      existingClient.ws.readyState === 1 &&
      !existing.disconnected &&
      existing.clientId !== clientId; // <- evita falso positivo no mesmo cliente

    if (stillConnected) {
      return send(ws, "error", {
        message: "Este jogador já está conectado em outra aba/janela."
      });
    }
    
    const canReclaim =
      reconnectToken &&
      existing.reconnectToken === reconnectToken &&
      !existing.eliminated;
   
    // se não pode reconectar, o assento continua ocupado
    if (!canReclaim) {

      if (existing.eliminated) {
        return send(ws, "error", {
          message: "Este jogador já foi eliminado desta partida."
        });
      }

      return send(ws, "error", { message: "Assento ocupado." });
    }

    attachClientToExistingPlayer(existing, c, clientId, tableId, s);

    existing.disconnected = false;
    existing.disconnectDeadline = 0;

    const room = rooms.get(tableId);

    if (room) {
      room.abandonedAt = 0;
      sendState(room.id);
    }

    if (existing.disconnectTimer) {
      clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
    }

    if (existing.disconnectTimer) {
      clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
    }
        
    if (room.matchEnded) {
      resetRoomForRematch(room);
    }

    send(ws, "joined", {
      tableId,
      mode: "player",
      seat: s,
      reconnectToken: existing.reconnectToken
    });

    refreshStartCountdown(room);
    scheduleMatchStart(room);
    broadcastRoomState(room);
    broadcastLobbyTable(room);

    return;
  }
  // ===== BLOQUEIO: jogador novo não pode entrar com a mesa já iniciada =====
  if (room.started && !room.matchEnded) {
    return send(ws, "error", {
      message: "A rodada já começou. Entre apenas como espectador."
    });
  }
/*
    if (typeof c.chips !== "number") {
    c.chips = 200000;
    }

  const mesaStack = (Number(room.buyIn) || 0) * 10;

  if ((Number(c.chips) || 0) < mesaStack) {
  return send(ws, "error", {
    message: "Saldo insuficiente para entrar nesta mesa."
  });
  }
*/

const mesaStack = (Number(room.buyIn) || 0) * 10;

if (clientChips < mesaStack) {
  return send(ws, "error", {
    message: "Saldo insuficiente para entrar nesta mesa."
  });
}



  // ===== JOGADOR NOVO =====
    const newPlayer = createPlayerForSeat(
    room,
    s,
    clientId,
    c,
    msg.payload?.avatarUrl
  );

  // 🔥 CONTAGEM DE JOGADORES E START TIMER
  refreshStartCountdown(room);

  c.tableId = tableId;
  c.seat = s;
  c.mode = "player";

    send(ws, "joined", {
    tableId,
    mode: "player",
    seat: s,
    reconnectToken: newPlayer.reconnectToken
  });

  tryStartMatch(room);
  scheduleMatchStart(room);
  sendState(room.id);
  broadcastOnlineStatus();
  return;
}
if (msg.type === "leaveTable") {
  leaveCurrentTable(clientId);
  return;
}


if (msg.type === "keepSeatForNextMatch") {
  const { tableId } = msg.payload || {};
  const room = rooms.get(tableId);

  if (!room) {
    return send(ws, "error", { message: "Mesa inválida." });
  }

  if (c.tableId !== tableId || c.mode !== "player" || !c.seat) {
    return send(ws, "error", { message: "Jogador inválido na mesa." });
  }

  const seat = Number(c.seat);
  const p = room.playersBySeat?.[seat - 1];

  if (!p || p.clientId !== clientId) {
    return send(ws, "error", { message: "Jogador inválido na mesa." });
  }

  // Este jogador escolheu ficar sentado para a próxima.
  // Não mexe na mesa inteira e não mexe nos outros jogadores.
  p.nextMatchReady = true;
  p.disconnected = false;
  p.eliminated = false;
  p.pendingRebuy = false;
  p.rebuyDeclined = false;
  p.pendingBatidaAfterDiscard = false;
  p.hand = [];
  p.jogosBaixados = [];
  p.obrigacaoBaixar = false;

  // Cachetão Pro
  p.vidas = 10;
  p.participando = false;
  p.passouRodada = false;
  p.marrou = false;

  // Mantém zerado só para não quebrar telas antigas ainda
  p.totalPoints = 0;
  p.lastRoundPoints = 0;

  refreshStartCountdown(room);

  broadcastRoomState(room);
  broadcastLobbyTable(room);
  return;
}


    // -------------------------
    // LEAVE - DEIXAR
    // -------------------------
    if (msg.type === "leaveTable") {

      leaveCurrentTable(clientId);

      send(ws, "left", {});

      return;
    }

    // -------------------------
    // ACTION - AÇÃO
    // -------------------------
    if (msg.type === "action") {

      const { tableId, action } = msg.payload || {};

      const room = rooms.get(tableId);

      if (!room)
        return send(ws, "error", { message: "Mesa inválida." });

      // ---------- RATE LIMIT ----------
      const now = Date.now();
      if (c.lastActionAt && now - c.lastActionAt < 80) {
        return;
      }
      c.lastActionAt = now;

      // ---------- SEQ ----------
      const seq = Number(action?.seq ?? 0);

      if (seq && seq <= c.lastSeq)
        return;

      if (seq)
        c.lastSeq = seq;

      const result = handleAction(clientId, tableId, action);

      if (!result.ok)
        send(ws, "error", { message: result.msg });

      return;
    }

  });

  ws.on("close", () => {
    const c = clients.get(clientId);
    if (!c) return;

    const tableId = c.tableId;
    const seat = c.seat;
    const mode = c.mode;

    // espectador sai direto
    if (mode === "spectator") {
      leaveCurrentTable(clientId);
      clients.delete(clientId);
      return;
    }

    // jogador: antes da partida começar, sai da mesa imediatamente
    if (tableId && seat) {
    const room = rooms.get(tableId);
    const p = room?.playersBySeat?.[seat - 1];

    if (room && p && p.clientId === clientId) {
  
    // se a partida ainda não começou, remove da mesa na hora
    if (!room.started || room.matchEnded || room.matchWinnerSeat || room.phase === "MATCH_END") {
    removePlayerFromSeat(room, seat, clientId);
    refreshStartCountdown(room);
    broadcastRoomState(room);
    broadcastOnlineStatus();
  }
    
  else {
    // se a partida já começou, mantém a lógica de reconexão
    p.disconnected = true;
    markRoomAbandonedIfNeeded(room);
    p.disconnectDeadline = 0;

    if (p.disconnectTimer) {
      clearTimeout(p.disconnectTimer);
      p.disconnectTimer = null;
    }

    if (room?.id) sendState(room.id);
  }
    }
  }

    clients.delete(clientId);
  });

  });

  server.listen(PORT, () => {
    console.log(`🃏 Cachetão Pro rodando em http://localhost:${PORT}`);
  });
