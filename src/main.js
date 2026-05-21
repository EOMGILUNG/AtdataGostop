import { createGame, resolveInitialBonus } from "./engine/game.js?v=20260513-74";
import { mountGame, animateInitialBonus } from "./ui/render.js?v=20260513-74";

// Single source of truth for the visible build version. Bump this whenever
// you bump the cache-bust query string in the imports above + index.html.
// Rendered on the start menu so the user can see which version is live.
const APP_VERSION = "v20260513-74";

console.log("%c맞고 UI " + APP_VERSION, "color: #ffd87a; font-weight: 700; font-size: 14px;");

const app = document.querySelector("#app");
let state = null;

// ----- Bankroll persistence -----

const STORAGE_KEY = "gostop-money-v1";
const STARTING_BANK = 100;

function loadMoney() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.player === "number" && typeof parsed?.cpu === "number") {
        return parsed;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return { player: STARTING_BANK, cpu: STARTING_BANK };
}

function saveMoney(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (e) {
    /* ignore */
  }
}

let money = loadMoney();

// ----- Stats persistence (rounds, wins, streaks, etc.) -----

const STATS_KEY = "gostop-stats-v1";

const EMPTY_STATS = {
  rounds: 0,
  playerWins: 0,
  cpuWins: 0,
  nagari: 0,
  highestRoundScore: 0,   // largest single-round final score the player took
  biggestGain: 0,         // largest one-round increase to player's bank
  biggestLoss: 0,         // largest one-round decrease to player's bank (positive number)
  currentStreak: 0,       // consecutive player wins, negative for losses
  bestStreak: 0,          // longest run of player wins
  worstStreak: 0,         // longest run of player losses (stored positive)
  firstPlayedAt: null,    // ISO date
  lastPlayedAt: null,
};

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...EMPTY_STATS, ...parsed };
      }
    }
  } catch (e) {
    /* ignore */
  }
  return { ...EMPTY_STATS };
}

function saveStats(value) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(value));
  } catch (e) {
    /* ignore */
  }
}

let stats = loadStats();

function recordRoundStats(result) {
  if (!result) return;
  stats.rounds += 1;
  const now = new Date().toISOString();
  if (!stats.firstPlayedAt) stats.firstPlayedAt = now;
  stats.lastPlayedAt = now;

  if (result.type === "nagari") {
    stats.nagari += 1;
    stats.currentStreak = 0;
  } else if (result.winner === "player") {
    stats.playerWins += 1;
    const score = result.final?.total ?? 0;
    if (score > stats.highestRoundScore) stats.highestRoundScore = score;
    if (score > stats.biggestGain) stats.biggestGain = score;
    stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
    if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
  } else if (result.winner === "cpu") {
    stats.cpuWins += 1;
    const score = result.final?.total ?? 0;
    if (score > stats.biggestLoss) stats.biggestLoss = score;
    stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
    if (-stats.currentStreak > stats.worstStreak) stats.worstStreak = -stats.currentStreak;
  }
  saveStats(stats);
}

function applyRoundResult(result) {
  recordRoundStats(result);
  if (!result) return;
  if (result.type === "nagari") return; // no transfer, multiplier handled inside the engine
  const winner = result.winner;
  if (!winner) return;
  const loser = winner === "player" ? "cpu" : "player";
  const amount = result.final?.total ?? 0;
  if (!amount) return;
  money[winner] += amount;
  money[loser] -= amount;
  saveMoney(money);
}

// ----- Mode helpers -----

function setMode(mode) {
  app.classList.remove("game-screen", "start-screen");
  app.classList.add(mode === "game" ? "game-screen" : "start-screen");
}

function bankCard() {
  return `
    <div class="bank-display">
      <div class="bank-row"><span>내 자산</span><strong>${money.player}점</strong></div>
      <div class="bank-row"><span>상대 자산</span><strong>${money.cpu}점</strong></div>
    </div>
  `;
}

