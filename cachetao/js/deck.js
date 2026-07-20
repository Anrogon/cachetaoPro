import { state } from "./state.js";

const NAIPES = ["espadas", "copas", "ouros", "paus"];
const VALORES = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
];

let cardIdCounter = 0;

export function initDeck() {
  state.deck = [];
  cardIdCounter = 0;

  // Cachetão Pro utiliza dois baralhos comuns,
  // sem coringas impressos.
  for (let deckIndex = 0; deckIndex < 2; deckIndex++) {
    for (const naipe of NAIPES) {
      for (const valor of VALORES) {
        state.deck.push({
          id: cardIdCounter++,
          valor,
          naipe
        });
      }
    }
  }
}

export function shuffleDeck() {
  for (let i = state.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [state.deck[i], state.deck[j]] = [
      state.deck[j],
      state.deck[i]
    ];
  }
}