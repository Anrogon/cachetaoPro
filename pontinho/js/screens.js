

function transformHomePlayButtons() {
  const buttons = Array.from(document.querySelectorAll("button"));

  const btnOnline = buttons.find(b =>
    b.textContent?.trim().toLowerCase().includes("jogar online")
  );

  if (!btnOnline) return;

  if (document.getElementById("btnClassicModeMain")) return;

  const parent = btnOnline.parentElement;
  if (!parent) return;

  const btnClassic = document.createElement("button");
  btnClassic.id = "btnClassicModeMain";
  btnClassic.className = btnOnline.className;
  btnClassic.textContent = "Jogar Clássico";
  btnClassic.onclick = () => {
    state.selectedVariant = "CLASSIC";
    showScreen("tables");
  };

  const btnCrazy = document.createElement("button");
  btnCrazy.id = "btnCrazyModeMain";
  btnCrazy.className = btnOnline.className;
  btnCrazy.textContent = "Jogar Crazy";
  btnCrazy.style.background = "#2d6cdf";
  btnCrazy.onclick = () => {
    state.selectedVariant = "CRAZY";
    showScreen("tables");
  };

  const btnLogout = document.getElementById("btnLogout");

  parent.insertBefore(btnClassic, btnOnline);
  parent.insertBefore(btnCrazy, btnOnline);

  if (btnLogout) {
    parent.insertBefore(btnLogout, btnOnline);
  }

  btnOnline.remove();
}

// Feed
let homeStatusFeedTimer = null;
let homeStatusFeedIndex = 0;

const HOME_STATUS_FEED = [
  "💡 Pegou carta do lixo? Use-a em um jogo ou devolva.",
  "🃏 Coringa deve ser usado antes de descartar.",
  "🔥 Sequência precisa ser do mesmo naipe.",
  "💰 Trinca no clássico usa 3 naipes diferentes.",
  "🎯 Bater sem descarte também encerra a rodada.",
  "⚡ Não pode descartar carta que entra na mesa.",
  "🎴 Você pode bater com dois coringas em uma carta.",
  "👏 Quer bater com a mão cheia? Selecione todas as cartas e abaixe os jogos."
];

function ensureHomeStatusFeed() {
  const statusCard = document.querySelector("#homeScreen .home-status");
  if (!statusCard) return;

  let feed = document.getElementById("homeStatusFeed");

  if (!feed) {
    statusCard.insertAdjacentHTML(
      "beforeend",
      `<div id="homeStatusFeed" class="home-status-feed">
         <div class="home-status-feed-text"></div>
       </div>`
    );
    feed = document.getElementById("homeStatusFeed");
  }

  const textEl = feed?.querySelector(".home-status-feed-text");
  if (!textEl) return;

  const renderFeed = () => {
    textEl.textContent =
      HOME_STATUS_FEED[homeStatusFeedIndex % HOME_STATUS_FEED.length];
    homeStatusFeedIndex += 1;
  };

  renderFeed();

  if (homeStatusFeedTimer) {
    clearInterval(homeStatusFeedTimer);
    homeStatusFeedTimer = null;
  }

  homeStatusFeedTimer = setInterval(renderFeed, 3500);
}

// Feed termina aqui

function showScreen(idToShow) {
  const screens = ["homeScreen", "tablesScreen", "game"];

  screens.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.display = id === idToShow ? "" : "none";
  });

  if (idToShow === "home") {
    setTimeout(() => ensureHomeStatusFeed(), 50);
  }
}
