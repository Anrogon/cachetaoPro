
import { toggleSelectCard, comprarDoMonte, discardSelectedCard, layDownSelectedSet, pegarDoLixo } from "./actions.js";
import { addCardToTableGame, onClickLixo, reorderHandByIds, getRebuyCost, requestRebuy, playVictorySound } from "./actions.js";
import { handPoints } from "./endgame.js"; 
import { state, currentPlayer } from "./state.js";
import { swapJokerOnTable, requestCancelCrazyBatidaAttempt, requestStartCrazyBatidaAttempt, declineRebuy } from "./actions.js";

// =============================
// RESOLVER IMAGEM DA CARTA
// =============================
export function getCardImage(card) {
  if (!card) {
    console.warn("⚠️ getCardImage recebeu carta inválida:", card);
    return "assets/cards/back.png";
  }

  if (card.isJoker) {
    return "assets/cards/joker.png";
  }

  return `assets/cards/${card.valor}_${card.naipe}.png`;
}


export function renderPlayerInfo() {
  const el = document.getElementById("player-info");
  if (!el) return;

    const linhas = state.players.map((pl, idx) => {
    const pts = typeof pl.totalPoints === "number" ? pl.totalPoints : 0;
    const vez = idx === state.currentPlayer ? "👉 " : "";
    const morto = pl.eliminated ? " ☠️" : "";
    const offline = pl.disconnected ? " (Offline)" : "";
    return `${vez}${pl.name}${offline}: ${pts} pts${morto}`;
  });

  el.innerText = linhas.join(" | ");
}

// =============================
// ANIMAÇÃO: CARTA VOADORA + SOM
// =============================

let dealAudio = null;
let dealAudioPlaying = false;

function getDealAudio() {
  if (!dealAudio) {
    dealAudio = new Audio("/assets/sfx/carta.mp3");
    dealAudio.loop = true;
    dealAudio.volume = 0.2;
  }
  return dealAudio;
}



let __audioCtx = null;



function getAudioCtx() {
  if (!__audioCtx) {
    __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return __audioCtx;
}


function beep({ freq = 700, duration = 0.03, type = "square", gain = 0.03 } = {}) {
  try {
    const ctx = getAudioCtx();

    const doPlay = () => {
      try {
        const o = ctx.createOscillator();
        const g = ctx.createGain();

        o.type = type;
        o.frequency.value = freq;

        // ataque/queda suaves pra evitar clique seco
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(gain, now + 0.005);
        g.gain.linearRampToValueAtTime(0.0001, now + duration);

        o.connect(g);
        g.connect(ctx.destination);

        o.start(now);
        o.stop(now + duration + 0.01);
      } catch (err) {
        console.error("[BEEP] erro ao tocar", err);
      }
    };

    if (ctx.state === "suspended") {
      ctx.resume()
        .then(doPlay)
        .catch(err => console.error("[BEEP] erro ao destravar áudio", err));
      return;
    }

    doPlay();
  } catch (err) {
    console.error("[BEEP] erro geral", err);
  }
}

function playSfx(name) {
  try {
    unlockAudioOnce();
  } catch (_) {}

  console.log("[SFX] playSfx", name);

  // sons mais audíveis
  if (name === "deal") {
  const freq = 860 + Math.random() * 140; // varia entre ~860 e ~1000
  return beep({ freq, duration: 0.05, type: "triangle", gain: 0.06 });
  }
  if (name === "draw")  return beep({ freq: 760, duration: 0.05, type: "triangle", gain: 0.05 });
  if (name === "place") return beep({ freq: 610, duration: 0.05, type: "square", gain: 0.05 });
  if (name === "drop")  return beep({ freq: 420, duration: 0.06, type: "sine", gain: 0.05 });

  if (name === "win") {
    beep({ freq: 620, duration: 0.07, type: "triangle", gain: 0.05 });
    setTimeout(() => beep({ freq: 820, duration: 0.09, type: "triangle", gain: 0.055 }), 85);
    setTimeout(() => beep({ freq: 1040, duration: 0.12, type: "triangle", gain: 0.06 }), 180);
    return;
  }
}

let lastDealSfxAt = 0;
let audioUnlockBound = false;
let lastRoundWinSfxTs = 0;

function playDealSfxTick() {
  playSfx("deal");
}

function unlockAudioOnce() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  } catch (_) {}
}

function bindAudioUnlockOnce() {
  if (audioUnlockBound) return;
  audioUnlockBound = true;

  const handler = () => {
    unlockAudioOnce();
    window.removeEventListener("pointerdown", handler, true);
    window.removeEventListener("touchstart", handler, true);
    window.removeEventListener("keydown", handler, true);
  };

  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("keydown", handler, true);
}

window.playSfx = playSfx;
window.playDealSfxTick = playDealSfxTick;
window.unlockAudioOnce = unlockAudioOnce;

bindAudioUnlockOnce();

function playRoundWinSfxOnce(summary) {
  const ts = Number(summary?.timestamp || 0);
  if (!ts) return;
  if (ts === lastRoundWinSfxTs) return;

  lastRoundWinSfxTs = ts;
  playSfx("win");
}

/**
 * Faz uma carta “voar” do elemento fromEl até toEl
 */
