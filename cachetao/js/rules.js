import { state } from "./state.js";

/* =========================================================
   UTILIDADES
========================================================= */

export function valorIndex(valor) {
  const ordem = [
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

  return ordem.indexOf(valor);
}

/* =========================================================
   NORMALIZAÇÃO DE SEQUÊNCIA
========================================================= */

export function normalizeSequence(cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return null;
  }

  // Tenta primeiro com Ás baixo.
  // Caso não seja possível, tenta com Ás alto.
  return (
    normalizeSequenceInternal(cards, false) ||
    normalizeSequenceInternal(cards, true)
  );
}

function normalizeSequenceInternal(cards, asHigh) {
  const limpas = cards.filter(Boolean);

  if (limpas.length !== cards.length) {
    return null;
  }

  const reais = limpas.filter(card => !card.isJoker);
  const coringas = limpas.filter(card => card.isJoker);

  if (reais.length < 2) {
    return null;
  }

  const naipe = reais[0].naipe;

  if (!reais.every(card => card.naipe === naipe)) {
    return null;
  }

  const indexOfCard = card => {
    const index = valorIndex(card.valor);

    if (asHigh && index === 0) {
      return 13;
    }

    return index;
  };

  const valores = reais
    .map(indexOfCard)
    .sort((a, b) => a - b);

  // Não permite valores reais duplicados.
  for (let i = 1; i < valores.length; i++) {
    if (valores[i] === valores[i - 1]) {
      return null;
    }
  }

  // Ás alto não pode coexistir com o 2.
  if (
    asHigh &&
    valores.includes(13) &&
    valores.includes(1)
  ) {
    return null;
  }

  let buracos = 0;

  for (let i = 1; i < valores.length; i++) {
    buracos += valores[i] - valores[i - 1] - 1;
  }

  if (buracos > coringas.length) {
    return null;
  }

  const resultado = [];

  let atual = valores[0];
  const fim = valores[valores.length - 1];
  let coringaIndex = 0;

  while (atual <= fim) {
    const cartaReal = reais.find(card => {
      const base = valorIndex(card.valor);

      if (asHigh && atual === 13) {
        return base === 0;
      }

      return indexOfCard(card) === atual;
    });

    if (cartaReal) {
      resultado.push(cartaReal);
    } else {
      const coringa = coringas[coringaIndex++];

      if (!coringa) {
        return null;
      }

      resultado.push(coringa);
    }

    atual++;
  }

  // Mantém o comportamento atual:
  // coringas excedentes são colocados ao final.
  while (coringaIndex < coringas.length) {
    const coringa = coringas[coringaIndex++];

    if (!coringa) {
      return null;
    }

    resultado.push(coringa);
  }

  return resultado;
}

/* =========================================================
   TRINCA SEM CORINGA
========================================================= */

export function isValidTrinca(cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return false;
  }

  // A validação de trincas com coringa é tratada
  // separadamente no fluxo da batida.
  if (cards.some(card => card.isJoker)) {
    return false;
  }

  const valor = cards[0].valor;

  if (!cards.every(card => card.valor === valor)) {
    return false;
  }

  // Cachetão Pro: trinca com três naipes diferentes.
  const naipesUnicos = new Set(
    cards.map(card => card.naipe)
  );

  return naipesUnicos.size === 3;
}

/* =========================================================
   SEQUÊNCIA SEM CORINGA
========================================================= */

