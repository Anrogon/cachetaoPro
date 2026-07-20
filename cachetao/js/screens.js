/* =========================================================
   FEED DA TELA INICIAL
========================================================= */

let homeStatusFeedTimer = null;
let homeStatusFeedIndex = 0;

const HOME_STATUS_FEED = [
  "💡 Nem sempre vale a pena disputar todas as rodadas.",
  "🃏 O coringa não pode ser descartado.",
  "🔥 Sequências devem ser formadas pelo mesmo naipe.",
  "🎴 Trincas usam cartas do mesmo valor e naipes diferentes.",
  "🎯 Bater sem descarte também encerra a rodada.",
  "⚡ Confira todas as combinações antes de declarar BATI.",
  "🃏 É permitido usar dois coringas no mesmo jogo.",
  "👏 Para bater, selecione as cartas e forme todos os jogos válidos.",
  "⚪ Correr faz parte da estratégia e custa apenas 1 ponto.",
  "⚔ Jogadores com 1 ponto entram automaticamente na Marra."
];

function ensureHomeStatusFeed() {
  const statusCard = document.querySelector(
    "#homeScreen .home-status"
  );

  if (!statusCard) {
    return;
  }

  let feed = document.getElementById("homeStatusFeed");

  if (!feed) {
    statusCard.insertAdjacentHTML(
      "beforeend",
      `
        <div id="homeStatusFeed" class="home-status-feed">
          <div class="home-status-feed-text"></div>
        </div>
      `
    );

    feed = document.getElementById("homeStatusFeed");
  }

  const textElement = feed?.querySelector(
    ".home-status-feed-text"
  );

  if (!textElement) {
    return;
  }

  const renderFeed = () => {
    const message =
      HOME_STATUS_FEED[
        homeStatusFeedIndex % HOME_STATUS_FEED.length
      ];

    textElement.textContent = message;
    homeStatusFeedIndex += 1;
  };

  renderFeed();

  if (homeStatusFeedTimer) {
    clearInterval(homeStatusFeedTimer);
  }

  homeStatusFeedTimer = setInterval(
    renderFeed,
    3500
  );
}

/* =========================================================
   NAVEGAÇÃO ENTRE TELAS
========================================================= */

export function showScreen(idToShow) {
  const screenMap = {
    home: "homeScreen",
    tables: "tablesScreen",
    game: "game",
    homeScreen: "homeScreen",
    tablesScreen: "tablesScreen"
  };

  const targetId = screenMap[idToShow] || idToShow;

  const screenIds = [
    "homeScreen",
    "tablesScreen",
    "game"
  ];

  for (const screenId of screenIds) {
    const screen = document.getElementById(screenId);

    if (!screen) {
      continue;
    }

    screen.style.display =
      screenId === targetId
        ? ""
        : "none";
  }

  if (targetId === "homeScreen") {
    setTimeout(
      ensureHomeStatusFeed,
      50
    );
  }
}