export function flyCard({ fromEl, toEl, card, sfx = null, duration = 280 }) {
  if (!fromEl || !toEl || !card) return;

  const from = fromEl.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();

  const img = getCardImage(card);

  const clone = document.createElement("div");
  clone.className = "flying-card";
  clone.style.backgroundImage = `url('${img}')`;

  // posição inicial
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;

  // delta até o destino
  const dx = (to.left - from.left);
  const dy = (to.top - from.top);

  clone.style.setProperty("--dx", `${dx}px`);
  clone.style.setProperty("--dy", `${dy}px`);

  // aplica mesma duração no CSS (opcional)
  clone.style.transitionDuration = `${duration}ms`;

  document.body.appendChild(clone);

  // som sincronizado no START
  // durante DEALING usamos o mp3 do overlay, então não toca o beep "deal" aqui
  if (sfx && !(sfx === "deal" && state.faseTurno === "DEALING")) {
    playSfx(sfx);
  }

  // dispara animação no próximo frame
  requestAnimationFrame(() => {
    clone.classList.add("done");
    clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(.95)`;
  });

  // remove no fim
  setTimeout(() => {
    clone.remove();
  }, duration + 50);
}


export function renderNextPlayerButton() {
  const btn = document.getElementById("nextPlayer");
  if (!btn) return;

  // Partida encerrada
  if (state.partidaEncerrada) {
    btn.innerText = "Partida encerrada";
    btn.disabled = true;
    return;
  }

  // Fim da rodada: botão vira "Próxima rodada"
  if (state.rodadaEncerrada || state.faseTurno === "FIM_RODADA") {
    btn.innerText = "Próxima rodada";
    btn.disabled = false;
    return;
  }

  // Rodada em andamento: botão é "Próximo jogador"
  btn.innerText = "Próximo jogador";

  // trava enquanto o turno não terminou
  // (libera quando voltou para COMPRAR, ou seja, já descartou e passou o turno)
  btn.disabled = state.faseTurno !== "COMPRAR";
}

let ignoreNextCardClick = false;

const touchDragState = {
  fromId: null,
  fromEl: null,
  targetId: null,
  targetEl: null,
  startX: 0,
  startY: 0,
  dragging: false,
  holdTimer: null
};

function clearTouchDragState() {
  if (touchDragState.holdTimer) {
    clearTimeout(touchDragState.holdTimer);
    touchDragState.holdTimer = null;
  }

  touchDragState.fromId = null;
  touchDragState.startX = 0;
  touchDragState.startY = 0;
  touchDragState.dragging = false;

  if (touchDragState.fromEl) {
    touchDragState.fromEl.classList.remove("touch-dragging");
  }
  if (touchDragState.targetEl) {
    touchDragState.targetEl.classList.remove("touch-drop-target");
  }

  touchDragState.fromEl = null;
  touchDragState.targetId = null;
  touchDragState.targetEl = null;
}

function findCardElementFromTouch(touch) {
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (!el) return null;
  return el.closest?.(".card") || null;
}

export function createCardElement(card, { selectable = false } = {}) {
  const div = document.createElement("div");
  div.className = "card";
  div.style.backgroundImage = `url('${getCardImage(card)}')`;

  // ✅ aplica visual de seleção
  if (state.selectedCards.includes(card.id)) {
    div.classList.add("selected");
  }

  if (selectable && !state.spectator) {
    div.onclick = () => {
      if (ignoreNextCardClick) {
        ignoreNextCardClick = false;
        return;
      }

      toggleSelectCard(card.id);
      renderAll();
    };
  }
  return div;
}


export function renderHand() {
  const handEl = document.getElementById("hand");
  handEl.innerHTML = "";

  const player = currentPlayer();
  if (!player || !Array.isArray(player.hand)) return;

  const isDealing =
    state.faseTurno === "DEALING" &&
    Number(state.dealEndsAt || 0) > Date.now();

  if (isDealing) {
    const total = player.hand.length;
    const dealMs = Number(state.dealMs) || 2200;
    const endAt = Number(state.dealEndsAt) || 0;
    const elapsed = Math.max(0, dealMs - Math.max(0, endAt - Date.now()));
    const stepMs = total > 0 ? Math.max(70, Math.floor(dealMs / total)) : 120;
    const visibleCount = Math.min(total, Math.floor(elapsed / stepMs));

    for (let i = 0; i < visibleCount; i++) {
      const div = document.createElement("div");
      div.className = "card";
      div.style.backgroundImage = "url('assets/cards/back.png')";
      div.style.opacity = "0.98";
      div.style.transform = "translateY(-6px)";
      div.style.transition = "transform 120ms ease";
      handEl.appendChild(div);
    }

    return;
  }

  player.hand.forEach(card => {
    const div = createCardElement(card, { selectable: true });

    if (state.selectedCards.includes(card.id)) {
      div.classList.add("selected");
    }

    div.draggable = true;
    div.dataset.cardId = String(card.id);

    // ===== DESKTOP DRAG =====
    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(card.id));

      // arrastou = entrou em modo manual
      state.handSort = null;
    });

    div.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    div.addEventListener("drop", (e) => {
      e.preventDefault();

      const fromId = e.dataTransfer.getData("text/plain");
      const toId = div.dataset.cardId;

      if (!fromId || !toId || fromId === toId) return;

      reorderHandByIds(fromId, toId);

      // drag & drop define a nova ordem manual
      state.handSort = null;
      state.manualHandOrder = currentPlayer().hand.map(card => String(card.id));

      if (typeof window.renderAll === "function") window.renderAll();
    });

    // ===== MOBILE TOUCH DRAG =====
    div.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) return;

      const t = e.touches[0];

      clearTouchDragState();

      touchDragState.fromId = String(card.id);
      touchDragState.fromEl = div;
      touchDragState.startX = t.clientX;
      touchDragState.startY = t.clientY;

      // toque longo entra em modo arrastar
      touchDragState.holdTimer = setTimeout(() => {
        touchDragState.dragging = true;
        state.handSort = null;
        div.classList.add("touch-dragging");
      }, 180);
    }, { passive: true });

    div.addEventListener("touchmove", (e) => {
      if (!e.touches || e.touches.length !== 1) return;

      const t = e.touches[0];
      const dx = t.clientX - touchDragState.startX;
      const dy = t.clientY - touchDragState.startY;
      const dist = Math.hypot(dx, dy);

      // se mexeu antes do toque longo, cancela o drag e deixa rolar/scrollar normal
      if (!touchDragState.dragging && dist > 10) {
        if (touchDragState.holdTimer) {
          clearTimeout(touchDragState.holdTimer);
          touchDragState.holdTimer = null;
        }
        return;
      }

      if (!touchDragState.dragging) return;

      e.preventDefault();

      if (touchDragState.targetEl) {
        touchDragState.targetEl.classList.remove("touch-drop-target");
        touchDragState.targetEl = null;
        touchDragState.targetId = null;
      }

      const targetEl = findCardElementFromTouch(t);
      if (!targetEl) return;

      const toId = targetEl.dataset.cardId;
      if (!toId || toId === touchDragState.fromId) return;

      touchDragState.targetEl = targetEl;
      touchDragState.targetId = toId;
      targetEl.classList.add("touch-drop-target");
    }, { passive: false });

    div.addEventListener("touchend", (e) => {
      // se ainda estava esperando toque longo, cancela
      if (touchDragState.holdTimer) {
        clearTimeout(touchDragState.holdTimer);
        touchDragState.holdTimer = null;
      }

      if (!touchDragState.dragging) {
        clearTouchDragState();
        return;
      }

      const fromId = touchDragState.fromId;
      const toId = touchDragState.targetId;

      if (fromId && toId && fromId !== toId) {
        reorderHandByIds(fromId, toId);

        state.handSort = null;
        state.manualHandOrder = currentPlayer().hand.map(card => String(card.id));

        if (typeof window.renderAll === "function") window.renderAll();
      }

      clearTouchDragState();
    }, { passive: true });

    div.addEventListener("touchcancel", clearTouchDragState, { passive: true });

    handEl.appendChild(div);
  });
}

export function renderTable() {
  // Mostrar vencedor da partida
  if (state.matchEnded && state.matchWinnerSeat) {
    const winner = state.seats?.[state.matchWinnerSeat - 1];

    if (winner) {
      showMessage(`🏆 ${winner.name} venceu a partida!`);
    }

    return;
  }

  const el = document.getElementById("table");
  if (!el) return;

  el.onclick = () => {
    if (state.selectedCards.length >= 3) {
      layDownSelectedSet();
      renderAll();
    }
  };

  el.innerHTML = "";

  const isMobilePortrait =
    window.matchMedia?.("(max-width: 520px) and (orientation: portrait)")?.matches;

  let topLayer = null;
  let bottomLayer = null;

  if (isMobilePortrait) {
    topLayer = document.createElement("div");
    topLayer.className = "table-melds-layer table-melds-top";

    bottomLayer = document.createElement("div");
    bottomLayer.className = "table-melds-layer table-melds-bottom";

    el.appendChild(topLayer);
    el.appendChild(bottomLayer);
  }

  const totalMelds = state.table.length;
  const splitIndex = isMobilePortrait
  ? 6
  : totalMelds;

  state.table.forEach((jogo, index) => {
    const group = document.createElement("div");
    group.className = "grupo-table";
    group.dataset.meldIndex = String(index);

    jogo.cards.forEach((card, cardIndex) => {
      const div = document.createElement("div");
      div.className = "card";
      div.style.backgroundImage = `url('${getCardImage(card)}')`;

      // ✅ clique no coringa da mesa = tentar substituir pelo carta real selecionada
      if (card?.isJoker) {
        div.onclick = (e) => {
          e.stopPropagation();
          swapJokerOnTable(index, cardIndex);
          renderAll();
        };
      }

      group.appendChild(div);
    });

    group.onclick = () => {
      addCardToTableGame(index);
      renderAll();
    };

    if (isMobilePortrait) {
      if (index < splitIndex) {
        bottomLayer.appendChild(group);
      } else {
        topLayer.appendChild(group);
      }
    } else {
      el.appendChild(group);
    }
  });

  // 👇 BANNER "FULANO BATEU!" sem piscar
  let banner = document.getElementById("batidaBanner");

  const shouldShowBatidaBanner =
    !!state.batidaAnnouncement &&
    Number(state.batidaAnnouncementEndsAt || 0) > Date.now();

  if (!shouldShowBatidaBanner) {
    if (banner) {
      banner.remove();
    }

    if (window.__batidaBannerHideTimer) {
      clearTimeout(window.__batidaBannerHideTimer);
      window.__batidaBannerHideTimer = null;
    }
  } else {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "batidaBanner";
      document.body.appendChild(banner);
    }

    if (banner.textContent !== state.batidaAnnouncement) {
      banner.textContent = state.batidaAnnouncement;
    }

    const msLeft = Math.max(0, Number(state.batidaAnnouncementEndsAt || 0) - Date.now());

    if (window.__batidaBannerHideTimer) {
      clearTimeout(window.__batidaBannerHideTimer);
      window.__batidaBannerHideTimer = null;
    }

    window.__batidaBannerHideTimer = setTimeout(() => {
      const current = document.getElementById("batidaBanner");
      if (current) current.remove();
      window.__batidaBannerHideTimer = null;
    }, msLeft);
  }

  // 👇 BANNER DE RODADA (ex: baralho acabou)
  let roundBanner = document.getElementById("roundBanner");

  const shouldShowRoundBanner =
    !!state.roundAnnouncement &&
    Number(state.roundAnnouncementEndsAt || 0) > Date.now();

  if (!shouldShowRoundBanner) {
    if (roundBanner) {
      roundBanner.remove();
    }

    if (window.__roundBannerHideTimer) {
      clearTimeout(window.__roundBannerHideTimer);
      window.__roundBannerHideTimer = null;
    }
  } else {
    if (!roundBanner) {
      roundBanner = document.createElement("div");
      roundBanner.id = "roundBanner";
      document.body.appendChild(roundBanner);
    }

    if (roundBanner.textContent !== state.roundAnnouncement) {
      roundBanner.textContent = state.roundAnnouncement;
    }

    const msLeft = Math.max(
      0,
      Number(state.roundAnnouncementEndsAt || 0) - Date.now()
    );

    if (window.__roundBannerHideTimer) {
      clearTimeout(window.__roundBannerHideTimer);
      window.__roundBannerHideTimer = null;
    }

    window.__roundBannerHideTimer = setTimeout(() => {
      const current = document.getElementById("roundBanner");
      if (current) current.remove();
      window.__roundBannerHideTimer = null;
    }, msLeft);
  }

  playPendingHandToTableAnimation();

}

let pendingDrawAnimTimer = null;

export function playPendingDrawAnimation() {
  const fx = state.pendingDeckToHandAnim;
  if (!fx?.cardId) return;

  const monteEl = document.getElementById("monte");
  const toEl = document.querySelector(`.card[data-card-id="${String(fx.cardId)}"]`);

  if (!monteEl || !toEl) return;

  const player = currentPlayer?.();
  const card =
    Array.isArray(player?.hand)
      ? player.hand.find(c => String(c.id) === String(fx.cardId))
      : null;

  if (!card) return;

  clearTimeout(pendingDrawAnimTimer);

  // evita repetir a mesma animação
  state.pendingDeckToHandAnim = null;

  // pequena espera para garantir layout pronto
  pendingDrawAnimTimer = setTimeout(() => {
    flyCard({
      fromEl: monteEl,
      toEl,
      card,
      sfx: "draw",
      duration: 400
    });
/*
    toEl.classList.add("pop-in");
    setTimeout(() => toEl.classList.remove("pop-in"), 220);*/
  }, 30);
}

let pendingDiscardAnimTimer = null;

export function playPendingDiscardDrawAnimation() {
  const fx = state.pendingDiscardToHandAnim;
  if (!fx?.cardId) return;

  const lixoEl = document.getElementById("lixo");
  const toEl = document.querySelector(`.card[data-card-id="${String(fx.cardId)}"]`);

  if (!lixoEl || !toEl) return;

  const player = currentPlayer?.();
  const card =
    Array.isArray(player?.hand)
      ? player.hand.find(c => String(c.id) === String(fx.cardId))
      : null;

  if (!card) return;

  clearTimeout(pendingDiscardAnimTimer);

  // evita repetir
  state.pendingDiscardToHandAnim = null;

  pendingDiscardAnimTimer = setTimeout(() => {
    flyCard({
      fromEl: lixoEl,
      toEl,
      card,
      sfx: "draw",
      duration: 400
    });
/*
    toEl.classList.add("pop-in");
    setTimeout(() => toEl.classList.remove("pop-in"), 240);*/
  }, 30);
}


let pendingHandToTableTimer = null;

export function playPendingHandToTableAnimation() {
  const fx = state.pendingHandToTableAnim;
  if (!fx?.cardIds?.length) return;

  clearTimeout(pendingHandToTableTimer);

  const ids = fx.cardIds.map(String);
  const snapshots = Array.isArray(fx.cardSnapshots) ? fx.cardSnapshots : [];
  const targetMeldIndex =
    Number.isInteger(fx.targetMeldIndex) ? fx.targetMeldIndex : null;

  state.pendingHandToTableAnim = null;

  pendingHandToTableTimer = setTimeout(() => {
    let tableEl = null;

    if (targetMeldIndex != null) {
      tableEl = document.querySelector(`.grupo-table[data-meld-index="${targetMeldIndex}"]`);
    }

    if (!tableEl) {
      tableEl =
        document.querySelector(".table-melds") ||
        document.getElementById("tableMelds") ||
        document.getElementById("table") ||
        document.getElementById("game");
    }

    if (!tableEl) return;

    ids.forEach((id, i) => {
      const snap = snapshots.find(s => String(s.id) === String(id));
      if (!snap?.rect) return;

      const ghost = document.createElement("div");
      ghost.className = "card";
      ghost.style.position = "fixed";
      ghost.style.left = `${snap.rect.left}px`;
      ghost.style.top = `${snap.rect.top}px`;
      ghost.style.width = `${snap.rect.width}px`;
      ghost.style.height = `${snap.rect.height}px`;
      ghost.style.pointerEvents = "none";
      ghost.style.zIndex = "99999";
      ghost.style.borderRadius = "10px";
      ghost.style.boxShadow = "0 10px 24px rgba(0,0,0,0.28)";
      ghost.style.backgroundImage = "url('./assets/cards/back.png')";
      ghost.style.backgroundSize = "cover";
      ghost.style.backgroundPosition = "center";
      ghost.style.backgroundRepeat = "no-repeat";

      document.body.appendChild(ghost);

      const targetRect = tableEl.getBoundingClientRect();
      const dx =
        (targetRect.left + targetRect.width / 2) -
        (snap.rect.left + snap.rect.width / 2);
      const dy =
        (targetRect.top + targetRect.height / 2) -
        (snap.rect.top + snap.rect.height / 2);

      ghost.animate(
        [
          {
            transform: "translate(0px, 0px) scale(1)",
            opacity: 1
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(0.88)`,
            opacity: 0.88
          }
        ],
        {
          duration: 360 + i * 50,
          easing: "ease-out",
          fill: "forwards"
        }
      );

      setTimeout(() => {
        ghost.remove();
      }, 420 + i * 50);
    });
  }, 40);
}


