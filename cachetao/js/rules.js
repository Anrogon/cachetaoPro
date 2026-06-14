/// =============================
// UTILIDADES
// =============================

export function valorIndex(valor) {
  const ordem = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  return ordem.indexOf(valor);
}



export function normalizeSequence(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return null;

  // tenta primeiro Ás baixo; se não der, tenta Ás alto
  return (
    normalizeSequenceInternal(cards, false) ||
    normalizeSequenceInternal(cards, true)
  );
}

function normalizeSequenceInternal(cards, asHigh) {
  const limpas = cards.filter(Boolean);
  if (limpas.length !== cards.length) return null;

  const reais = limpas.filter(c => !c.isJoker);
  const coringas = limpas.filter(c => c.isJoker);

  if (reais.length < 2) return null;

  const naipe = reais[0].naipe;
  if (!reais.every(c => c.naipe === naipe)) return null;

  const idx = (c) => {
    const v = valorIndex(c.valor); // A = 0
    if (asHigh && v === 0) return 13; // A alto
    return v;
  };

  const valores = reais.map(idx).sort((a, b) => a - b);

  // sem duplicados
  for (let i = 1; i < valores.length; i++) {
    if (valores[i] === valores[i - 1]) return null;
  }

  // A alto não pode coexistir com 2
  if (asHigh && valores.includes(13) && valores.includes(1)) return null;

  // buracos internos
  let buracos = 0;
  for (let i = 1; i < valores.length; i++) {
    buracos += valores[i] - valores[i - 1] - 1;
  }
  if (buracos > coringas.length) return null;

  const resultado = [];
  let atual = valores[0];
  let fim = valores[valores.length - 1];
  let coringaIdx = 0;

  while (atual <= fim) {
    const real = reais.find(c => {
      const base = valorIndex(c.valor);
      if (asHigh && atual === 13) return base === 0; // Ás
      return idx(c) === atual;
    });

    if (real) {
      resultado.push(real);
    } else {
      const joker = coringas[coringaIdx++];
      if (!joker) return null; // ✅ nunca retorna undefined
      resultado.push(joker);
    }

    atual++;
  }

  // sobrou coringa? vai pro final
  while (coringaIdx < coringas.length) {
    const joker = coringas[coringaIdx++];
    if (!joker) return null;
    resultado.push(joker);
  }

  return resultado;
}



export function getCardValue(card, asHigh = false) {
  if (card.valor === 1 && asHigh) return 14;
  return card.valor;
}


export function isSequence(cards) {
  return normalizeSequence(cards) !== null;
}
// =============================
// VALIDA TRINCA
// =============================
export function isValidTrinca(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  // trinca normal: sem coringa (batida especial você trata fora)
  if (cards.some(c => c.isJoker)) return false;

  const valor = cards[0].valor;
  if (!cards.every(c => c.valor === valor)) return false;

  // Pontinho Clássico: exatamente 3 naipes diferentes (pode repetir naipe)
  const naipesUnicos = new Set(cards.map(c => c.naipe));
  if (naipesUnicos.size !== 3) return false;

  return true;
}




// =============================
// VALIDA SEQUÊNCIA
// =============================
export function isValidSequence(cards) {
  if (cards.length < 3) return false;

  const naipe = cards[0].naipe;
  if (!cards.every(c => c.naipe === naipe)) return false;

  const base = cards.map(c => valorIndex(c.valor));

  // ======================
  // TENTATIVA 1 — Ás baixo
  // ======================
  const low = [...base].sort((a,b) => a-b);
  let ok = true;

  for (let i = 1; i < low.length; i++) {
    if (low[i] !== low[i-1] + 1) {
      ok = false;
      break;
    }
  }
  if (ok) return true;

  // ======================
  // TENTATIVA 2 — Ás alto
  // ======================
  if (!low.includes(0)) return false; // não tem Ás, acabou

  // remove o Ás e promove ele a 13
  const high = low
    .filter(v => v !== 0)
    .concat(13)        // Ás como valor alto
    .sort((a,b) => a-b);

  // precisa terminar em K + Ás
  if (high[high.length - 2] !== 12) return false;

  for (let i = 1; i < high.length; i++) {
    if (high[i] !== high[i-1] + 1) {
      return false;
    }
  }

  return true;
}