export function isValidSequence(cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return false;
  }

  const naipe = cards[0].naipe;

  if (!cards.every(card => card.naipe === naipe)) {
    return false;
  }

  const base = cards.map(card => valorIndex(card.valor));

  // Ás baixo.
  const low = [...base].sort((a, b) => a - b);

  let sequenciaValida = true;

  for (let i = 1; i < low.length; i++) {
    if (low[i] !== low[i - 1] + 1) {
      sequenciaValida = false;
      break;
    }
  }

  if (sequenciaValida) {
    return true;
  }

  // Sem Ás, não existe tentativa com Ás alto.
  if (!low.includes(0)) {
    return false;
  }

  // Retira o Ás baixo e o transforma em valor alto.
  const high = low
    .filter(value => value !== 0)
    .concat(13)
    .sort((a, b) => a - b);

  // Uma sequência com Ás alto precisa terminar em K-A.
  if (high[high.length - 2] !== 12) {
    return false;
  }

  for (let i = 1; i < high.length; i++) {
    if (high[i] !== high[i - 1] + 1) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   SEQUÊNCIA COM CORINGA
========================================================= */

export function isSequenciaComCoringa(cards) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return false;
  }

  return (
    isSequenciaComCoringaInternal(cards, false) ||
    isSequenciaComCoringaInternal(cards, true)
  );
}

function isSequenciaComCoringaInternal(cards, asHigh) {
  const reais = cards.filter(
    card => card && !card.isJoker
  );

  const coringas = cards.filter(
    card => card && card.isJoker
  );

  // Estrutura especial de dois coringas e uma carta real.
  // A batida decide posteriormente se o uso é permitido.
  if (
    reais.length === 1 &&
    coringas.length === 2
  ) {
    return true;
  }

  if (reais.length < 2) {
    return false;
  }

  const naipe = reais[0].naipe;

  if (!reais.every(card => card.naipe === naipe)) {
    return false;
  }

  const indexOfCard = card => {
    const index = valorIndex(card.valor);

    if (asHigh && index === 0) {
      return 13;
    }

    return index;
  };

  const valores = reais
    .map(indexOfCard)
    .sort((a, b) => a - b);

  // Não permite valores reais duplicados.
  for (let i = 1; i < valores.length; i++) {
    if (valores[i] === valores[i - 1]) {
      return false;
    }
  }

  // Ás alto não pode coexistir com o 2.
  if (
    asHigh &&
    valores.includes(13) &&
    valores.includes(1)
  ) {
    return false;
  }

  let buracos = 0;

  for (let i = 1; i < valores.length; i++) {
    const diferenca = valores[i] - valores[i - 1];

    if (diferenca > 1) {
      buracos += diferenca - 1;
    }
  }

  if (buracos > coringas.length) {
    return false;
  }

  // Regra atual da gaveta:
  // todos os coringas precisam ocupar buracos internos.
  // Não pode sobrar coringa nas pontas.
  const sobra = coringas.length - buracos;

  return sobra === 0;
}

/* =========================================================
   VALIDAÇÃO DE SEQUÊNCIA COM CORINGA
========================================================= */

export function isSequenciaComCoringaValida(
  cards,
  { isBatida = false } = {}
) {
  if (!Array.isArray(cards) || cards.length < 3) {
    return false;
  }

  const limpas = cards.filter(Boolean);

  if (limpas.length !== cards.length) {
    return false;
  }

  return (
    isSeqCoringaInternal(limpas, false, isBatida) ||
    isSeqCoringaInternal(limpas, true, isBatida)
  );
}

function isSeqCoringaInternal(cards, asHigh, isBatida) {
  const reais = cards.filter(card => !card.isJoker);
  const coringas = cards.filter(card => card.isJoker);

  // Dois coringas e uma carta real são permitidos
  // somente durante a validação de batida.
  if (
    isBatida &&
    reais.length === 1 &&
    coringas.length === 2
  ) {
    return true;
  }

  if (reais.length < 2) {
    return false;
  }

  const naipe = reais[0].naipe;

  if (!reais.every(card => card.naipe === naipe)) {
    return false;
  }

  const indexOfCard = card => {
    const index = valorIndex(card.valor);

    if (asHigh && index === 0) {
      return 13;
    }

    return index;
  };

  const valores = reais
    .map(indexOfCard)
    .sort((a, b) => a - b);

  for (let i = 1; i < valores.length; i++) {
    if (valores[i] <= valores[i - 1]) {
      return false;
    }
  }

  // Ás alto não pode coexistir com o 2.
  if (
    asHigh &&
    valores.includes(13) &&
    valores.includes(1)
  ) {
    return false;
  }

  let buracos = 0;

  for (let i = 1; i < valores.length; i++) {
    buracos += valores[i] - valores[i - 1] - 1;
  }

  if (coringas.length < buracos) {
    return false;
  }

  // Regra atual da gaveta:
  // não permite coringa sobrando nas pontas.
  const sobra = coringas.length - buracos;

  return sobra === 0;
}