export function renderMonte() {
  const el = document.getElementById("monte");
  el.style.backgroundImage = "url('./assets/cards/back.png')";
  el.onclick = () => {
    comprarDoMonte(); // só 1 vez
    // no online, NÃO precisa renderAll()
  };
}

export function renderLixo() {
  const lixoEl = document.getElementById("lixo");
  if (!lixoEl) return;

  // ✅ clique do lixo é contextual:
  // - DESCARTAR: lixo = descartar carta selecionada
  // - COMPRAR: lixo = pegar do lixo (ou bloqueado)
  // - BAIXAR + travado do lixo: lixo = devolver e passar
  lixoEl.onclick = () => {
    if (state.faseTurno === "DESCARTAR" || state.faseTurno === "BAIXAR") {
      discardSelectedCard();
      if (typeof window.renderAll === "function") window.renderAll();
      return;
    }

    if (state.faseTurno === "COMPRAR") {
      onClickLixo(); // pega do lixo
      if (typeof window.renderAll === "function") window.renderAll();
      return;
    }

    // travado no lixo (pegou do lixo e ainda não baixou): clicar no lixo devolve
    if (
      state.faseTurno === "BAIXAR" &&
      state.origemCompra === "LIXO" &&
      state.cartaDoLixo &&
      !state.baixouComLixo
    ) {
      onClickLixo(); // devolve + passa (pela sua regra nova)
      if (typeof window.renderAll === "function") window.renderAll();
      return;
    }

    // fora desses casos, não faz nada
  };

  lixoEl.innerHTML = "";

  const topo = state.lixo[state.lixo.length - 1];
  if (!topo) return;

  const cardEl = createCardElement(topo);
  lixoEl.appendChild(cardEl);
  applyAnimIfQueued(cardEl, topo.id);

}



export function bindTableUI() {
  if (state.spectator) return;
  const monteEl = document.getElementById("monte");
  const lixoEl = document.getElementById("lixo");

  // 🃏 MONTE → SEMPRE COMPRAR
  monteEl.onclick = () => {
  console.log("🃏 clique no monte | fase:", state.faseTurno);

  if (state.faseTurno !== "COMPRAR") return;

  // pega referência do topo (monte) antes
  const fromEl = monteEl;

  // executa compra (estado muda)
  comprarDoMonte();

  // renderiza para aparecer a carta na mão
  renderAll();

  // destino: última carta na mão
  const handEl = document.getElementById("hand");
  const toEl = handEl?.lastElementChild;

  // anima do monte pra mão
  const ultimaCarta = currentPlayer().hand[currentPlayer().hand.length - 1];
  if (toEl && ultimaCarta) {
    flyCard({ fromEl, toEl, card: ultimaCarta, sfx: "draw", duration: 280 });
/*
    toEl.classList.add("pop-in"); // micro “pop”
    setTimeout(() => toEl.classList.remove("pop-in"), 200);*/
  }

  };

  // 🗑 LIXO → COMPRA ou DESCARTE, DEPENDENDO DA FASE
  lixoEl.onclick = () => {
    console.log("🗑 clique no lixo | fase:", state.faseTurno);

    // 🟢 pegar do lixo
    if (state.faseTurno === "COMPRAR") {
      pegarDoLixo();
      renderAll();
      return;
    }

    // 🔴 descartar
    if (state.faseTurno === "DESCARTAR" || state.faseTurno === "BAIXAR") {
      discardSelectedCard();
      renderAll();
      return;
    }

    // ⚠️ qualquer outro caso
    showGameNotice("Ação não permitida");
  };
}