export function canAddToTrinca(card, jogo) {
  const valor = jogo.cards[0].valor;

  // valor deve ser igual
  if (card.valor !== valor) return false;

  // só pode adicionar se o naipe já existir na trinca
  const naipesPermitidos = jogo.cards.map(c => c.naipe);

  if (!naipesPermitidos.includes(card.naipe)) return false;

  return true;
}


export function isSequenciaComCoringa(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  return (
    isSequenciaComCoringaInternal(cards, false) || // Ás baixo
    isSequenciaComCoringaInternal(cards, true)     // Ás alto
  );
}

function isSequenciaComCoringaInternal(cards, asHigh) {
  const reais = cards.filter(c => c && !c.isJoker);
  const coringas = cards.filter(c => c && c.isJoker);

  // ✅ REGRA 9 — estrutura válida (batida decide depois)
  if (reais.length === 1 && coringas.length === 2) return true;

  // precisa de pelo menos 2 reais para sequência
  if (reais.length < 2) return false;

  // 🔒 mesmo naipe
  const naipe = reais[0].naipe;
  if (!reais.every(c => c.naipe === naipe)) return false;

  // índice “avaliado” (sem mexer no valorIndex!)
  const idx = (c) => {
    const v = valorIndex(c.valor);
    if (asHigh && v === 0) return 13; // Ás como alto
    return v;
  };

  let valores = reais.map(idx).sort((a, b) => a - b);

  // não permite duplicados
  for (let i = 1; i < valores.length; i++) {
    if (valores[i] === valores[i - 1]) return false;
  }

  // Se estiver tentando Ás alto, não pode coexistir com "2"
  if (asHigh) {
    const temAsAlto = valores.includes(13);
    const temDois = valores.includes(1); // "2" => 1
    if (temAsAlto && temDois) return false;
  }

  // calcula buracos internos
  let buracos = 0;
  for (let i = 1; i < valores.length; i++) {
    const diff = valores[i] - valores[i - 1];
    if (diff > 1) buracos += diff - 1;
  }

  // não tem coringa suficiente pra fechar buracos
  if (buracos > coringas.length) return false;

  // 🔒 CLÁSSICO: REGRA DA GAVETA (sem "ponta aberta" com coringa)
  // Depois de fechar buracos internos, NÃO pode sobrar coringa para pontas.
  // (isso bloqueia 6-7-🃏, 🃏-6-7, Q-K-🃏 etc.)
  const sobra = coringas.length - buracos;
  if (sobra > 0) return false;

  return true;
}


export function isSequenciaComCoringaValida(cards, { isBatida = false } = {}) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  const limpas = cards.filter(Boolean);
  if (limpas.length !== cards.length) return false;

  // tenta Ás baixo e Ás alto
  return (
    isSeqCoringaInternal(limpas, false, isBatida) ||
    isSeqCoringaInternal(limpas, true, isBatida)
  );
}

function isSeqCoringaInternal(cards, asHigh, isBatida) {
  const reais = cards.filter(c => !c.isJoker);
  const coringas = cards.filter(c => c.isJoker);

  // ✅ REGRA 9 — 2 coringas + 1 carta (SÓ NA BATIDA)
  if (isBatida && reais.length === 1 && coringas.length === 2) return true;

  if (reais.length < 2) return false;

  const naipe = reais[0].naipe;
  if (!reais.every(c => c.naipe === naipe)) return false;

  const idx = (c) => {
    const v = valorIndex(c.valor);
    if (asHigh && v === 0) return 13; // Ás alto
    return v;
  };

  const valores = reais.map(idx).sort((a, b) => a - b);

  for (let i = 1; i < valores.length; i++) {
    if (valores[i] <= valores[i - 1]) return false; // duplicado ou regressão
  }

  // A alto não pode coexistir com 2
  if (asHigh && valores.includes(13) && valores.includes(1)) return false;

  let gaps = 0;
  for (let i = 1; i < valores.length; i++) {
    gaps += valores[i] - valores[i - 1] - 1;
  }

  // precisa ter coringa suficiente pra fechar buracos
  if (coringas.length < gaps) return false;

  // 🔒 CLÁSSICO: regra da gaveta (sem coringa sobrando nas pontas)
  // Ex.: 6-7-🃏 (gaps=0, coringas=1) => inválido
  // Ex.: 2-4-🃏 (gaps=1, coringas=1) => válido (🃏=3)
  // Ex.: 8-9-🃏-🃏 (gaps=0, coringas=2) => inválido (sobra)
  const sobra = coringas.length - gaps;
  if (sobra > 0) return false;

  return true;
}


