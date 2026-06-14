export function getCardImage(card) {
  if (card.ehCoringa) {
    return "assets/cards/CORINGA.png";
  }

  return `assets/cards/${card.valor}_${card.naipe}.png`;
}