function applyAnimIfQueued(el, cardId) {
  if (!el || !cardId || !Array.isArray(state.animQueue)) return;

  const idx = state.animQueue.findIndex(a => String(a.id) === String(cardId));
  if (idx === -1) return;

  const kind = state.animQueue[idx].kind;
  state.animQueue.splice(idx, 1);

  const cls =
    kind === "discard" ? "anim-discard" :
    kind === "table" ? "anim-table" :
    "anim-deal";

  // aplica no "corpo" da carta se existir
  const target = el.firstElementChild || el;
  target.classList.add(cls);
  target.addEventListener("animationend", () => target.classList.remove(cls), { once: true });
}


function getCrazyBatidaUi() {
  const variant = String(state.room?.variant || state.variant || "").toUpperCase();

  if (variant !== "CRAZY") {
    return {
      show: false,
      active: false,
      mine: false,
      disabled: true,
      label: "BATI"
    };
  }

  if (state.spectator) {
    return {
      show: false,
      active: false,
      mine: false,
      disabled: true,
      label: "BATI"
    };
  }

  const active = !!state.crazyBatidaAttemptActive;
  const claimantSeat = Number(state.crazyBatidaAttemptSeat || 0);
  const prioritySeat = Number(state.crazyBatidaAttemptPrioritySeat || 0);
  const mySeat = Number(state.mySeat || 0);
  const mine = active && claimantSeat === mySeat;
  const iHavePriority = active && prioritySeat === mySeat && claimantSeat !== mySeat;
  const burned = !!state.crazyBatidaBurnedBySeat?.[state.mySeat];

  if (mine) {
    return {
      show: true,
      active: true,
      mine: true,
      disabled: false,
      label: "CANCELAR"
    };
  }

  // mesmo com outro tentando, o jogador prioritário ainda pode clicar
  if (iHavePriority) {
    return {
      show: true,
      active: true,
      mine: false,
      disabled: false,
      label: "BATI"
    };
  }

  if (active && !mine) {
    return {
      show: true,
      active: true,
      mine: false,
      disabled: true,
      label: "BATI"
    };
  }

  if (burned) {
  return {
    show: true,
    active: false,
    mine: false,
    disabled: true,
    label: "QUEIMOU"
  };
}

  return {
    show: true,
    active: false,
    mine: false,
    disabled: false,
    label: "BATI"
  };
}


export function renderScoreboard() {
  
  const el = document.getElementById("scoreboard");
  if (!el) return;
  
  if (state.spectator) {
  el.style.display = "";
  }

  el.style.display = "";

  const pl = currentPlayer();
  if (!pl) {
    el.innerHTML = "";
    return;
  }

  const nomeBase = pl.name || "Jogador";
  const nome = pl.disconnected ? `${nomeBase} (Offline)` : nomeBase;
  const inicial = (nomeBase[0] || "?").toUpperCase();
  const ptsMao = handPoints(pl.hand);
  const ptsTotal = typeof pl.totalPoints === "number" ? pl.totalPoints : 0;
  const buyIn = typeof state.room?.buyIn === "number" ? state.room.buyIn : null;
  const chips = typeof pl.tableChips === "number"
  ? pl.tableChips
  : (typeof pl.chips === "number" ? pl.chips : 0);

  const mesaValor = buyIn ? buyIn * 10 : null;
  const mesaTitulo = mesaValor ? `Mesa: ${mesaValor.toLocaleString("pt-BR")}` : "Mesa: —";

  const ante = typeof state.room?.ante === "number"
    ? state.room.ante
    : (buyIn ? Math.ceil(buyIn / 2) : 0);

  const avatarHtml = pl.avatarUrl
    ? `<img src="${pl.avatarUrl}" alt="avatar">`
    : `<span>${inicial}</span>`;

  const tempo = typeof state.turnSecondsLeft === "number" ? state.turnSecondsLeft : 0;
  const dur = typeof state.turnDurationSec === "number" ? state.turnDurationSec : 30;

  // detecta mobile portrait
  const isMobilePortrait = window.matchMedia("(max-width: 520px) and (orientation: portrait)").matches;

  // mantém estado de “aberto/fechado” no próprio DOM
  if (isMobilePortrait && el.dataset.open !== "1") el.dataset.open = "0";
  if (!isMobilePortrait) el.dataset.open = "1"; // fora do mobile: sempre aberto

  const isOpen = el.dataset.open === "1";
 
  el.classList.toggle("sb-open", isOpen);

 const batiUi = getCrazyBatidaUi();
  el.innerHTML = `
        <div class="sb-title">
        <span>${mesaTitulo}</span>

        ${!isMobilePortrait && batiUi.show ? `
          <button
            type="button"
            class="sb-pill sb-bati-btn ${batiUi.mine ? "is-active" : ""} ${batiUi.disabled ? "is-disabled-ui" : ""}"
            data-disabled-ui="${batiUi.disabled ? "1" : "0"}"
          >${batiUi.label}</button>
        ` : ""}

        <span style="display:flex; gap:8px; align-items:center;">

        ${isMobilePortrait && batiUi.show ? `
          <button
            type="button"
            class="sb-mobile-bati-btn ${batiUi.mine ? "is-active" : ""} ${batiUi.disabled ? "is-disabled-ui" : ""}"
            data-disabled-ui="${batiUi.disabled ? "1" : "0"}"
          >${batiUi.label}</button>
        ` : ""}
        <span class="sb-timer" id="sbTimerText">⏱ ${tempo}s</span>
      </span>
    </div>

    <div class="sb-turnbar">
      <div class="sb-turnbar-fill" id="sbTimerBar" style="width:${Math.max(0, Math.min(100, (tempo/dur)*100))}%"></div>
    </div>

    <div class="sb-card">
      <div class="sb-avatar">${avatarHtml}</div>

      <div class="sb-info">
        <div class="sb-name">${nome}</div>

                <div class="sb-sub sb-sub-desktop">
          <div class="sb-sub-row">
            <span class="sb-pill">Fichas: ${chips.toLocaleString("pt-BR")}</span>
            <span class="sb-pill">Ante: ${ante.toLocaleString("pt-BR")}</span>
          </div>

          <div class="sb-sub-row">
            <span class="sb-pill sb-detail">Mão: ${ptsMao}</span>
            <span class="sb-pill sb-detail">Total de Pontos: ${ptsTotal}</span>
          </div>

          <div class="sb-sub-row">
          ${!isMobilePortrait ? `<span class="sb-pill sb-bati-placeholder" aria-hidden="true"></span>` : ""}
        </div>
        </div>
      </div>
    </div>
  `;


  // bind do botão (uma vez)
  if (isMobilePortrait && el.dataset.bound !== "1") {
    el.dataset.bound = "1";

    el.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.(".sb-details-btn");
      if (!btn) return;

      const openNow = el.dataset.open === "1";
      el.dataset.open = openNow ? "0" : "1";
      renderScoreboard(); // re-render pra atualizar texto/aria
      ev.stopPropagation();
    });
  }

   function handleBatiButtonClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    console.log("[BATI] clique no botão", {
      mine: batiUi.mine,
      disabled: batiUi.disabled,
      label: batiUi.label,
      mySeat: state.mySeat,
      currentSeat: state.currentSeat,
      phase: state.phase,
      crazyBatidaAttemptActive: state.crazyBatidaAttemptActive,
      crazyBatidaAttemptSeat: state.crazyBatidaAttemptSeat
    });

    if (batiUi.mine) {
      console.log("[BATI] indo cancelar");
      requestCancelCrazyBatidaAttempt();
      return;
    }

    if (batiUi.disabled) {
      console.log("[BATI] bloqueado no cliente");
      if (typeof showGameNotice === "function") {
        showGameNotice("BATI indisponível no momento.");
      }
      return;
    }

    console.log("[BATI] antes de requestStartCrazyBatidaAttempt", {
      exists: typeof requestStartCrazyBatidaAttempt,
    });

    try {
      const ok = requestStartCrazyBatidaAttempt();
      console.log("[BATI] retorno requestStartCrazyBatidaAttempt", { ok });

      if (!ok && typeof showGameNotice === "function") {
        showGameNotice("Não foi possível solicitar BATI.");
      }
    } catch (err) {
      console.error("[BATI] erro ao solicitar", err);
      if (typeof showGameNotice === "function") {
        showGameNotice("Erro ao solicitar BATI.");
      }
    }
  }

  const batiBtn = el.querySelector(".sb-bati-btn");
  if (batiBtn) {
    batiBtn.onclick = handleBatiButtonClick;
  }

  const mobileBatiBtn = el.querySelector(".sb-mobile-bati-btn");

  if (mobileBatiBtn) {
    mobileBatiBtn.onclick = handleBatiButtonClick;

    if (isMobilePortrait) {
      const deckArea = document.getElementById("deck-area");

      if (deckArea) {

        // 🔥 remove qualquer botão antigo já movido
        const old = deckArea.querySelector(".sb-mobile-bati-btn");
        if (old && old !== mobileBatiBtn) {
          old.remove();
        }

        // 🔥 move o atual
        if (mobileBatiBtn.parentElement !== deckArea) {
          deckArea.appendChild(mobileBatiBtn);
        }
      }
    }
  }

  // =========================================================
  // DOUBLE TAP NA MESA (MOBILE)
  // =========================================================
  if (isMobilePortrait && !window.__batiDoubleTapBound) {
    window.__batiDoubleTapBound = true;

    let lastTapAt = 0;

    document.addEventListener("touchstart", (ev) => {
      const now = Date.now();

      const delta = now - lastTapAt;
      lastTapAt = now;

      // intervalo de double tap (ajustável)
      if (delta > 350) return;

      // evita clicar em botões / UI
      const target = ev.target;
      if (
        target.closest?.("#scoreboard") ||
        target.closest?.(".sb-mobile-bati-btn") ||
        target.closest?.(".sb-bati-btn") ||
        target.closest?.("button")
      ) {
        return;
      }

      // garante que temos estado válido
      if (!state || state.spectator) return;

      const variant = String(state.room?.variant || "").toUpperCase();
      if (variant !== "CRAZY") return;

      const batiUi = getCrazyBatidaUi();

      console.log("[BATI] double tap detectado", {
        mine: batiUi.mine,
        disabled: batiUi.disabled,
        label: batiUi.label
      });

      // mesma lógica do botão
      if (batiUi.mine) {
        requestCancelCrazyBatidaAttempt();
        return;
      }

      if (batiUi.disabled) {
        if (typeof showGameNotice === "function") {
          showGameNotice("BATI indisponível.");
        }
        return;
      }

      requestStartCrazyBatidaAttempt();
    }, { passive: true });
  }
  renderMobileTableLayout();
  renderDesktopTableLayout();
  moveMobileBatiButtonToBottomArea();
}



