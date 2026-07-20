import { state } from "./state.js";


export function finalizeMatchIfNeeded() {
  if (!state.partidaEncerrada) return;
  if (state.matchFinalized) return;

  const winner = state.players?.find(
    p => String(p.id) === String(state.vencedor)
  );

  if (!winner) {
    state.matchFinalized = true;
    return;
  }

  // Garante valores numéricos.
  winner.chips = Number(winner.chips) || 0;
  state.matchPot = Number(state.matchPot) || 0;

  const rakePct = Number(state.houseRakePct);

  const pct = Number.isFinite(rakePct)
    ? Math.max(0, Math.min(0.5, rakePct))
    : 0.05;

  // A casa retira uma porcentagem do pote final.
  const house = Math.floor(state.matchPot * pct);
  const payout = Math.max(0, state.matchPot - house);

  // Paga o vencedor e zera o pote.
  winner.chips += payout;

  state.houseTake = house;
  state.winnerPayout = payout;

  // Calcula o lucro líquido quando chipsStart estiver disponível.
  const start = Number(winner.chipsStart);

  if (Number.isFinite(start)) {
    state.winnerNet = winner.chips - start;
  } else {
    state.winnerNet = payout;
  }

  state.matchPot = 0;
  state.matchFinalized = true;

  console.log("🏆 FINALIZADO:", {
    winner: winner.name,
    payout,
    house
  });
}


export function guardiaoRodadaEncerrada() {
  return !state.rodadaEncerrada;
}


export function validaBatida(jogador) {
  // Proteção contra dados ausentes ou inválidos.
  if (!jogador || !Array.isArray(jogador.jogosBaixados)) {
    return false;
  }

  // Só pode bater quando não restarem cartas na mão.
  if (jogador.hand.length !== 0) {
    return false;
  }

  for (const jogo of jogador.jogosBaixados) {
    const cartas = jogo.cards || [];

    const coringas = cartas.filter(c => c && c.isJoker);
    const reais = cartas.filter(c => c && !c.isJoker);

    // =====================================================
    // REGRA ESPECIAL — 2 coringas + 1 carta real
    // =====================================================

    if (reais.length === 1 && coringas.length === 2) {
      continue;
    }

    // =====================================================
    // SEQUÊNCIA
    // =====================================================

    if (jogo.type === "SEQUENCIA") {
      // Uma sequência formada somente por coringas é inválida.
      if (reais.length === 0) {
        return false;
      }

      // Durante a batida, os coringas podem completar a sequência.
      continue;
    }

    // =====================================================
    // TRINCA — cartas reais do mesmo valor e naipes diferentes
    // =====================================================

    if (jogo.type === "TRINCA") {
      if (reais.length === 0) {
        return false;
      }

      const valor = reais[0].valor;

      for (const carta of reais) {
        if (carta.valor !== valor) {
          return false;
        }
      }

      const naipesReais = reais
        .map(carta => carta.naipe)
        .filter(Boolean);

      const naipesUnicos = new Set(naipesReais);

      // Nunca permite naipe real repetido em uma trinca.
      // Exemplo inválido: 8♥ 8♥ + coringa.
      if (naipesUnicos.size !== naipesReais.length) {
        return false;
      }

      // Trinca sem coringa: 3 ou 4 cartas reais,
      // todas com naipes diferentes.
      if (coringas.length === 0) {
        if (reais.length < 3) {
          return false;
        }

        if (reais.length > 4) {
          return false;
        }

        continue;
      }

      // Trinca com um coringa:
      // exatamente duas cartas reais de naipes diferentes.
      if (coringas.length === 1) {
        if (reais.length !== 2) {
          return false;
        }

        if (naipesUnicos.size !== 2) {
          return false;
        }

        continue;
      }

      // Dois coringas com uma carta real já foram tratados
      // pela regra especial acima.
      return false;
    }

    // Qualquer tipo de jogo desconhecido é inválido.
    return false;
  }

  return true;
}


// =========================================================
// PONTUAÇÃO ANTIGA — MANTIDA TEMPORARIAMENTE
// Ainda existem chamadas no actions.js e no render.js.
// =========================================================

export function cardPoints(card) {
  if (!card) {
    return 0;
  }

  if (card.isJoker) {
    return 20;
  }

  if (card.valor === "A") {
    return 15;
  }

  if (
    card.valor === "J" ||
    card.valor === "Q" ||
    card.valor === "K"
  ) {
    return 10;
  }

  const value = Number(card.valor);

  return Number.isFinite(value) ? value : 0;
}


export function handPoints(hand) {
  if (!Array.isArray(hand)) {
    return 0;
  }

  return hand.reduce(
    (total, card) => total + cardPoints(card),
    0
  );
}


export function applyRoundScoring(
  winnerId = state.players?.[state.currentPlayer]?.id
) {
  // matchPot é o pote único da partida.
  // Ele não recebe os pontos calculados nas rodadas.
  if (typeof state.matchPot !== "number") {
    state.matchPot = 0;
  }

  // Total pago pelos perdedores ao vencedor da rodada.
  let totalPaidToWinner = 0;

  // Pontuação e transferência de fichas.
  for (const player of state.players) {
    if (player.eliminated) {
      continue;
    }

    const points = handPoints(player.hand);

    if (typeof player.totalPoints !== "number") {
      player.totalPoints = 0;
    }

    if (!Array.isArray(player.roundPoints)) {
      player.roundPoints = [];
    }

    player.totalPoints += points;
    player.roundPoints.push(points);

    // O vencedor não paga as próprias cartas.
    if (player.id !== winnerId) {
      player.chips = Number(player.chips) || 0;

      const loss = Math.max(0, points);
      const paid = Math.min(player.chips, loss);

      player.chips -= paid;
      totalPaidToWinner += paid;
    }

    if (player.totalPoints > 100) {
      player.eliminated = true;
    }
  }

  // O vencedor recebe o total pago pelos demais jogadores.
  const winner = state.players.find(
    player => player.id === winnerId
  );

  if (winner && !winner.eliminated) {
    winner.chips = Number(winner.chips) || 0;
    winner.chips += totalPaidToWinner;

    state.lastWinnerId = winnerId;
  }

  // Elimina jogadores que ficaram sem fichas.
  for (const player of state.players) {
    if (
      !player.eliminated &&
      (Number(player.chips) || 0) <= 0
    ) {
      player.eliminated = true;
    }
  }

  // Verifica se a partida chegou ao fim.
  const activePlayers = state.players.filter(
    player => !player.eliminated
  );

  if (activePlayers.length <= 1) {
    state.partidaEncerrada = true;

    state.vencedor =
      activePlayers.length === 1
        ? activePlayers[0].id
        : null;

    // Encerra qualquer janela de rebuy ainda pendente.
    state.rebuyDecisionUntil = 0;

    for (const player of state.players) {
      player.pendingRebuy = false;
      player.rebuyDeclined = true;
    }

    finalizeMatchIfNeeded();
  }
}