function statsCard() {
  if (!stats.rounds) {
    return `
      <div class="stats-display">
        <div class="stats-empty">아직 플레이 기록이 없어 — 첫 라운드를 시작해봐!</div>
      </div>
    `;
  }
  const winRate = stats.rounds > 0
    ? Math.round((stats.playerWins / stats.rounds) * 100)
    : 0;
  const streakLabel = stats.currentStreak > 0
    ? `🔥 ${stats.currentStreak}연승`
    : stats.currentStreak < 0
      ? `💧 ${-stats.currentStreak}연패`
      : "—";
  return `
    <div class="stats-display">
      <div class="stats-title">누적 전적</div>
      <div class="stats-grid">
        <div class="stat-cell"><span>총 라운드</span><strong>${stats.rounds}판</strong></div>
        <div class="stat-cell"><span>승 / 패 / 나가리</span><strong>${stats.playerWins} / ${stats.cpuWins} / ${stats.nagari}</strong></div>
        <div class="stat-cell"><span>승률</span><strong>${winRate}%</strong></div>
        <div class="stat-cell"><span>현재 흐름</span><strong>${streakLabel}</strong></div>
        <div class="stat-cell"><span>최고 한 판 점수</span><strong>${stats.highestRoundScore}점</strong></div>
        <div class="stat-cell"><span>한 판 최대 획득</span><strong>+${stats.biggestGain}점</strong></div>
        <div class="stat-cell"><span>최장 연승 / 연패</span><strong>${stats.bestStreak} / ${stats.worstStreak}</strong></div>
      </div>
    </div>
  `;
}

// ----- Screens -----

function showMenu() {
  setMode("menu");
  app.innerHTML = `
    <div class="start-menu">
      <h1 class="start-title">맞고</h1>
      <p class="start-subtitle">Korean Hwatu · 1 vs CPU</p>
      <p class="start-version">${APP_VERSION}</p>
      ${bankCard()}
      ${statsCard()}
      <div class="start-buttons">
        <button class="primary start-button" data-action="start">게임 시작</button>
        <button class="ghost start-button" data-action="rules">게임 규칙</button>
        <button class="danger start-button" data-action="quit">게임 종료</button>
      </div>
      <div class="start-buttons-mini">
        <button class="ghost start-button-mini" data-action="reset-bank">자산 초기화</button>
        <button class="ghost start-button-mini" data-action="reset-stats">전적 초기화</button>
      </div>
    </div>
  `;
  app.querySelector('[data-action="start"]').addEventListener("click", startGame);
  app.querySelector('[data-action="rules"]').addEventListener("click", showRules);
  app.querySelector('[data-action="quit"]').addEventListener("click", quitGame);
  app.querySelector('[data-action="reset-bank"]').addEventListener("click", () => {
    if (confirm("자산을 100점으로 초기화할까? (전적은 그대로 유지)")) {
      money = { player: STARTING_BANK, cpu: STARTING_BANK };
      saveMoney(money);
      showMenu();
    }
  });
  app.querySelector('[data-action="reset-stats"]').addEventListener("click", () => {
    if (confirm("누적 전적을 모두 지울까? (자산은 그대로 유지)")) {
      stats = { ...EMPTY_STATS };
      saveStats(stats);
      showMenu();
    }
  });
}

function showRules() {
  setMode("menu");
  app.innerHTML = `
    <div class="start-menu rules-screen">
      <h1 class="start-title" style="font-size: 36px;">게임 규칙</h1>
      <div class="rules-content">
        <h3>기본 흐름</h3>
        <p>나와 컴퓨터가 번갈아 카드를 한 장씩 내고, 덱에서 한 장을 더 뒤집어. 같은 월 카드끼리 짝을 맞춰 잡으면 내 자리로 모임. <strong>7점</strong> 이상 모으면 <strong>고</strong> / <strong>스톱</strong> 선택 가능.</p>
        <h3>카드 종류와 점수</h3>
        <ul>
          <li><strong>광 (5장)</strong>: 3장 모으면 3점, 4장 4점, 5장 15점. 비광(12월) 포함 3장이면 2점.</li>
          <li><strong>열끗 (9장)</strong>: 5장부터 1점, 한 장 더 모일 때마다 +1점. <strong>고도리</strong>(2·4·8월 새) 3장 모이면 +5점.</li>
          <li><strong>띠 (10장)</strong>: 5장부터 1점씩. <strong>홍단/청단/초단</strong> 각 3장 모이면 +3점.</li>
          <li><strong>피</strong>: 10장부터 1점씩. 쌍피·보너스피는 2~3장으로 계산.</li>
        </ul>
        <h3>특수 상황</h3>
        <ul>
          <li><strong>쪽</strong>: 손패 한 장을 깔았는데, 덱에서 같은 월이 나와 방금 깐 카드를 잡아감. 상대 피 1장 뺏어옴.</li>
          <li><strong>뻑</strong>: 손에서 낸 카드와 바닥 2장이 같은 월 → 3장이 바닥에 묶임. 다음에 4번째가 들어오면 4장 모두 잡고 상대 피 1장.</li>
          <li><strong>흔들기</strong>: 같은 월 3장이 손에 들어오면 게임 시작 시 흔들기 선언 가능. 이기면 점수 2배.</li>
          <li><strong>폭탄</strong>: 같은 월 3장이 손에 있고 바닥에도 같은 월이 있으면 한 번에 4장 다 잡기.</li>
          <li><strong>싹쓸이</strong>: 한 턴 후 바닥이 비면 상대 피 1장 뺏어옴.</li>
          <li><strong>보너스</strong>: 보너스 카드가 손에 들어오거나 덱에서 나오면 즉시 내 자리로 + 상대 피 1장. 손에서 낼 때는 턴이 끝나지 않음.</li>
        </ul>
        <h3>자산</h3>
        <p>나와 상대는 각각 <strong>100점</strong>의 자산을 갖고 시작해. 한 라운드를 이기면 점수만큼 상대에게서 가져옴. <strong>자산이 0이 되면 게임 종료</strong>.</p>
      </div>
      <button class="primary start-button" data-action="back" style="margin-top: 20px; width: min(280px, 100%);">메뉴로</button>
    </div>
  `;
  app.querySelector('[data-action="back"]').addEventListener("click", showMenu);
}