function isMobilePortraitTable() {
  return window.matchMedia("(max-width: 768px) and (orientation: portrait)").matches;
}

const mobilePortraitMediaQuery = window.matchMedia(
  "(max-width: 768px) and (orientation: portrait)"
);

mobilePortraitMediaQuery.addEventListener("change", () => {
  renderAll();
});

function getPublicStateSafe() {
  return window.state_public || window.state || state_public || state || {};
}

function getPlayersForMobileTable() {
  const s = getPublicStateSafe();

  const tableId = s.tableId || state.tableId;

  const tableData =
    tableId && window.state?.tables
      ? window.state.tables[tableId]
      : null;

  if (Array.isArray(tableData?.seats)) {
    return tableData.seats.filter(Boolean);
  }

  return s.players || s.seats || [];
}

function getMobilePlayerName(p, index) {
  return (
    p?.name ||
    p?.username ||
    p?.playerName ||
    `Jogador ${index + 1}`
  );
}

function getMobilePlayerChips(p) {
  return Number(
    p?.chips ??
    p?.stack ??
    p?.tableChips ??
    p?.chips_balance ??
    0
  );
}

function getMobilePlayerPoints(p) {
  return Number(
    p?.points ??
    p?.totalPoints ??
    p?.score ??
    0
  );
}

function getMobileTurnTimerInfo(s = getPublicStateSafe()) {
  const endsAt = Number(s.turnEndsAt || state.turnEndsAt || 0);

  const totalMs = Number(
    s.turnMs ||
    state.turnMs ||
    state.turnDurationSec * 1000 ||
    30000
  );

  const remainingMs = Math.max(0, endsAt - Date.now());

  const pct = totalMs > 0
    ? Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))
    : 0;

  return {
    pct,
    remainingSec: Math.ceil(remainingMs / 1000),
    show: endsAt > 0 && totalMs > 0 && Number(s.currentSeat) > 0
  };
}

function updateMobileTurnBars() {
  const info = getMobileTurnTimerInfo();

  document.querySelectorAll("[data-mobile-turnbar-fill]").forEach(el => {
    el.style.width = `${info.pct}%`;
  });

  document.querySelectorAll("[data-mobile-turnbar-text]").forEach(el => {
    el.textContent = `${info.remainingSec}s`;
  });
}

function ensureMobileTurnBarTicker() {
  if (window.__mobileTurnBarTicker) return;

  window.__mobileTurnBarTicker = setInterval(() => {
    if (!isMobilePortraitTable()) return;
    updateMobileTurnBars();
  }, 200);
}



function renderMobileTableLayout() {
  const s = getPublicStateSafe();

  const gameScreen =
    document.getElementById("gameScreen") ||
    document.querySelector("#game");

  if (!gameScreen) return;

  let root = document.getElementById("mobileTableLayout");

  if (!isMobilePortraitTable()) {
    if (root) root.remove();
    document.body.classList.remove("mobile-table-mode");
    return;
  }

  document.body.classList.add("mobile-table-mode");

  if (!root) {
    root = document.createElement("div");
    root.id = "mobileTableLayout";
    root.innerHTML = `
      <div class="mobile-table-topbar">
        <span id="mobileMesaInfo"></span>
        <span id="mobileAnteInfo"></span>
      </div>

      <div class="mobile-seat-layer">
        <div class="mobile-seat pos1" data-seat-pos="1"></div>
        <div class="mobile-seat pos2" data-seat-pos="2"></div>
        <div class="mobile-seat pos3" data-seat-pos="3"></div>
        <div class="mobile-seat pos4" data-seat-pos="4"></div>
        <div class="mobile-seat pos5" data-seat-pos="5"></div>
      </div>
    `;

    gameScreen.prepend(root);
  }

  // ==============================
  // DADOS DA MESA (CORRETO)
  // ==============================
  const tableId = s.tableId;
  const tableData = tableId && window.state?.tables
    ? window.state.tables[tableId]
    : null;

  const buyInBase = Number(
  tableData?.buyIn ??
  s.room?.buyIn ??
  s.buyIn ??
  1000
);

// VALOR REAL DA MESA
const mesaValor = Number(
  tableData?.stake ??
  tableData?.mesaValor ??
  tableData?.tableValue ??
  (buyInBase * 10)
);

// ANTE = 5% DO VALOR DA MESA
const miniAnte = Number(
  tableData?.miniAnte ??
  tableData?.ante ??
  Math.floor(mesaValor * 0.05)
);

  const mesaEl = document.getElementById("mobileMesaInfo");
  const anteEl = document.getElementById("mobileAnteInfo");

  if (mesaEl) mesaEl.textContent = `Mesa: ${mesaValor.toLocaleString("pt-BR")}`;
  if (anteEl) anteEl.textContent = `Ante: ${miniAnte.toLocaleString("pt-BR")}`;

  // ==============================
  // JOGADORES (SEM VOCÊ)
  // ==============================
  const players = getPlayersForMobileTable();

  const mySeat = s.mySeat;
  const timerInfo = getMobileTurnTimerInfo(s);
  ensureMobileTurnBarTicker();

    for (let seat = 1; seat <= 5; seat++) {
    const el = root.querySelector(`[data-seat-pos="${seat}"]`);
    const p = players.find(player => Number(player?.seat) === seat);
    

    if (!el) continue;

    if (!p) {
      el.innerHTML = "";
      el.classList.add("empty");
      el.classList.remove("is-current-turn");
      continue;
    }

    el.classList.remove("empty");
    el.classList.toggle("is-current-turn", Number(s.currentSeat) === Number(p.seat));

    if (!p) {
      el.innerHTML = "";
      el.classList.add("empty");
      continue;
    }

    el.classList.remove("empty");

    const avatar =
      p.avatarUrl ||
      p.avatar_url ||
      "/assets/avatar-default.png";

    const chips = Number(p.tableChips ?? p.stack ?? 0);
    const pts = Number(p.totalPoints ?? 0);
    const isOffline = !!p.disconnected;

    const handCount = Number(p.handCount ?? 0);
    const isCurrentTurn = Number(s.currentSeat) === Number(p.seat);

      el.innerHTML = `
        ${isCurrentTurn && timerInfo.show ? `
          <div class="mobile-seat-timebar">
            <div class="mobile-seat-timebar-fill" data-mobile-turnbar-fill style="width:${timerInfo.pct}%"></div>
          </div>
        ` : ""}
        ${handCount > 0 ? `
          <div class="mobile-seat-cards">
            ${Array.from({ length: Math.min(handCount, 9) }).map(() => `
              <div class="mobile-mini-card"></div>
            `).join("")}
          </div>
        ` : ""}

        <div class="mobile-seat-avatar">
          <img src="${avatar}">
        </div>

        <div>
          <div class="mobile-seat-name">
          ${p.name || "Jogador"}

          ${isOffline ? `
            <span class="mobile-seat-offline">OFF</span>
          ` : ""}
        </div>
          <div class="mobile-seat-meta">${chips} · ${pts} pts</div>
        </div>
      `;
        }

  renderMobileBottomHudClean(tableData, s);
  moveMobilePotToTableTop();
}