/* =========================================================
   GUARDIÃO DA OBRIGAÇÃO DE BAIXAR
========================================================= */

export function guardiaoRegra4(acao) {
  if (!state.obrigacaoBaixar) {
    return true;
  }

  if (acao === "DESCARTAR") {
    alert(
      "❌ Você é obrigado a baixar um jogo antes de descartar"
    );

    return false;
  }

  if (acao === "COMPRAR") {
    return true;
  }

  if (acao === "BAIXAR") {
    return true;
  }

  return true;
}

/* =========================================================
   VERIFICA SE UMA CARTA PODE SER COLOCADA NA MESA
========================================================= */

export function canPlaceCardOnTable(card, tableGroups) {
  if (!card || !Array.isArray(tableGroups)) {
    return false;
  }

  if (card.isJoker) {
    return tableGroups.some(group => {
      return (
        group?.type === "SEQUENCIA" &&
        canJokerFitInSequencia(group)
      );
    });
  }

  return tableGroups.some(group => {
    if (!group) {
      return false;
    }

    if (group.type === "TRINCA") {
      return canFitInTrinca(card, group);
    }

    if (group.type === "SEQUENCIA") {
      return canFitInSequencia(card, group);
    }

    return false;
  });
}

function canFitInTrinca(card, grupo) {
  const mesa = Array.isArray(grupo.cards)
    ? grupo.cards
    : [];

  const reaisMesa = mesa.filter(
    carta => carta && !carta.isJoker
  );

  if (reaisMesa.length < 3) {
    return false;
  }

  const valorAlvo = reaisMesa[0].valor;

  if (card.valor !== valorAlvo) {
    return false;
  }

  // Mantém a regra atualmente usada pelo descarte:
  // considera encaixável quando o naipe já existe na trinca.
  const naipesUsados = new Set(
    reaisMesa.map(carta => carta.naipe)
  );

  return naipesUsados.has(card.naipe);
}

function canFitInSequencia(card, grupo) {
  const mesa = Array.isArray(grupo.cards)
    ? grupo.cards
    : [];

  if (mesa.length < 3) {
    return false;
  }

  const reaisMesa = mesa.filter(
    carta => carta && !carta.isJoker
  );

  if (reaisMesa.length < 2) {
    return false;
  }

  const naipe = reaisMesa[0].naipe;

  if (
    !naipe ||
    !reaisMesa.every(carta => carta.naipe === naipe)
  ) {
    return false;
  }

  if (card.naipe !== naipe) {
    return false;
  }

  // Tenta adicionar diretamente na sequência.
  if (isSequenciaComCoringa([...mesa, card])) {
    return true;
  }

  // Caso haja coringa na mesa, tenta substituir um deles
  // pela carta real recebida.
  const indicesCoringas = mesa
    .map((carta, index) => {
      return carta && carta.isJoker
        ? index
        : -1;
    })
    .filter(index => index !== -1);

  for (const index of indicesCoringas) {
    const tentativa = mesa.filter(
      (_, position) => position !== index
    );

    tentativa.push(card);

    if (isSequenciaComCoringa(tentativa)) {
      return true;
    }
  }

  return false;
}

function canJokerFitInSequencia(grupo) {
  const mesa = Array.isArray(grupo.cards)
    ? grupo.cards
    : [];

  const reaisMesa = mesa.filter(
    carta => carta && !carta.isJoker
  );

  if (reaisMesa.length < 2) {
    return false;
  }

  const naipe = reaisMesa[0].naipe;

  if (
    !naipe ||
    !reaisMesa.every(carta => carta.naipe === naipe)
  ) {
    return false;
  }

  // Mantém o comportamento atual usado pelo bloqueio
  // de descarte do coringa.
  return reaisMesa.length >= 3;
}