/* =========================================================
   ESTADO GLOBAL DO JOGO
========================================================= */

export const state = {
  /* =======================================================
     JOGADORES E POSIÇÃO
  ======================================================= */

  players: [],
  currentPlayer: 0,

  mySeat: null,
  currentSeat: null,

  tableId: null,
  room: null,

  spectator: false,

  /* =======================================================
     CARTAS E MESA
  ======================================================= */

  deck: [],
  lixo: [],
  table: [],
  hand: [],

  selectedCards: [],

  origemCompra: null,
  cartaDoLixo: null,
  baixouComLixo: false,
  obrigacaoBaixar: false,

  /* =======================================================
     TURNO E RODADA
  ======================================================= */

  fase: null,
  faseTurno: "COMPRAR",

  jaComprouNoTurno: false,
  turnoTravado: false,

  rodadaEncerrada: false,
  partidaEncerrada: false,

  /* =======================================================
     TIMER DE TURNO
  ======================================================= */

  turnSecondsLeft: 0,
  turnTimerId: null,
  turnDurationSec: 30,
  turnOwnerId: null,
  turnTimerToken: 0,

  /* =======================================================
     FICHAS, POTE E RESULTADO
  ======================================================= */

  pot: 0,
  ante: 0,

  matchPot: 0,
  lastWinnerId: null,

  houseRakePct: 0.05,
  matchFinalized: false,

  houseTake: 0,
  winnerPayout: 0,
  winnerNet: 0,

  vencedor: null,

  /* =======================================================
     REBUY
  ======================================================= */

  rebuyDecisionUntil: 0,

  /* =======================================================
     CONTROLE DA PRÓXIMA RODADA
  ======================================================= */

  nextRoundTimeoutId: null,
  nextRoundLock: false
};


/*
 * Mantido por compatibilidade com trechos antigos que acessam
 * o estado através de window.state.
 */
window.state = state;


/* =========================================================
   JOGADOR ATUAL
========================================================= */

export function currentPlayer() {
  const mySeat = Number(state.mySeat || 0);
  const tableId = state.tableId || state.room?.id;

  const tablePlayer =
    tableId && mySeat > 0
      ? window.state?.tables?.[tableId]?.seats?.[mySeat - 1]
      : null;

  const localPlayer =
    state.players?.[state.currentPlayer] || null;

  /*
   * Quando existem dados públicos da mesa e dados locais da mão,
   * combina os dois sem perder as cartas privadas do jogador.
   */
  if (tablePlayer && localPlayer) {
    return {
      ...localPlayer,
      ...tablePlayer,
      hand: localPlayer.hand || []
    };
  }

  return localPlayer || tablePlayer || null;
}