export function ordenarSequenciaComCoringa(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return null;

  return (
    ordenarSequenciaComCoringaInternal(cards, false) ||
    ordenarSequenciaComCoringaInternal(cards, true)
  );
}

function ordenarSequenciaComCoringaInternal(cards, asHigh) {
  const limpas = cards.filter(Boolean);
  if (limpas.length !== cards.length) return null;

  const reais = limpas.filter(c => !c.isJoker);
  const coringas = limpas.filter(c => c.isJoker);

  if (reais.length < 2) return null;

  const naipe = reais[0].naipe;
  if (!reais.every(c => c.naipe === naipe)) return null;

  const idx = (c) => {
    const v = valorIndex(c.valor);
    if (asHigh && v === 0) return 13;
    return v;
  };

  const reaisOrdenados = [...reais].sort((a, b) => idx(a) - idx(b));
  const valores = reaisOrdenados.map(idx);

  // duplicado ou regressão
  for (let i = 1; i < valores.length; i++) {
    if (valores[i] <= valores[i - 1]) return null;
  }

  // A alto não pode coexistir com 2
  if (asHigh && valores.includes(13) && valores.includes(1)) return null;

  const jokers = [...coringas]; // cópia

  const resultado = [];
  let esperado = valores[0];

  for (let i = 0; i < reaisOrdenados.length; i++) {
    const alvo = valores[i];

    while (alvo > esperado) {
      const j = jokers.shift();
      if (!j) return null; // ✅ aqui evita undefined
      resultado.push(j);
      esperado++;
    }

    resultado.push(reaisOrdenados[i]);
    esperado++;
  }

  // sobrou coringa -> pontas (final)
  while (jokers.length) {
    const j = jokers.shift();
    if (!j) return null;
    resultado.push(j);
  }

  return resultado;
}


function validaComGaveta(valores, qtdCoringas, asAlto) {
  let usados = 0;

  // ajusta Ás alto
  const vals = valores.map(v => {
    if (v === 0 && asAlto) return 13;
    return v;
  }).sort((a, b) => a - b);

  for (let i = 1; i < vals.length; i++) {
    const diff = vals[i] - vals[i - 1];

    if (diff === 0) return false; // valor repetido

    if (diff > 1) {
      usados += diff - 1;
      if (usados > qtdCoringas) return false;
    }
  }

  // 🚨 REGRA DA GAVETA:
  // coringa NÃO pode ficar nas pontas
  const min = vals[0];
  const max = vals[vals.length - 1];

  const inicioLivre = min > 0;
  const fimLivre = max < 13;

  // precisa ter carta real antes e depois
  if (!inicioLivre || !fimLivre) return false;

  return true;
}

export function guardiaoRegra4(acao) {
  // Se não existe obrigação, libera tudo
  if (!state.obrigacaoBaixar) return true;

  // Enquanto houver obrigação, NÃO pode descartar
  if (acao === "DESCARTAR") {
    alert("❌ Você é obrigado a baixar um jogo antes de descartar");
    return false;
  }

  // Comprar é sempre permitido
  if (acao === "COMPRAR") return true;

  // Baixar é permitido (é justamente o que vai cumprir a obrigação)
  if (acao === "BAIXAR") return true;

  return true;
}