function renderDesktopTableLayout() {
  const s = getPublicStateSafe();

  const game = document.getElementById("game");
  if (!game) return;

  let root = document.getElementById("desktopTableLayout");

  const isMobile = isMobilePortraitTable();

  if (isMobile) {
    if (root) root.remove();
    document.body.classList.remove("desktop-table-mode");
    return;
  }

  document.body.classList.add("desktop-table-mode");

  if (!root) {
    root = document.createElement("div");
    root.id = "desktopTableLayout";
    root.innerHTML = `
      <div class="desktop-seat-layer">
        <div class="desktop-seat pos1" data-seat-pos="1"></div>
        <div class="desktop-seat pos2" data-seat-pos="2"></div>
        <div class="desktop-seat pos3" data-seat-pos="3"></div>
        <div class="desktop-seat pos4" data-seat-pos="4"></div>
        <div class="desktop-seat pos5" data-seat-pos="5"></div>
        <div class="desktop-seat pos6" data-seat-pos="6"></div>
      </div>
    `;
    game.prepend(root);
  }

  const tableId = s.tableId || state.tableId;
  const tableData = tableId && window.state?.tables
    ? window.state.tables[tableId]
    : null;

  const players = Array.isArray(tableData?.seats)
    ? tableData.seats.filter(Boolean)
    : (Array.isArray(state.players) ? state.players : []);

  for (let seat = 1; seat <= 6; seat++) {
    const el = root.querySelector(`[data-seat-pos="${seat}"]`);
    const p = players.find(player => Number(player?.seat) === seat);

    if (!el) continue;

    if (!p) {
      el.innerHTML = "";
      el.classList.add("empty");
      el.classList.remove("is-current-turn");
      continue;
    }

    el.classList.remove("empty");
    el.classList.toggle("is-current-turn", Number(s.currentSeat) === Number(p.seat));

    const avatar =
      p.avatarUrl ||
      p.avatar_url ||
      "/assets/avatars/avatar-01.png";

    const chips = Number(p.tableChips ?? p.stack ?? p.chips ?? 0);
    const pts = Number(p.totalPoints ?? 0);

    const isMe = Number(p.seat) === Number(s.mySeat);
    const handCount = Number(
    p.handCount ??
    p.cardsCount ??
    p.handLength ??
    p.cardCount ??
    (Array.isArray(p.hand) ? p.hand.length : 0)
  );

    el.innerHTML = `
      <div class="desktop-seat-avatar">
        <img src="${avatar}">
      </div>

      <div class="desktop-seat-info">
        <div class="desktop-seat-name">
        ${p.name || "Jogador"}
      </div>

      ${p.disconnected ? `
        <div class="desktop-offline">
          OFFLINE
        </div>
      ` : ""}
        <div class="desktop-seat-meta">${chips.toLocaleString("pt-BR")} · ${pts} pts</div>

        ${!isMe && handCount > 0 ? `
        <div class="desktop-seat-cards">
          ${Array.from({ length: Math.min(handCount, 9) }).map(() => `
            <div class="mini-card"></div>
          `).join("")}
        </div>
      ` : ""}
      </div>
    `;
  }
}



function moveMobilePotToTableTop() {
  if (!isMobilePortraitTable()) return;

  const root = document.getElementById("mobileTableLayout");
  const deckArea = document.getElementById("deck-area");
  if (!root || !deckArea) return;

  let holder = document.getElementById("mobilePotTop");

  if (!holder) {
    holder = document.createElement("div");
    holder.id = "mobilePotTop";
    root.appendChild(holder);
  }

  const potItems = Array.from(deckArea.children).filter(el => {
    if (!el) return false;

    if (el.id === "monte") return false;
    if (el.id === "lixo") return false;
    if (el.id === "mobileBottomHud") return false;
    if (el.classList?.contains("sb-mobile-bati-btn")) return false;
    if (el.classList?.contains("sort-btn")) return false;

    const txt = String(el.textContent || "").toLowerCase();
    const cls = String(el.className || "").toLowerCase();
    const id = String(el.id || "").toLowerCase();

    return (
      txt.includes("pote") ||
      cls.includes("pot") ||
      cls.includes("pote") ||
      cls.includes("chip") ||
      id.includes("pot") ||
      id.includes("pote") ||
      id.includes("chip")
    );
  });

  potItems.forEach(el => holder.appendChild(el));
}

function getMobileCurrentPlayerForHud() {
  const pl = typeof currentPlayer === "function" ? currentPlayer() : null;
  if (pl) return pl;

  const s = getPublicStateSafe();
  const players = getPlayersForMobileTable();

  const mySeat =
    s.mySeat ||
    s.seat ||
    s.playerSeat ||
    s.currentPlayerSeat ||
    null;

  return players.find(p => {
    if (!p) return false;
    const pSeat = Number(p.seat || p.seatIndex || 0);
    return (
      p.isYou ||
      p.me ||
      p.isMe ||
      p.id === s.myPlayerId ||
      pSeat === Number(mySeat)
    );
  }) || null;
}


function renderMobileBottomHudClean(tableData, s) {
  if (!isMobilePortraitTable()) {
    const old = document.getElementById("mobileBottomHud");
    if (old) old.remove();
    return;
  }

  const bottomArea = document.getElementById("bottomArea") || document.body;

  let hud = document.getElementById("mobileBottomHud");

  if (!hud) {
    hud = document.createElement("div");
    hud.id = "mobileBottomHud";
    bottomArea.appendChild(hud);
  }

  const mySeat = s.mySeat;

  const me = Array.isArray(tableData?.seats)
    ? tableData.seats.find(p => Number(p?.seat) === Number(mySeat))
    : null;

  if (!me) {
    hud.innerHTML = "";
    return;
  }

  const avatar =
    me.avatarUrl ||
    me.avatar_url ||
    "/assets/avatar-default.png";

  const chips = Number(me.tableChips ?? me.stack ?? 0);
  const pts = Number(me.totalPoints ?? 0);
  const isMyTurn = Number(s.currentSeat) === Number(s.mySeat);

  const timerInfo = getMobileTurnTimerInfo(s);
  ensureMobileTurnBarTicker();

  hud.innerHTML = `
    <div class="mobile-bottom-avatar">
      <img src="${avatar}">
    </div>

    <div class="mobile-bottom-info">
      <div class="mobile-bottom-name">${me.name || "Você"}</div>
      <div class="mobile-bottom-meta">${chips} · ${pts} pts</div>

      ${isMyTurn && timerInfo.show ? `
        <div class="mobile-hud-timebar">
          <div
            class="mobile-hud-timebar-fill"
            data-mobile-turnbar-fill
            style="width:${timerInfo.pct}%"
          ></div>
        </div>
      ` : ""}
    </div>
  `;

  hud.classList.toggle("is-current-turn", isMyTurn);
}

function moveMobileSortButtonsToDeckArea() {
  if (!isMobilePortraitTable()) return;

  const bottomArea = document.getElementById("bottomArea") || document.body;

  let holder = document.getElementById("mobileSortButtonsHud");

  if (!holder) {
    holder = document.createElement("div");
    holder.id = "mobileSortButtonsHud";
    bottomArea.appendChild(holder);
  }

  const buttons = Array.from(document.querySelectorAll("button")).filter(btn => {
    const cls = String(btn.className || "").toLowerCase();
    const id = String(btn.id || "").toLowerCase();

    return id.includes("sort") || cls.includes("sort-btn");
  });

  buttons.forEach(btn => {
    if (btn.closest("#mobileSortButtonsHud")) return;
    holder.appendChild(btn);
  });
}

function moveMobileBatiButtonToBottomArea() {
  if (!isMobilePortraitTable()) return;

  const bottomArea = document.getElementById("bottomArea") || document.body;
  const btn = document.querySelector(".sb-mobile-bati-btn");

  if (!btn) return;

  if (!btn.closest("#bottomArea")) {
    bottomArea.appendChild(btn);
  }

  btn.id = "mobileBatiBtnHud";
}