function quitGame() {
  if (!confirm("정말 게임을 종료할까?")) return;
  setMode("menu");
  app.innerHTML = `
    <div class="start-menu">
      <h1 class="start-title">잘 가!</h1>
      <p class="start-subtitle">다음에 또 보자</p>
      <div class="start-buttons">
        <button class="ghost start-button" data-action="reopen">다시 메뉴로</button>
      </div>
    </div>
  `;
  app.querySelector('[data-action="reopen"]').addEventListener("click", showMenu);
}

function showGameOver(title, subtitle) {
  setMode("menu");
  app.innerHTML = `
    <div class="start-menu">
      <h1 class="start-title">${title}</h1>
      <p class="start-subtitle">${subtitle}</p>
      ${bankCard()}
      <div class="start-buttons">
        <button class="primary start-button" data-action="reset-bank">새 게임 시작 (자산 100점부터)</button>
        <button class="ghost start-button" data-action="menu">메뉴로</button>
      </div>
    </div>
  `;
  app.querySelector('[data-action="reset-bank"]').addEventListener("click", () => {
    money = { player: STARTING_BANK, cpu: STARTING_BANK };
    saveMoney(money);
    startGame();
  });
  app.querySelector('[data-action="menu"]').addEventListener("click", showMenu);
}

// ----- Dealing animation -----

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Deals directly into the already-mounted game UI. Each rendered card
// (cpu hidden hand, field cards, player hand) is yanked to the deck position
// via an inline transform, then transitioned back to its natural layout spot
// with a staggered delay. No overlay screen, no keyframe CSS-variable tricks.
async function runDealingAnimation() {
  app.classList.add("dealing");
  // Let the browser settle layout before we measure positions.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const deckEl = app.querySelector(".deck-pile");
  if (!deckEl) {
    app.classList.remove("dealing");
    return;
  }
  const deckRect = deckEl.getBoundingClientRect();
  const deckCx = deckRect.left + deckRect.width / 2;
  const deckCy = deckRect.top + deckRect.height / 2;

  const cpuCards = Array.from(app.querySelectorAll(".opponent-zone .hidden-hand .card-back"));
  const fieldCards = Array.from(app.querySelectorAll(".field-cards .card-img"));
  const playerCards = Array.from(app.querySelectorAll(".player-zone .hand-row .hand-card"));

  // Deal in 5 blocks with a brief pause between each:
  //   1) opponent first 5
  //   2) my first 5
  //   3) opponent last 5
  //   4) my last 5
  //   5) field (8)
  const STAGGER = 55;
  const GROUP_PAUSE = 260;
  const DURATION = 560;

  const order = [];
  const delays = [];
  let cursor = 0;
  const pushGroup = (cards) => {
    for (const card of cards) {
      if (!card) continue;
      order.push(card);
      delays.push(cursor);
      cursor += STAGGER;
    }
    cursor += GROUP_PAUSE;
  };
  pushGroup(cpuCards.slice(0, 5));
  pushGroup(playerCards.slice(0, 5));
  pushGroup(fieldCards.slice(0, 4));
  pushGroup(cpuCards.slice(5, 10));
  pushGroup(playerCards.slice(5, 10));
  pushGroup(fieldCards.slice(4, 8));

  if (order.length === 0) {
    app.classList.remove("dealing");
    return;
  }

  // Deck count visual: at the start of dealing, every card that's about to
  // be flown out of the deck still belongs to the "deck" visually. So bump
  // the counter up by order.length now, then decrement it by 1 as each card
  // launches its flight. By the end, the counter naturally lands at the
  // engine's actual state.deck.length.
  const deckCountEl = deckEl.querySelector("strong");
  const initialDisplayCount = Number(deckCountEl?.textContent ?? state.deck.length);
  let visualDeckCount = initialDisplayCount + order.length;
  if (deckCountEl) deckCountEl.textContent = String(visualDeckCount);

  // Step 1: snap every card to the deck with no transition. This must happen
  // synchronously so the browser paints the "all at deck" state before we
  // start the per-card transitions.
  const offsets = order.map((card) => {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return { dx: Math.round(deckCx - cx), dy: Math.round(deckCy - cy) };
  });
  order.forEach((card, i) => {
    card.style.transition = "none";
    card.style.transform = `translate(${offsets[i].dx}px, ${offsets[i].dy}px) scale(0.55)`;
    card.style.opacity = "0";
    card.style.zIndex = "5";
  });

  // Force a reflow so the browser commits the deck-position state.
  /* eslint-disable-next-line no-unused-expressions */
  app.offsetHeight;

  // Wait one frame so the initial state is painted.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  // Step 2: schedule each card's transition back to identity with a stagger.
  // Also schedule a deck-count decrement at the exact moment each card
  // begins its flight out of the deck.
  order.forEach((card, i) => {
    const delay = delays[i];
    card.style.transition =
      `transform ${DURATION}ms cubic-bezier(0.3, 0.65, 0.4, 1) ${delay}ms,` +
      ` opacity 220ms ease-out ${delay}ms`;
    card.style.transform = "translate(0px, 0px) scale(1)";
    card.style.opacity = "1";
    window.setTimeout(() => {
      if (!deckCountEl) return;
      visualDeckCount -= 1;
      deckCountEl.textContent = String(visualDeckCount);
    }, delay);
  });

  const lastDelay = delays[delays.length - 1] ?? 0;
  await sleep(lastDelay + DURATION + 160);

  // Cleanup — restore default styling/animations.
  order.forEach((card) => {
    card.style.transition = "";
    card.style.transform = "";
    card.style.opacity = "";
    card.style.zIndex = "";
  });
  app.classList.remove("dealing");
}

