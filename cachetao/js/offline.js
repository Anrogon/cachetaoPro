import { state } from "./state.js";
import { showScreen } from "./screens.js";
import { initPlayers, collectAnte, dealInitialCardsAnimated } from "./actions.js";
import { initDeck, shuffleDeck } from "./deck.js";
import { renderAll, bindTableUI } from "./render.js";


export function bindOfflineStartGame() {
  const btn = document.getElementById("startGame");
  if (!btn) return;

  btn.onclick = async () => {
    const qtd = Number(document.getElementById("playerCount").value);

    // 1) jogadores
    initPlayers(qtd);

    // nome do humano
    const nome = document.getElementById("player-name")?.value?.trim();
    if (nome) state.players[0].name = nome;

    // garante buy-in/mesa
    const buyIn = typeof state.room?.buyIn === "number" ? state.room.buyIn : 1000;
    state.room = { ...(state.room || {}), buyIn };

    // saldo inicial
    const CHIPS_INICIAIS = Math.max(200000, buyIn * 10);
    for (const p of state.players) {
      p.eliminated = false;
      p.hand = [];
      p.jogosBaixados = p.jogosBaixados || [];
      p.jogosBaixados.length = 0;

      if (typeof p.chips !== "number" || p.chips <= 0) p.chips = CHIPS_INICIAIS;
      p.chips = Math.max(0, p.chips - buyIn);
    }

    // jogador inicial + fase inicial
    state.currentPlayer = 0;
    state.faseTurno = "COMPRAR";
    state.selectedCards = [];

    // mostra o jogo
    showScreen("game");
    renderAll();
    bindTableUI();

    // pote/ante
    state.matchPot = 0;
    collectAnte();

    // deck novo sempre
    initDeck();
    shuffleDeck();

    // agora a animação acontece com a UI já visível
    await dealInitialCardsAnimated(9);

    // render final
    renderAll();
  };
}