// expõe para actions.js sem import (evita ciclo)
window.__flyCard = flyCard;

// =============================
// 💰 POTE NA MESA (FICHAS)
// =============================
export function renderPot() {
  const gameRoot = document.getElementById("game");

  // pega SEMPRE o lixo que está dentro do #game (evita pegar lixo de outra tela)
  const lixoEl =
    gameRoot?.querySelector("#lixo") ||
    document.querySelector("#game #lixo") ||
    document.getElementById("lixo");

  if (!lixoEl) return;

  // ✅ remove potes duplicados que possam ter ficado no DOM
  // (mantém só 1)
  const allPots = Array.from(document.querySelectorAll("#game .pot-area, #game #pot-area, .pot-area#pot-area"));
  for (let i = 1; i < allPots.length; i++) allPots[i].remove();

  // garante que existe exatamente 1 potEl
  let potEl = document.getElementById("pot-area");
  if (!potEl) {
    potEl = document.createElement("div");
    potEl.id = "pot-area";
    potEl.className = "pot-area";
  }

  // ✅ garante que ele está colado no lixo CERTO (o do game)
  // se estiver em outro lugar, move
  if (potEl.previousElementSibling !== lixoEl) {
    potEl.remove(); // remove de onde estiver
    lixoEl.insertAdjacentElement("afterend", potEl);
  }

  const pot = typeof state.matchPot === "number" ? state.matchPot : 0;

  potEl.innerHTML = `
    <div class="chip-stack" aria-label="Pote ${pot}">
      ${buildChipStackHTML(pot)}
    </div>
    <div class="pot-label">Pote: ${Number(pot).toLocaleString("pt-BR")}</div>
  `;

/* animação do pote
  potEl.classList.add("pot-update");

  setTimeout(() => {
    potEl.classList.remove("pot-update");
  }, 300);*/
}



// cria até 12 fichas só para visual (não precisa ser 1:1)
function buildChipStackHTML(potValue) {
  if (potValue <= 0) return "";

  // denominações (do maior pro menor)
  const denoms = [5000, 1000, 500, 100, 50, 25, 5, 1];

  // monta uma lista de fichas (ganancioso)
  let remaining = Math.floor(potValue);
  const chips = [];

  for (const d of denoms) {
    const count = Math.floor(remaining / d);
    if (count <= 0) continue;

    // não precisa desenhar 200 fichas… limita por denominação (visual)
    const maxPerDenom = 4;
    const use = Math.min(count, maxPerDenom);

    for (let i = 0; i < use; i++) chips.push(d);

    remaining -= count * d; // desconta o valor real (mesmo que desenhe só parte)
  }

  // se o pote for pequeno e não entrou nenhuma, mostra 1 ficha
  if (chips.length === 0) chips.push(1);

  // limita total de fichas no desenho (visual)
  const maxTotal = 14;
  const finalChips = chips.slice(0, maxTotal);

  // monta HTML em stack
  let html = "";
  for (let i = 0; i < finalChips.length; i++) {
    const v = finalChips[i];
    html += `<div class="chip chip-${v}" style="--i:${i}"></div>`;
  }

  return html;
}

