import { state } from "./state.js";

/* =========================================================
   JOGADOR ATUAL DO TURNO
========================================================= */

function currentP() {
  return state.players?.[state.currentPlayer] || null;
}

/* =========================================================
   ENCERRAR TIMER
========================================================= */

export function stopTurnTimer() {
  // Invalida qualquer timer anterior.
  state.turnTimerToken =
    (Number(state.turnTimerToken) || 0) + 1;

  if (state.turnTimerId) {
    clearInterval(state.turnTimerId);
    state.turnTimerId = null;
  }

  state.turnTimerTargetMs = 0;
  state.turnTimerVisualEndsAt = 0;
}

/* =========================================================
   ATUALIZAR INTERFACE
========================================================= */

export function updateTurnTimerUI() {
  const timerText =
    document.getElementById("sbTimerText");

  const timerBar =
    document.getElementById("sbTimerBar");

  const secondsLeft =
    typeof state.turnSecondsLeft === "number"
      ? state.turnSecondsLeft
      : 0;

  const durationSeconds =
    typeof state.turnDurationSec === "number"
      ? state.turnDurationSec
      : 30;

  if (timerText) {
    timerText.textContent = `⏱ ${secondsLeft}s`;
  }

  const percentage =
    durationSeconds > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (secondsLeft / durationSeconds) * 100
          )
        )
      : 0;

  if (timerBar) {
    timerBar.style.width = `${percentage}%`;
  }
}

/*
 * Compatibilidade com trechos antigos que possam chamar
 * updateTurnTimerUI() através do objeto window.
 */
window.updateTurnTimerUI = updateTurnTimerUI;

/* =========================================================
   INICIAR TIMER
========================================================= */

export function startTurnTimer() {
  const player = currentP();

  const ownerId = player?.id ?? null;
  const turnEndsAt = Number(state.turnEndsAt) || 0;

  const configuredDuration =
    Number(state.turnDurationSec);

  const durationSeconds =
    Number.isFinite(configuredDuration) &&
    configuredDuration > 0
      ? configuredDuration
      : 30;

  /*
   * Sem turno válido, com rodada encerrada ou partida
   * finalizada, o contador deve permanecer parado.
   */
  if (
    ownerId == null ||
    !turnEndsAt ||
    state.rodadaEncerrada ||
    state.matchEnded
  ) {
    stopTurnTimer();

    state.turnOwnerId = null;
    state.turnSecondsLeft = 0;

    updateTurnTimerUI();
    return;
  }

  /*
   * Evita reiniciar o intervalo quando ele já está
   * acompanhando o mesmo jogador e o mesmo prazo.
   */
  if (
    state.turnTimerId &&
    state.turnOwnerId === ownerId &&
    Number(state.turnTimerTargetMs) === turnEndsAt
  ) {
    const visualEndsAt =
      Number(state.turnTimerVisualEndsAt) ||
      turnEndsAt;

    state.turnSecondsLeft = Math.max(
      0,
      Math.ceil(
        (visualEndsAt - Date.now()) / 1000
      )
    );

    updateTurnTimerUI();
    return;
  }

  stopTurnTimer();

  state.turnOwnerId = ownerId;
  state.turnTimerTargetMs = turnEndsAt;
  state.turnDurationSec = durationSeconds;

  /*
   * O prazo visual nunca ultrapassa a duração máxima
   * configurada para o turno.
   */
  state.turnTimerVisualEndsAt = Math.min(
    turnEndsAt,
    Date.now() + durationSeconds * 1000
  );

  const tick = () => {
    const visualEndsAt =
      Number(state.turnTimerVisualEndsAt) ||
      turnEndsAt;

    const secondsLeft = Math.max(
      0,
      Math.ceil(
        (visualEndsAt - Date.now()) / 1000
      )
    );

    state.turnSecondsLeft = secondsLeft;

    updateTurnTimerUI();

    if (secondsLeft <= 0) {
      stopTurnTimer();
    }
  };

  tick();

  state.turnTimerId = setInterval(() => {
    const currentPlayer = currentP();

    /*
     * Caso o jogador do turno tenha mudado, o próximo
     * render iniciará um novo contador.
     */
    if (
      !currentPlayer ||
      currentPlayer.id == null ||
      currentPlayer.id !== state.turnOwnerId
    ) {
      stopTurnTimer();
      return;
    }

    /*
     * Se o servidor enviou um novo prazo, o timer atual
     * deve ser encerrado para que seja recriado.
     */
    if (
      Number(state.turnTimerTargetMs) !== turnEndsAt
    ) {
      stopTurnTimer();
      return;
    }

    if (
      state.rodadaEncerrada ||
      state.matchEnded
    ) {
      stopTurnTimer();
      return;
    }

    tick();
  }, 250);
}