/*export function canPlaceCardOnTable(card, table) {
  if (!card || !Array.isArray(table)) return false;

  for (const jogo of table) {
    if (!jogo || !Array.isArray(jogo.cards)) continue;

    // ===== SEQUÊNCIA =====
    if (jogo.type === "SEQUENCIA") {
      const tentativa = [...jogo.cards, card];

      if (isSequenciaComCoringaValida(tentativa)) {
        const norm = normalizeSequence(tentativa);
        if (norm) return true;
      }
    }

    // ===== TRINCA (Pontinho Clássico) =====
    if (jogo.type === "TRINCA") {
      const reais = jogo.cards.filter(c => c && !c.isJoker);
      if (reais.length === 0) continue;

      // precisa ser mesmo valor
      if (reais[0].valor !== card.valor) continue;

      // Naipes permitidos: se existir allowedSuits no jogo, usa ele.
      // Senão, cai no conjunto atual (fallback).
      const allowed = Array.isArray(jogo.allowedSuits)
        ? jogo.allowedSuits
        : Array.from(new Set(reais.map(c => c.naipe)));

      // Só pode adicionar se o naipe estiver entre os permitidos
      if (allowed.includes(card.naipe)) return true;
    }
  }

  return false;
}

export function canPlaceCardOnTable(card, tableGroups) {
  if (!card || !Array.isArray(tableGroups)) return false;

  // Joker: pode encaixar SOMENTE em sequência (nunca em trinca)
  if (card.isJoker) {
    return tableGroups.some(g => canJokerFitInSequenceGroup(g));
  }

  // não-joker: mantém sua regra atual (se já existir)
  // Se você já tem lógica antiga, coloque aqui.
  // Fallback simples: tenta encaixar como extensão de sequência ou como trinca.
  return tableGroups.some(g => canNormalCardFitGroup(card, g));
}
*/
//----------------------------------

export function canPlaceCardOnTable(card, tableGroups) {
  if (!card || !Array.isArray(tableGroups)) return false;

  // você já proíbe descartar coringa no discardSelectedCard,
  // mas aqui mantemos coerente:
  if (card.isJoker) {
    // Joker só pode encaixar em SEQUENCIA (nunca em TRINCA)
    return tableGroups.some(g => g?.type === "SEQUENCIA" && canJokerFitInSequencia(card, g));
  }

  return tableGroups.some(g => {
    if (!g) return false;
    if (g.type === "TRINCA") return canFitInTrinca(card, g);
    if (g.type === "SEQUENCIA") return canFitInSequencia(card, g);
    return false;
  });
}

/* ===================== helpers ===================== */

function canFitInTrinca(card, grupo) {
  const mesa = Array.isArray(grupo.cards) ? grupo.cards : [];
  const reaisMesa = mesa.filter(c => c && !c.isJoker);
  if (reaisMesa.length < 3) return false;

  const valorAlvo = reaisMesa[0].valor;
  if (card.valor !== valorAlvo) return false;

  // ✅ sua regra: só pode adicionar se o NAIPE JÁ EXISTE na trinca
  const naipesUsados = new Set(reaisMesa.map(c => c.naipe));
  return naipesUsados.has(card.naipe);
}

function canFitInSequencia(card, grupo) {
  const mesa = Array.isArray(grupo.cards) ? grupo.cards : [];
  if (mesa.length < 3) return false;

  const reaisMesa = mesa.filter(c => c && !c.isJoker);
  if (reaisMesa.length < 2) return false;

  // mesmo naipe entre as reais (e a carta precisa ser desse naipe)
  const naipe = reaisMesa[0].naipe;
  if (!naipe || !reaisMesa.every(c => c.naipe === naipe)) return false;
  if (card.naipe !== naipe) return false;

  // ✅ 1) tentar adicionar direto (ponta ou buraco no meio)
  // Isso pega: 4-5-6-7 + 8, e 4-6 + 5, etc.
  if (isSequenciaComCoringa([...mesa, card])) return true;

  // ✅ 2) se há coringa na mesa: tentar substituir UM coringa por essa carta real
  // Isso pega exatamente: 9♦ 🃏 J♦ + 10♦
  const idxJokers = mesa
    .map((c, i) => (c && c.isJoker ? i : -1))
    .filter(i => i !== -1);

  for (const idx of idxJokers) {
    const tentativa = mesa.filter((_, i) => i !== idx); // remove 1 joker
    tentativa.push(card);                               // coloca a carta real
    if (isSequenciaComCoringa(tentativa)) return true;
  }

  return false;
}