export function renderRebuyOverlay() {
  const gameEl = document.getElementById("game");
  if (state.rebuyDecisionUntil && !window.rebuyOverlayTimer) {
  window.rebuyOverlayTimer = setInterval(() => {
    if (!state.rebuyDecisionUntil || Date.now() > state.rebuyDecisionUntil) {
      clearInterval(window.rebuyOverlayTimer);
      window.rebuyOverlayTimer = null;
      document.getElementById("rebuyOverlay")?.remove();
      return;
    }

    renderRebuyOverlay();
  }, 1000);
}
  if (!gameEl) return;
  if (state.matchEnded) {
    document.getElementById("rebuyOverlay")?.remove();
    return;
  }

  // só mostra durante a janela
  if (!state.rebuyDecisionUntil || Date.now() > state.rebuyDecisionUntil) {
    const ov0 = document.getElementById("rebuyOverlay");
    if (ov0) ov0.remove();
    return;
  }

  const mySeat = Number(state.mySeat || 0);

  const eligible = (state.players || []).filter(pl =>
    pl &&
    Number(pl.seat) === mySeat &&
    pl.eliminated === true &&
    pl.pendingRebuy !== true &&
    pl.rebuyDeclined !== true &&
    (pl.rebuyCount || 0) < 3
  );

  const waitingRebuyPlayers = (state.players || []).filter(pl =>
    pl &&
    pl.eliminated === true &&
    pl.pendingRebuy !== true &&
    pl.rebuyDeclined !== true &&
    (pl.rebuyCount || 0) < 3
  );

  let overlay = document.getElementById("rebuyOverlay");

  if (!eligible.length) {

    if (!waitingRebuyPlayers.length) {
      if (overlay) overlay.remove();
      return;
    }

    const secondsLeft = Math.max(
      0,
      Math.ceil((state.rebuyDecisionUntil - Date.now()) / 1000)
    );

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "rebuyOverlay";
      overlay.className = "rebuy-overlay";
      gameEl.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="rebuy-modal">
        <div class="rebuy-title">Aguardando Rebuy...</div>

        <div class="rebuy-sub">
          Próxima rodada em <b>${secondsLeft}</b>s
        </div>
      </div>
    `;

    return;
  }

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "rebuyOverlay";
    overlay.className = "rebuy-overlay";
    gameEl.appendChild(overlay);
  }

  const ativos = (state.players || []).filter(pl => pl && !pl.eliminated);
  const pontosRetorno = ativos.length
    ? Math.max(...ativos.map(pl => Number(pl.totalPoints) || 0))
    : 0;

  const secondsLeft = Math.max(0, Math.ceil((state.rebuyDecisionUntil - Date.now()) / 1000));

  overlay.innerHTML = `
    <div class="rebuy-modal">
      <div class="rebuy-title">Adicionar mais fichas?</div>
      <div class="rebuy-sub">Você voltará com <b>${pontosRetorno}</b> pontos.</div>

      <div class="rebuy-list">
        ${eligible.map(pl => {
          const nome = pl.name || "Jogador";
          const nextIdx = Math.min((pl.rebuyCount || 0) + 1, 3);

          return `
            <div class="rebuy-row">
              <div class="rebuy-left">
                <div class="rebuy-name">${nome}</div>
                <div class="rebuy-meta">
                  Rebuy ${nextIdx}/3 • Volta com ${pontosRetorno} pts
                </div>
              </div>

            <div class="rebuy-actions">
              <button class="rebuy-btn" data-rebuy-id="${pl.id}">
                Rebuy
              </button>

              <button class="rebuy-skip" data-decline-id="${pl.id}">
                Cancelar
              </button>
            </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="rebuy-foot">
        Rodada inicia em <b id="rebuyCountdown">${secondsLeft}</b>s
      </div>
    </div>
  `;

  overlay.querySelectorAll("[data-rebuy-id]").forEach(btn => {
    btn.onclick = () => {

  btn.disabled = true;

  const ok = requestRebuy();

  if (!ok) {
    btn.disabled = false;
  } else {
    btn.textContent = "Aguardando...";
  }

  if (!ok) window.showGameNotice("Não foi possível pedir rebuy.", "warn");
  window.renderAll?.();
  };
  });

  overlay.querySelectorAll("[data-decline-id]").forEach(btn => {
  btn.onclick = () => {
    console.log("[CLIENT] clique no botão Cancelar Rebuy");

    btn.disabled = true;

    if (typeof declineRebuy !== "function") {
      console.error("[CLIENT] declineRebuy não existe neste escopo");
      btn.disabled = false;
      return;
    }

    const ok = declineRebuy();

    console.log("[CLIENT] resultado declineRebuy:", ok);

    if (!ok) {
      btn.disabled = false;
      return;
    }

    btn.textContent = "Cancelado";

    window.renderAll?.();
  };
});
}

export function renderEndMatchOverlay() {
  const rootEl = document.body;
  if (!rootEl) return;

  // remove se não acabou
  if (!state.matchEnded || !state.canRematch) {
    document.getElementById("endMatchOverlay")?.remove();
    return;
  }

  let ov = document.getElementById("endMatchOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "endMatchOverlay";
    ov.className = "endmatch-overlay";
    rootEl.appendChild(ov);
  }

  const winner = state.players?.find(p => p.seat === state.matchWinnerSeat);
  const winnerName = winner?.name || "—";

  const matchPot = Number(state.matchPot) || 0;
  const houseRake = Number(state.houseRake) || 0;
  const winnerPayout = Number(state.winnerPayout) || 0;
  const houseRakePct = Math.round((Number(state.houseRakePct) || 0) * 100);

  ov.innerHTML = `
    <div class="endmatch-modal">
      <div class="endmatch-title">Fim da Partida!</div>

      <div class="endmatch-body">
        <div class="endmatch-line"><b>${winnerName}</b></div>
        <div class="endmatch-line">🏆 venceu a partida</div>

        <div class="endmatch-line" style="margin-top:10px;">
          Pote final: <b>${matchPot.toLocaleString("pt-BR")}</b>
        </div>

        <div class="endmatch-line">
          Taxa da casa: <b>${houseRake.toLocaleString("pt-BR")}</b> (${houseRakePct}%)
        </div>

        <div class="endmatch-line">
          Prêmio do vencedor: <b>${winnerPayout.toLocaleString("pt-BR")}</b>
        </div>

      <div class="endmatch-actions" style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button id="btnRematch" class="endmatch-btn">Revanche</button>
        <button id="btnBackTables" class="endmatch-btn">Voltar às mesas</button>
      </div>
    </div>
  `;

  const btnRematch = ov.querySelector("#btnRematch");
  const btnBackTables = ov.querySelector("#btnBackTables");

  const handleRematch = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    console.log("[ENDMATCH] aceitar revanche");
    window.rematchSameTable?.();
  };

  const handleBackTables = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    console.log("[ENDMATCH] voltar às mesas");
    window.backToTables?.();
  };

  if (btnRematch) {
    btnRematch.onclick = handleRematch;
    btnRematch.ontouchend = handleRematch;
  }

  if (btnBackTables) {
    btnBackTables.onclick = handleBackTables;
    btnBackTables.ontouchend = handleBackTables;
  }

}

let dealingUiTimer = null;
let dealSfxLoopTimer = null;
let lastDealSfxLoopEndsAt = 0;


function stopDealSfxLoop() {
  if (dealSfxLoopTimer) {
    clearInterval(dealSfxLoopTimer);
    dealSfxLoopTimer = null;
  }

  lastDealSfxLoopEndsAt = 0;

  try {
    if (dealAudio) {
      dealAudio.pause();
      dealAudio.currentTime = 0;
    }
  } catch (_) {}

  dealAudioPlaying = false;
}


function startDealSfxLoop() {
  const dealEndsAt = Number(state.dealEndsAt || 0);
  if (!dealEndsAt) return;

  // já está tocando → não inicia de novo
  if (dealAudioPlaying && lastDealSfxLoopEndsAt === dealEndsAt) return;

  stopDealSfxLoop();
  lastDealSfxLoopEndsAt = dealEndsAt;

  try {
    const audio = getDealAudio();

    audio.currentTime = 0;

    const p = audio.play();

    dealAudioPlaying = true;

    if (p && typeof p.catch === "function") {
      p.catch(() => {
        dealAudioPlaying = false;
        playSfx("deal"); // fallback
      });
    }
  } catch (e) {
    dealAudioPlaying = false;
    console.error("[DEAL AUDIO] erro", e);
    playSfx("deal");
  }

  // apenas para monitorar fim
  dealSfxLoopTimer = setInterval(() => {
    const stillDealing =
      state.faseTurno === "DEALING" &&
      Number(state.dealEndsAt || 0) > Date.now();

    if (!stillDealing) {
      stopDealSfxLoop();
    }
  }, 200);
}

export function renderDealOverlay() {
  let el = document.getElementById("deal-overlay");

  if (!el) {
    el = document.createElement("div");
    el.id = "deal-overlay";
    el.style.position = "absolute";
    el.style.top = "50%";
    el.style.left = "50%";
    el.style.transform = "translate(-50%, -50%)";
    el.style.zIndex = "10000";
    el.style.background = "rgba(0,0,0,0.82)";
    el.style.color = "#fff";
    el.style.padding = "18px 24px";
    el.style.borderRadius = "14px";
    el.style.textAlign = "center";
    el.style.minWidth = "220px";
    el.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    document.body.appendChild(el);
  }

  clearTimeout(dealingUiTimer);

  const isDealing =
    state.faseTurno === "DEALING" &&
    Number(state.dealEndsAt || 0) > Date.now();

  if (!isDealing) {
    el.style.display = "none";
    stopDealSfxLoop();
    return;
  }

  // 🔊 som da distribuição no fluxo ONLINE real
  startDealSfxLoop();

  const leftMs = Math.max(0, Number(state.dealEndsAt || 0) - Date.now());
  const leftSec = (leftMs / 1000).toFixed(1);

  el.innerHTML = `
    <div style="font-size:18px; font-weight:800; margin-bottom:8px;">
      🂠 Distribuindo cartas...
    </div>
    <div style="font-size:13px; opacity:.92;">
      Nova rodada começa em ${leftSec}s
    </div>
  `;

  el.style.display = "block";

  dealingUiTimer = setTimeout(() => {
    window.renderAll?.();
  }, 120);
}

let lastRoundVictorySoundTs = 0;

function playRoundVictoryOnce(summary) {
  const ts = Number(summary?.timestamp || 0);
  if (!ts) return;

  if (ts === lastRoundVictorySoundTs) return;

  lastRoundVictorySoundTs = ts;
  playVictorySound();
}

export function renderRoundInfo() {
  const el = document.getElementById("round-info");
  if (el) {
    el.remove();
  }
}

/*
export function renderRoundInfo() {
  let el = document.getElementById("round-info");

  if (!el) {
    el = document.createElement("div");
    el.id = "round-info";
    el.style.position = "absolute";
    el.style.top = "12px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "rgba(0,0,0,0.75)";
    el.style.color = "#fff";
    el.style.padding = "10px 16px";
    el.style.borderRadius = "10px";
    el.style.fontSize = "14px";
    el.style.zIndex = "9999";
    el.style.maxWidth = "80%";
    el.style.textAlign = "center";
    document.body.appendChild(el);
  }

  const summary = state.lastRoundSummary;
  if (!summary) {
    el.style.display = "none";
    return;
  }

  const age = Date.now() - summary.timestamp;
if (age > 4000) {
  el.style.display = "none";
  return;
}


  playRoundWinSfxOnce(summary);

  const winner = state.players?.find(p => p.seat === summary.winnerSeat);
  const winnerName = winner?.name || `Jogador ${summary.winnerSeat}`;

  const lines = [];
  lines.push(`🃏 ${winnerName} bateu!`);

  const others = (state.players || []).filter(p => p.seat !== summary.winnerSeat);

  if (others.length) {
    lines.push(
      others
        .map(p => `${p.name}: +${p.lastRoundPoints || 0} (total ${p.totalPoints || 0})${p.eliminated ? " ❌ eliminado" : ""}`)
        .join(" | ")
    );
  }

  el.innerHTML = lines.join("<br>");
  el.style.display = "block";
}
*/
export function renderRebuyButton() {
  let box = document.getElementById("rebuy-box");

  if (!box) {
    box = document.createElement("div");
    box.id = "rebuy-box";
    box.style.position = "absolute";
    box.style.top = "16px";
    box.style.right = "16px";
    box.style.zIndex = "9999";
    box.style.background = "rgba(0,0,0,0.85)";
    box.style.color = "#fff";
    box.style.padding = "12px";
    box.style.borderRadius = "10px";
    box.style.display = "none";
    box.style.minWidth = "180px";
    box.style.textAlign = "center";
    document.body.appendChild(box);
  }

  if (!state || !Array.isArray(state.players)) {
    box.style.display = "none";
    return;
  }

  const me = state.players.find(p => p && p.seat === state.mySeat);
  const now = Date.now();
  const end = Number(state.rebuyDecisionUntil || 0);

  // só mostra se eu estiver eliminado e a janela ainda estiver aberta
  if (!me || !me.eliminated || !end || now > end) {
    box.style.display = "none";
    return;
  }

  const secs = Math.max(0, Math.ceil((end - now) / 1000));
  const cost = typeof me.rebuyCount === "number"
    ? 1000 * Math.pow(2, me.rebuyCount || 0)
    : 1000;

  box.innerHTML = `
    <div style="font-weight:bold; margin-bottom:8px;">REBUY</div>
    <div style="margin-bottom:8px;">Tempo: ${secs}s</div>
    <div style="margin-bottom:8px;">Custo: ${cost}</div>
    <button id="rebuy-yes-btn" style="padding:6px 12px; cursor:pointer;">SIM</button>
  `;

  box.style.display = "block";

  const btn = document.getElementById("rebuy-yes-btn");
  if (btn) {
    btn.onclick = () => {
      requestRebuy();
    };
  }
}

