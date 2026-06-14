import { initDeck, shuffleDeck } from "./deck.js";


export const state = {
  players: [],
  currentPlayer: 0,
  deck: [],
  lixo: [],
  table: [],
  selectedCards: [],
  faseTurno: "COMPRAR",
  origemCompra: null,
 // =============================
// TIMER DE TURNO (OFICIAL)
// =============================
turnSecondsLeft: 0,
turnTimerId: null,
turnDurationSec: 30,
turnOwnerId: null,
turnTimerToken: 0,
// ===== FICHAS / APOSTA (MVP) =====
pot: 0,
ante: 0,
matchPot: 0, // ✅ pote único (antes + rebuys)
lastWinnerId: null,
rebuyDecisionUntil: 0,
// ===== controle de próxima rodada (anti-duplicação) =====
nextRoundTimeoutId: null,
nextRoundLock: false,
rebuyDecisionUntil: 0,
houseRakePct: 0.05,        // 5% da casa (ajuste aqui)
matchFinalized: false,     // trava: finaliza 1x
houseTake: 0,              // quanto a casa levou no final
winnerPayout: 0,           // quanto o vencedor recebeu no final
winnerNet: 0,              // lucro líquido (se tiver chipsStart)
jaComprouNoTurno: false,
turnoTravado: false,
rodadaEncerrada: false,
partidaEncerrada: false,
  
};


window.state = state;

// =============================
// INICIALIZA ESTADO DO JOGO
// =============================
export function initState(playerName) {
  state.player.name = playerName;
  state.table = [];
  state.lixo = [];
  state.selectedCards = [];
  state.faseTurno = "COMPRAR";
  state.origemCompra = null;
  state.cartadoLixo = null;
  state.baixoucomLixo = false;
  state.obrigacaoBaixar = null;
  state.rodadaEncerrada = true;
  



}

state.table = [
  {
    type: "TRINCA", // ou "SEQUENCIA"
    cards: [ /* cartas */ ]
  }
];
export function currentPlayer() {
  return state.players[state.currentPlayer];
}

