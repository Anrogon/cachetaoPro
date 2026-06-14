import { state } from "./state.js";
import { comprarDoMonte, discardSelectedCard, nextPlayer, desistirDoLixoEPassar } from "./actions.js";

// ✅ sem import de currentPlayer (evita erro e loop)
// usa o índice atual do state
function currentP() {
  return state.players?.[state.currentPlayer] || null;
}

function pickAutoDiscardCard(hand) {
  const cards = (hand || []).filter(c => c && !c.isJoker);
  if (!cards.length) return null;

  const weight = (c) => {
    if (c.valor === "A") return 20;
    if (c.valor === "J" || c.valor === "Q" || c.valor === "K") return 10;
    const n = Number(c.valor);
    return Number.isFinite(n) ? n : 0;
  };

  let best = cards[0];
  let bestPts = weight(best);

  for (const c of cards) {
    const pts = weight(c);
    if (pts > bestPts) {
      bestPts = pts;
      best = c;
    }
  }
  return best;
}


export function stopTurnTimer() {
  // ✅ invalida timers antigos UMA VEZ
  state.turnTimerToken = (state.turnTimerToken || 0) + 1;

  if (state.turnTimerId) {
    clearInterval(state.turnTimerId);
    state.turnTimerId = null;
    state.turnTimerTargetMs = 0;
  }
}

export function updateTurnTimerUI() {
  const t = document.getElementById("sbTimerText");
  const bar = document.getElementById("sbTimerBar");

  const left = typeof state.turnSecondsLeft === "number" ? state.turnSecondsLeft : 0;
  const dur = typeof state.turnDurationSec === "number" ? state.turnDurationSec : 20;

  if (t) t.textContent = `⏱ ${left}s`;

  const pct = dur > 0 ? Math.max(0, Math.min(100, (left / dur) * 100)) : 0;
  if (bar) bar.style.width = `${pct}%`;
}

// ✅ “cinto e suspensório”: se algum lugar chamar sem importar, não quebra
window.updateTurnTimerUI = updateTurnTimerUI;



export function startTurnTimer() {
  const p = currentP();
  const ownerId = p?.id ?? null;
  const turnEndsAt = Number(state.turnEndsAt) || 0;
  const durationSec =
    Number.isFinite(Number(state.turnDurationSec)) && Number(state.turnDurationSec) > 0
      ? Number(state.turnDurationSec)
      : 30;

  // sem turno válido => para o timer
  if (ownerId == null || !turnEndsAt || state.rodadaEncerrada || state.matchEnded) {
    stopTurnTimer();
    state.turnSecondsLeft = 0;
    updateTurnTimerUI();
    return;
  }

  // se já está rodando para o mesmo prazo, não reinicia
  if (
    state.turnTimerId &&
    state.turnOwnerId === ownerId &&
    Number(state.turnTimerTargetMs) === turnEndsAt
  ) {
    const visualEndsAt = Number(state.turnTimerVisualEndsAt) || turnEndsAt;
    const left = Math.max(0, Math.ceil((visualEndsAt - Date.now()) / 1000));
    state.turnSecondsLeft = left;
    updateTurnTimerUI();
    return;
  }

  stopTurnTimer();

  state.turnOwnerId = ownerId;
  state.turnTimerTargetMs = turnEndsAt;
  const maxLeft = Number(state.turnDurationSec) || 30;
  state.turnTimerVisualEndsAt = Math.min(turnEndsAt, Date.now() + maxLeft * 1000);
  state.turnDurationSec = durationSec;

  const tick = () => {
    const visualEndsAt = Number(state.turnTimerVisualEndsAt) || turnEndsAt;
    const left = Math.max(0, Math.ceil((visualEndsAt - Date.now()) / 1000));
    state.turnSecondsLeft = left;
    updateTurnTimerUI();

    if (left <= 0) {
      stopTurnTimer();
    }
  };

  tick();

  state.turnTimerId = setInterval(() => {
    // se mudou o dono visual do turno ou mudou o prazo, reinicia pelo renderAll
    const cp = currentP();
    if (!cp || cp.id == null || cp.id !== state.turnOwnerId) {
      stopTurnTimer();
      return;
    }

    if (Number(state.turnTimerTargetMs) !== turnEndsAt) {
      stopTurnTimer();
      return;
    }

    if (state.rodadaEncerrada || state.matchEnded) {
      stopTurnTimer();
      return;
    }

    tick();
  }, 250);
}