// ----- Game flow -----

// Standard Gostop convention: the winner of the previous round goes first
// next round. First round starts with player.
let nextStartingPlayer = "player";

async function startGame() {
  if (money.player <= 0) {
    showGameOver("패배…", "자산이 다 떨어졌어");
    return;
  }
  if (money.cpu <= 0) {
    showGameOver("승리!", "상대 자산을 다 가져왔어");
    return;
  }
  setMode("game");
  // Show the visible version chip in the corner so we always know which
  // build is running on the device.
  const existingChip = document.getElementById("version-chip");
  if (existingChip) existingChip.remove();
  const chip = document.createElement("div");
  chip.id = "version-chip";
  chip.textContent = APP_VERSION;
  document.body.appendChild(chip);
  // skipInitialBonus: leave bonus cards on the field so the user can SEE
  // them during dealing, then we'll capture them with animation afterwards.
  state = createGame({
    startingPlayer: nextStartingPlayer,
    skipInitialBonus: true,
  });
  state.bank = { ...money };
  mountGame(app, state, () => {
    const result = state?.result;
    // Track who won so the next round starts with them.
    if (result?.winner === "player") nextStartingPlayer = "player";
    else if (result?.winner === "cpu") nextStartingPlayer = "cpu";
    // (nagari: keep the previous starting player.)
    applyRoundResult(result);
    if (state?.bank) state.bank = { ...money };
    startGame();
  });
  await runDealingAnimation();
  // Now any bonus cards that came out in the deal are visible on the field.
  // Capture them with animation (replacements flow in from deck).
  if (state.field.some((c) => c.types?.includes("bonus"))) {
    resolveInitialBonus(state);
    await animateInitialBonus(state, app);
  }
}

showMenu();