function canJokerFitInSequencia(_joker, grupo) {
  const mesa = Array.isArray(grupo.cards) ? grupo.cards : [];
  const reaisMesa = mesa.filter(c => c && !c.isJoker);

  // joker em sequência: só consideramos possível se já houver uma sequência com pelo menos 2 reais
  if (reaisMesa.length < 2) return false;

  // mesmo naipe entre reais
  const naipe = reaisMesa[0].naipe;
  if (!naipe || !reaisMesa.every(c => c.naipe === naipe)) return false;

  // joker pode “entrar” se a sequência tiver pelo menos 3 cartas reais
  // (evita bloquear descartes em situações pequenas e mantém seu estilo de jogo)
  return reaisMesa.length >= 3;
}
//------------------------------------
/* ========= helpers ========= */
/*
function canJokerFitInSequenceGroup(group) {
  // group pode estar em formatos diferentes no seu projeto:
  // - array de cards
  // - objeto { cards: [...] }
  const cards = Array.isArray(group) ? group : group?.cards;
  if (!Array.isArray(cards) || cards.length < 2) return false;

  // se tiver cartas de naipes mistos, não é sequência
  const nonJ = cards.filter(c => !c.isJoker);
  if (nonJ.length < 2) return false;

  const suit = nonJ[0].suit;
  if (!suit) return false;
  if (nonJ.some(c => c.suit !== suit)) return false;

  // pega ranks (assumindo 1..13 ou A..K convertido)
  const ranks = nonJ.map(c => Number(c.rank ?? c.value ?? c.num)).filter(n => Number.isFinite(n));
  if (ranks.length < 2) return false;

  ranks.sort((a,b)=>a-b);

  // Caso “normal”: se já é uma sequência com buracos, o joker pode preencher buraco,
  // ou pode estender nas pontas.
  // Regras conservadoras:
  // - se existir qualquer gap >=2 entre ranks consecutivos, o joker pode preencher (ex: 4 e 6)
  // - ou estender abaixo (min-1) / acima (max+1)
  // Observação: não precisa de "gaveta" para isso, porque estamos só checando possibilidade.
  for (let i = 1; i < ranks.length; i++) {
    const gap = ranks[i] - ranks[i-1];
    if (gap >= 2) return true; // joker preenche um dos buracos
  }
  return true; // se não tem gap, ainda pode estender numa ponta
}

function canNormalCardFitGroup(card, group) {
  const cards = Array.isArray(group) ? group : group?.cards;
  if (!Array.isArray(cards) || cards.length === 0) return false;

  // se grupo parece trinca: mesmo rank (ignorando coringas)
  const nonJ = cards.filter(c => !c.isJoker);
  const r = Number(nonJ[0]?.rank ?? nonJ[0]?.value ?? nonJ[0]?.num);
  const cardRank = Number(card.rank ?? card.value ?? card.num);

  const isTrinca = nonJ.length >= 2 && nonJ.every(c => Number(c.rank ?? c.value ?? c.num) === r);
  if (isTrinca) {
    return Number.isFinite(cardRank) && cardRank === r;
  }

  // sequência: mesmo naipe (ignorando coringas)
  const suit = nonJ[0]?.suit;
  if (suit && card.suit !== suit) return false;

  const ranks = nonJ.map(c => Number(c.rank ?? c.value ?? c.num)).filter(Number.isFinite);
  if (!ranks.length) return false;

  const min = Math.min(...ranks);
  const max = Math.max(...ranks);

  // pode encaixar se for min-1 ou max+1 ou preencher gap de 1
  if (cardRank === min - 1 || cardRank === max + 1) return true;

  // gap interno: existe a-1 e a+1 no grupo?
  const set = new Set(ranks);
  return set.has(cardRank - 1) && set.has(cardRank + 1);
}
*/