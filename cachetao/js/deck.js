import { state } from "./state.js";

const naipes = ["espadas", "copas", "ouros", "paus"];
const valores = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

let cardIdCounter = 0;

export function initDeck() {
  state.deck = [];

  // 2 baralhos
  for (let d = 0; d < 2; d++) {
    for (const naipe of naipes) {
      for (const valor of valores) {
        state.deck.push({
          id: cardIdCounter++,
          valor,
          naipe
        });
      }
    }
  }

  // jokers
  for (let i = 0; i < 4; i++) {
    state.deck.push({
      id: cardIdCounter++,
      valor: "JOKER",
      isJoker: true
    });
  }

  shuffleDeck(state.deck);
}


// =============================
// EMBARALHAR BARALHO
// =============================
export function shuffleDeck() {
  for (let i = state.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
  }
}

export function dealCards() {
  for (let i = 0; i < 9; i++) {
    state.players.forEach(player => {
      player.hand.push(state.deck.pop());
    });
  }
}
