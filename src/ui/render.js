import { CARD_BACK } from "../data/cards.js?v=20260513-75";
import {
  calculateScore,
  chooseGo,
  chooseStop,
  confirmChongtong,
  declareShake,
  getBombOptions,
  playBomb,
  playCard,
  runCpuTurn,
  skipShake,
} from "../engine/game.js?v=20260513-75";

let matchPrompt = null;
let bombPrompt = null;
let selectedHandCardId = null;
let activeStep = null;
// Captured-pile overlay state. When non-null, an overlay sheet is rendered
// showing the given player's captured cards. `auto` means it was opened by
// a capture event (auto-dismiss after a timeout); manual opens stay until
// the user closes them.
let capturedView = null; // { playerId, auto }
let capturedViewTimer = null;
// Array of steps currently rendered with their phase ("land" | "landed" | "capture").
// During the batch capture flow, multiple steps may be active simultaneously
// (all landed, all flying to pile, etc.).
let activeSteps = [];
let activeEvent = null;
let activeStealStep = null;
let isAnimating = false;
// Cards whose motion animation hasn't completed yet. They live in state.field
// (the engine mutated state synchronously) but should not appear as static
// stack cards until their own motion-card animation finishes — otherwise the
// drawn card "pre-appears" on the field during the played-step animation.
let pendingAnimationCardIds = new Set();
// IDs of cards the engine has already drawn out of the deck (state.deck.length
// is already decremented) but whose Phase 1 fly-out animation has NOT yet
// started. We add this count back to the deck display so the visual count
// stays at "still in deck" until the card actually starts flying.
let pendingDrawnIds = new Set();
// The currently mounted game's update() — stored at module scope so helper
// functions (animateInitialBonus, etc.) can trigger a re-render without
// being passed the closure explicitly. mountGame sets this on every mount.
let activeUpdate = null;

const EVENT_LABELS = {
  jjok: "쪽!",
  ttadak: "따닥!",
  ppeok: "뻑!",
  "ppeok-clear": "뻑 풀기!",
  quad: "4장!",
  sweep: "싹쓸이!",
  bomb: "폭탄!",
  bonus: "보너스!",
  go: "고!",
  stop: "스톱!",
};

const YAKU_GROUPS = [
  { group: "gwang", label: "광", entries: [
    { id: "samgwang", label: "3광", aliases: ["samgwang", "rainSamgwang"] },
    { id: "sagwang", label: "4광" },
    { id: "ogwang", label: "5광" },
  ] },
  { group: "yeol", label: "열끗", entries: [
    { id: "godori", label: "고도리" },
  ] },
  { group: "tti", label: "띠", entries: [
    { id: "hongdan", label: "홍단" },
    { id: "cheongdan", label: "청단" },
    { id: "chodan", label: "초단" },
  ] },
];

export function mountGame(app, state, setState) {
  // Reset transient module state in case a previous round left animation
  // tracking in a partial state (e.g., user restarted mid-animation).
  matchPrompt = null;
  bombPrompt = null;
  selectedHandCardId = null;
  activeStep = null;
  activeSteps = [];
  activeEvent = null;
  activeStealStep = null;
  isAnimating = false;
  pendingAnimationCardIds = new Set();
  pendingDrawnIds = new Set();
  if (capturedViewTimer) { clearTimeout(capturedViewTimer); capturedViewTimer = null; }
  capturedView = null;
  // Reset the stable overlay host so stale content from a previous round
  // doesn't reappear when this round starts.
  const cvHost = document.getElementById("captured-view-root");
  if (cvHost) { cvHost.innerHTML = ""; cvHost._lastHtml = ""; }

  const update = () => {
    render(app, state, setState, update);
    // Pause CPU progression while the captured-pile overlay is open (auto or
    // manual). When the overlay closes — either by its auto-dismiss timer or
    // by the user tapping ✕ — closeCapturedView()/the auto timer call update()
    // again, and we re-enter this function with capturedView == null,
    // restarting the CPU turn naturally.
    if (capturedView) return;
    if (!isAnimating && !state.roundOver && state.currentTurn === "cpu" && state.phase === "cpuTurn") {
      window.setTimeout(() => {
        if (capturedView || isAnimating || state.currentTurn !== "cpu" || state.phase !== "cpuTurn") return;
        runCpuTurn(state);
        animateLatestAction(state, update);
      }, 700);
    }
  };
  activeUpdate = update;
  update();
}

function render(app, state, setState, update) {
  app.innerHTML = `
    <section class="opponent-zone">
      ${playerSummary(state, "cpu")}
      ${hiddenHand(state.players.cpu.hand.length)}
    </section>
    <section class="table-zone">
      <aside class="event-log">${eventLog(state)}</aside>
      <section class="field-zone">
        ${turnBanner(state)}
        <div class="field-cards">
          <div class="deck-pile field-deck" style="grid-column: 3; grid-row: 2;">
            ${cardBackMarkup("더미")}
            <strong>${displayedDeckCount(state)}</strong>
          </div>
          ${fieldCards(state)}
        </div>
        ${bonusMotionLayer()}
        ${eventToastLayer()}
      </section>
      <aside class="status-panel">${statusPanel(state)}</aside>
    </section>
    <section class="player-zone">
      ${shakeBar(state)}
      ${playerSummary(state, "player")}
      <div class="hand-row">${playerHand(state)}</div>
    </section>
    ${modalLayer(state)}
    ${stealFlightLayer()}
  `;
  bindEvents(app, state, setState, update);
  // The captured-pile overlay lives in its OWN host so it isn't recreated
  // on every render() — that would replay its slide-in animation on each
  // game frame and look like a flicker.
  renderCapturedViewHost(state, update);
}

// Stable separate host for the captured-pile overlay. Only updates when the
// effective signature (playerId + auto flag + captured cards) actually
// changes, so the slide-in animation plays exactly once per show.
function renderCapturedViewHost(state, update) {
  const host = document.getElementById("captured-view-root");
  if (!host) return;
  const html = capturedViewLayer(state);
  if (host._lastHtml === html) return;   // no-op: same content already on screen
  host._lastHtml = html;
  host.innerHTML = html;
  host.querySelectorAll("[data-close-captured]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeCapturedView(update);
    });
  });
}

// The engine deals with the deck synchronously: when you play a card,
// state.deck.length is already decreased by the time render() runs. To make
// the on-screen "n장" counter visually decrement only when the drawn card
// actually leaves the deck (Phase 1 land animation), we add back the number
// of drawn steps that are still in flight.
function displayedDeckCount(state) {
  // Two buckets count as "visually still in the deck":
  //   (1) drawn cards the engine already removed from the deck but whose
  //       fly-out animation hasn't started yet → tracked in pendingDrawnIds
  //   (2) drawn cards currently mid-flight (Phase 1 land) — they're leaving
  //       the deck but haven't landed on the field yet
  const inFlightLanding = activeSteps.filter(
    (s) => s.type === "drawn" && s.phase === "land"
  ).length;
  return state.deck.length + pendingDrawnIds.size + inFlightLanding;
}

function inFlightCardIds() {
  // Any card whose visual journey to the captured pile hasn't completed yet —
  // motion-cards still animating + ghost match cards that haven't flown yet
  // + stolen pi cards crossing the screen. These should NOT show up in the
  // player's captured display, even though the engine has already pushed them
  // into player.captured synchronously.
  const ids = new Set(pendingAnimationCardIds);
  for (const step of activeSteps) {
    if (step.card?.id) ids.add(step.card.id);
    for (const ghost of step.ghostCards ?? []) {
      if (ghost?.id) ids.add(ghost.id);
    }
  }
  if (activeStealStep) {
    for (const c of activeStealStep.cards ?? []) {
      if (c?.id) ids.add(c.id);
    }
  }
  return ids;
}

// --- Captured-pile overlay ---------------------------------------------
//
// showCapturedView(playerId, options): show the given player's captured-card
// pile in a bottom-sheet overlay. If options.auto is true, the overlay
// auto-dismisses after options.ms (default 2000). Manual opens stay until
// the user taps the close button (or the backdrop).
function showCapturedView(playerId, options = {}, update) {
  if (capturedViewTimer) { clearTimeout(capturedViewTimer); capturedViewTimer = null; }
  capturedView = { playerId, auto: !!options.auto };
  if (options.auto) {
    capturedViewTimer = setTimeout(() => {
      capturedView = null;
      capturedViewTimer = null;
      if (typeof update === "function") update();
    }, options.ms ?? 2000);
  }
  if (typeof update === "function") update();
}

function closeCapturedView(update) {
  if (capturedViewTimer) { clearTimeout(capturedViewTimer); capturedViewTimer = null; }
  capturedView = null;
  if (typeof update === "function") update();
}

function capturedViewLayer(state) {
  if (!capturedView) return "";
  const playerId = capturedView.playerId;
  const player = state.players[playerId];
  if (!player) return "";
  const captured = player.captured ?? [];
  const score = player.score ?? calculateScore(captured, state.rules);
  const name = playerId === "player" ? "나" : "상대";
  const auto = capturedView.auto ? "auto" : "manual";

  const groups = {
    gwang: captured.filter((c) => c.types.includes("gwang")),
    yeol:  captured.filter((c) => c.types.includes("yeol")),
    tti:   captured.filter((c) => c.types.includes("tti")),
    pi:    captured.filter((c) => c.types.includes("pi") || c.types.includes("ssangpi") || c.types.includes("bonus")),
  };
  const labelOf = { gwang: "광", yeol: "열끗", tti: "띠", pi: "피" };
  const pointsOf = {
    gwang: score.gwang, yeol: score.yeol, tti: score.tti, pi: score.pi,
  };
  const countOf = {
    gwang: score.gwangCount, yeol: score.yeolCount, tti: score.ttiCount, pi: score.piCount,
  };

  const groupHtml = ["gwang", "yeol", "tti", "pi"].map((key) => {
    const cards = groups[key];
    const pts = pointsOf[key];
    return `
      <div class="captured-view-group ${cards.length ? "has-cards" : "empty"}">
        <div class="captured-view-group-head">
          <span class="cvg-label">${labelOf[key]}</span>
          <span class="cvg-count">${countOf[key]}장</span>
          ${pts > 0 ? `<span class="cvg-points">+${pts}점</span>` : ""}
        </div>
        <div class="captured-view-cards">
          ${cards.length === 0
            ? `<div class="captured-view-empty">—</div>`
            : cards.map((c) => {
                // Bonus cards (B01..B03) have no real PNG asset; render them
                // with the same .bonus-card styling used elsewhere so they
                // don't appear as blank slots in the modal.
                if (c.types?.includes("bonus") || !c.image) {
                  return `<span class="bonus-card captured-view-card" role="img" aria-label="${c.name}">${c.piValue ?? ""}피</span>`;
                }
                return `<span class="card-img captured-view-card" role="img" aria-label="${c.name}" style="background-image: url('${c.image}')"></span>`;
              }).join("")}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="captured-view-backdrop ${auto}" data-close-captured></div>
    <div class="captured-view ${auto} ${playerId}">
      <div class="captured-view-head">
        <strong>${name}가 잡은 카드</strong>
        <span class="captured-view-score">${captured.length}장 · ${score.total}점</span>
        <button class="captured-view-close" data-close-captured aria-label="닫기">✕</button>
      </div>
      <div class="captured-view-body">
        ${groupHtml}
      </div>
    </div>
  `;
}

function playerSummary(state, playerId) {
  const player = state.players[playerId];
  const inFlight = inFlightCardIds();
  const visibleCaptured = inFlight.size > 0
    ? player.captured.filter((c) => !inFlight.has(c.id))
    : player.captured;
  const score = visibleCaptured.length === player.captured.length
    ? player.score
    : calculateScore(visibleCaptured, state.rules);
  const win = state.rules.winningScore;
  const progress = Math.min(100, Math.round((score.total / win) * 100));
  const reachedWin = score.total >= win;
  const name = playerId === "player" ? "나" : "상대";
  const avatarLabel = playerId === "player" ? "ME" : "CPU";
  const modifiers = [];
  if (player.goCount > 0) modifiers.push(`고 ${player.goCount}`);
  if (player.shakeCount > 0) modifiers.push(`흔 ${player.shakeCount}`);
  if (state.nagariMultiplier > 1) modifiers.push(`나가리 x${state.nagariMultiplier}`);

  const bank = state.bank?.[playerId];
  // Short one-line summary for the mobile-portrait view (where score-metrics
  // and captured-groups are hidden to save vertical space). Shown via CSS
  // ::after content: attr(data-summary).
  const phoneSummary = [
    `잡 ${visibleCaptured.length}장`,
    `광 ${score.gwangCount}`,
    `띠 ${score.ttiCount}`,
    `열 ${score.yeolCount}`,
    `피 ${score.piCount}`,
  ].join(" · ");
  return `
    <div class="summary ${playerId}" data-summary="${phoneSummary}">
      <div class="summary-header">
        <div class="avatar">${avatarLabel}</div>
        <div>
          <div class="name">${name}${bank != null ? ` <span class="bank-label">자산 ${bank}점</span>` : ""}</div>
          <div>
            <span class="points">${score.total}</span>
            <span class="threshold">/ ${win}점</span>
          </div>
        </div>
        <div class="modifiers">
          ${modifiers.map((text) => `<span class="modifier-chip">${text}</span>`).join("")}
          <button class="captured-view-btn" data-show-captured="${playerId}" aria-label="${name}가 잡은 카드 보기" title="잡은 카드 보기">🃏</button>
        </div>
      </div>
      <div class="score-progress ${reachedWin ? "full" : ""}"><span style="width: ${progress}%"></span></div>
      ${scoreMetrics(score)}
      ${yakuRow(score)}
      ${capturedPreview(visibleCaptured)}
    </div>
  `;
}

function scoreMetrics(score) {
  return `
    <div class="score-metrics">
      ${metricCard("광", score.gwangCount, score.gwang, "gwang")}
      ${metricCard("띠", score.ttiCount, score.tti, "tti")}
      ${metricCard("열끗", score.yeolCount, score.yeol, "yeol")}
      ${metricCard("피", score.piCount, score.pi, "pi")}
    </div>
  `;
}

function metricCard(label, count, points, key) {
  const scoring = points > 0;
  return `
    <div class="metric metric-${key} ${scoring ? "scoring" : ""}">
      <span class="metric-label">${label}</span>
      <span class="metric-value">${count}${scoring ? ` <small style="font-size:11px;color:var(--gold-bright)">+${points}</small>` : ""}</span>
    </div>
  `;
}

function yakuRow(score) {
  const activeIds = new Set(score.yaku.map((entry) => entry.id));
  const pointsById = new Map(score.yaku.map((entry) => [entry.id, entry.points]));
  return `
    <div class="yaku-row">
      ${YAKU_GROUPS.flatMap((group) =>
        group.entries.map((entry) => {
          const aliases = entry.aliases ?? [entry.id];
          const active = aliases.some((id) => activeIds.has(id));
          const points = aliases.map((id) => pointsById.get(id)).find((value) => value != null);
          return `<span class="yaku-badge ${active ? "active" : ""}">${entry.label}${active && points ? ` <span class="yaku-pts">+${points}</span>` : ""}</span>`;
        })
      ).join("")}
    </div>
  `;
}

function capturedPreview(cards) {
  const groups = {
    gwang: cards.filter((card) => card.types.includes("gwang")),
    yeol: cards.filter((card) => card.types.includes("yeol")),
    tti: cards.filter((card) => card.types.includes("tti")),
    pi: cards.filter((card) => !card.types.includes("gwang") && !card.types.includes("yeol") && !card.types.includes("tti")),
  };
  const piTotal = groups.pi.reduce((sum, card) => sum + (card.piValue || 0), 0);
  return `
    <div class="captured-groups">
      ${capturedGroup("광", groups.gwang, groups.gwang.length)}
      ${capturedGroup("띠", groups.tti, groups.tti.length)}
      ${capturedGroup("열끗", groups.yeol, groups.yeol.length)}
      ${capturedGroup("피", groups.pi, piTotal)}
    </div>
  `;
}

function capturedGroup(label, cards, count) {
  return `
    <div class="captured-group">
      <b>${label}<em>${count}</em></b>
      <div class="cards">${sortCapturedWithinGroup(cards).slice(0, 18).map((card) => cardMarkup(card, { small: true })).join("")}</div>
    </div>
  `;
}

function sortCapturedWithinGroup(cards) {
  return [...cards].sort((a, b) => {
    const monthA = a.month ?? 99;
    const monthB = b.month ?? 99;
    if (monthA !== monthB) return monthA - monthB;
    return a.id.localeCompare(b.id);
  });
}

function hiddenHand(count) {
  return `<div class="hidden-hand">${Array.from({ length: count }, (_, index) => cardBackMarkup(`상대 손패 ${index + 1}`)).join("")}</div>`;
}

// Bonus cards have no month, so they can't land in a normal field month-stack.
// Render their motion-cards in a dedicated layer at the center of the field
// zone so the "deck → field → captured" two-phase animation is visible.
function bonusMotionLayer() {
  const bonusSteps = activeSteps.filter((s) => s.card?.types?.includes("bonus"));
  if (bonusSteps.length === 0) return "";
  let idx = 0;
  const html = bonusSteps.map((step) => {
    const out = motionCards(step, idx);
    idx += motionCardCount(step);
    return out;
  }).join("");
  return `<div class="bonus-motion-layer">${html}</div>`;
}

function eventToastLayer() {
  if (!activeEvent) return "";
  const label = EVENT_LABELS[activeEvent.name] ?? activeEvent.name;
  const actor = activeEvent.playerId === "cpu" ? "상대" : "내";
  return `
    <div class="event-toast-layer">
      <div class="event-toast ${activeEvent.name}" key="${activeEvent.key}">
        <span class="event-actor">${actor}</span>${label}
      </div>
    </div>
  `;
}

function stealFlightLayer() {
  if (!activeStealStep) return "";
  const card = activeStealStep.cards?.[0];
  if (!card) return "";
  const dir = activeStealStep.playerId === "cpu" ? "to-cpu" : "to-player";
  const bg = card.types?.includes("bonus")
    ? ""
    : `background-image: url('${card.image}');`;
  const bonusClass = card.types?.includes("bonus") ? "is-bonus" : "";
  return `
    <div class="steal-flight-layer">
      <div class="steal-flight ${dir} ${bonusClass}" style="${bg}" aria-label="피 가져오기"></div>
    </div>
  `;
}

function turnBanner(state) {
  const phase = state.phase;
  let label = state.currentTurn === "player" ? "내 차례" : "상대 차례";
  let cls = state.currentTurn === "player" ? "player" : "cpu";
  if (phase === "shakeDecision") label = "흔들기 선택";
  if (phase === "goStopDecision") label = "고 / 스톱 선택";
  if (phase === "chongtongDecision") label = "총통";
  if (phase === "roundEnd") label = "라운드 종료";
  return `<div class="turn-banner ${cls}"><span class="dot"></span>${label}</div>`;
}

function fieldCards(state) {
  const groups = new Map();
  const selected = state.players.player.hand.find((card) => card.id === selectedHandCardId);
  const handMonths = new Set(state.players.player.hand.filter((card) => card.month != null).map((card) => card.month));

  // Steps currently rendered (may be 0..N depending on phase).
  const steps = activeSteps;

  // Cards already shown as motion-cards — used to dedupe so the same card
  // doesn't appear as both a motion-card AND a ghost in the same render.
  const motionCardIds = new Set();
  for (const step of steps) {
    if (step.card?.id) motionCardIds.add(step.card.id);
  }

  // Filter state.field through pending set so cards mid-animation don't
  // pre-appear underneath their own motion overlay.
  for (const card of state.field) {
    if (pendingAnimationCardIds.has(card.id)) continue;
    const key = card.month ?? "bonus";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }

  // Add ghosts from every active step (the field cards that match each
  // played/drawn card). Dedupe by ID and skip if already shown as motion-card.
  const ghostIds = new Set();
  for (const step of steps) {
    for (const ghost of step.ghostCards ?? []) {
      if (motionCardIds.has(ghost.id)) continue;
      if (ghostIds.has(ghost.id)) continue;
      ghostIds.add(ghost.id);
      const key = ghost.month ?? "bonus";
      if (!groups.has(key)) groups.set(key, []);
      if (!groups.get(key).some((fieldCard) => fieldCard.id === ghost.id)) {
        groups.get(key).push({
          ...ghost,
          isGhost: true,
          ghostPlayerId: step.playerId ?? null,
          ghostPhase: step.phase ?? null,
        });
      }
    }
  }

  // Make sure a month-stack exists for each motion target month.
  for (const step of steps) {
    const m = activeStepMonth(step);
    if (m != null && !groups.has(m)) groups.set(m, []);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([monthKey, cards]) => {
      const isBonus = monthKey === "bonus";
      const monthNum = isBonus ? null : Number(monthKey);
      // 5-column field grid: months still flow left→right in 4 cells per
      // row, but we leave col 3 (the middle) reserved for the deck pile.
      // So an original col of 1,2 stays as 1,2 and 3,4 shifts to 4,5.
      const baseCol = isBonus ? 1 : ((monthNum - 1) % 4) + 1;
      // Bonus cards on field (only at game start, before they're captured)
      // park in the center column directly below the deck (row 3, col 3)
      // — a visible spot that doesn't overlap any month slot.
      const col = isBonus ? 3 : (baseCol >= 3 ? baseCol + 1 : baseCol);
      const row = isBonus ? 3 : Math.floor((monthNum - 1) / 4) + 1;
      const stepsForMonth = steps.filter((s) => activeStepMonth(s) === monthNum);
      const classList = [
        "month-stack",
        `count-${Math.min(cards.length || 1, 4)}`,
        monthNum != null && state.ppeokMonths.includes(monthNum) ? "ppeok" : "",
        monthNum != null && handMonths.has(monthNum) ? "has-hand-match" : "",
        selected?.month === monthNum ? "selected-match-stack" : "",
        stepsForMonth.length > 0 ? "motion-stack" : "",
      ].filter(Boolean).join(" ");

      let motionIdx = 0;
      const motionHtml = stepsForMonth.map((step) => {
        const html = motionCards(step, motionIdx);
        motionIdx += motionCardCount(step);
        return html;
      }).join("");

      return `
        <div class="${classList}" style="grid-column: ${col}; grid-row: ${row};">
          <div class="month-stack-cards">
            ${cards.map((card) => fieldCardMarkup(card, selected, card.isGhost)).join("")}
          </div>
          ${stepsForMonth.length > 0 ? `<div class="motion-layer">${motionHtml}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

function motionCardCount(step) {
  if (step.type === "capture" || step.type === "stealPi" || step.type === "bomb") {
    return step.cards?.length ?? 0;
  }
  return step.card ? 1 : 0;
}

function playerHand(state) {
  const canAct = !isAnimating && state.currentTurn === "player" && ["playerTurn", "shakeDecision"].includes(state.phase) && !state.pendingGoStop;
  const bombs = getBombOptions(state, "player");
  return sortedHand(state.players.player.hand)
    .map((card) => {
      const bomb = bombs.find((option) => option.month === card.month);
      const matchCount = card.month == null ? 0 : state.field.filter((fieldCard) => fieldCard.month === card.month).length;
      return `
        <button class="hand-card ${canAct ? "playable" : ""} ${bomb ? "bombable" : ""} ${matchCount ? "matched" : ""} ${selectedHandCardId === card.id ? "selected" : ""}" data-card-id="${card.id}" ${canAct ? "" : "disabled"}>
          ${cardMarkup(card)}
          ${matchCount ? `<span class="match-mark" aria-label="바닥에 같은 월 카드가 있음"></span>` : ""}
          ${bomb ? `<span class="bomb-badge" data-bomb-month="${bomb.month}">폭탄</span>` : ""}
        </button>
      `;
    })
    .join("");
}

function sortedHand(cards) {
  return [...cards].sort((a, b) => {
    const monthA = a.month ?? 99;
    const monthB = b.month ?? 99;
    if (monthA !== monthB) return monthA - monthB;
    return a.id.localeCompare(b.id);
  });
}

function shakeBar(state) {
  if (state.phase !== "shakeDecision" || state.currentTurn !== "player" || !state.pendingShake?.length) return "";
  return `
    <div class="action-bar">
      <strong>같은 월 3장 — 흔들기 가능</strong>
      <div class="shake-options">
        ${state.pendingShake.map((option) => `<button class="primary" data-shake-month="${option.month}">${option.month}월 흔들기</button>`).join("")}
        <button class="ghost" data-skip-shake>그냥 진행</button>
      </div>
    </div>
  `;
}

function statusPanel(state) {
  const playerFinal = state.players.player.score.total >= state.rules.winningScore ? "고 또는 스톱을 선택하세요" : "";
  const selected = state.players.player.hand.find((card) => card.id === selectedHandCardId);
  const matchText = selected?.month == null ? "" : `${selected.month}월 바닥패 2장 중 가져올 카드를 선택하세요`;
  const hintText = matchText || playerFinal;
  return `
    <h2>상태</h2>
    <dl>
      <dt>턴</dt><dd>${state.currentTurn === "player" ? "내 차례" : "상대 차례"}</dd>
      <dt>더미</dt><dd>${state.deck.length}장</dd>
      <dt>바닥</dt><dd>${state.field.length}장</dd>
      <dt>나가리 배수</dt><dd>x${state.nagariMultiplier}</dd>
      <dt>내 족보</dt><dd>${state.players.player.score.details.join(", ") || "—"}</dd>
    </dl>
    ${hintText ? `<div class="hint">${hintText}</div>` : ""}
  `;
}

function eventLog(state) {
  return `
    <h2>로그</h2>
    ${(state.logs.length ? state.logs : ["새 판 시작"]).slice(0, 6).map((log) => `<p>${log}</p>`).join("")}
  `;
}

function modalLayer(state) {
  if (state.phase === "chongtongDecision" && state.result?.type === "chongtong") {
    const mine = state.result.winner === "player";
    return `
      <div class="modal-backdrop">
        <div class="modal">
          <h2>${mine ? "총통" : "상대 총통"}</h2>
          <div class="modal-cards">${state.result.cards.map((card) => cardMarkup(card)).join("")}</div>
          <p>${mine ? "10점 즉시 승리입니다." : "상대가 10점으로 승리했습니다."}</p>
          <div class="modal-actions">
            <button class="primary" data-confirm-chongtong>${mine ? "승리 확정" : "다시 시작"}</button>
          </div>
        </div>
      </div>
    `;
  }
  if (state.phase === "goStopDecision" && state.pendingGoStop?.playerId === "player") {
    // Don't pop the Go/Stop modal while cards are still moving — wait until
    // the animation flow finishes so the player sees what just happened first.
    if (isAnimating) return "";
    return `
      <div class="modal-backdrop">
        <div class="modal">
          <h2>고 / 스톱</h2>
          <p>현재 <strong style="color:var(--gold-bright)">${state.players.player.score.total}점</strong> 입니다.</p>
          <div class="modal-actions">
            <button class="primary" data-go>고</button>
            <button class="danger" data-stop>스톱</button>
          </div>
        </div>
      </div>
    `;
  }
  if (state.phase === "roundEnd") {
    if (isAnimating) return "";
    const result = state.result;
    const isNagari = result?.type === "nagari";
    const title = isNagari ? "나가리" : `${result?.winner === "player" ? "승리" : "패배"}`;
    const score = result?.final ? `${result.final.total}점` : `다음 판 x${result?.nextMultiplier ?? 2}`;
    let bankInfo = "";
    if (state.bank && !isNagari && result?.winner && result?.final) {
      const amount = result.final.total ?? 0;
      const playerDelta = result.winner === "player" ? amount : -amount;
      const cpuDelta = result.winner === "cpu" ? amount : -amount;
      const newPlayer = state.bank.player + playerDelta;
      const newCpu = state.bank.cpu + cpuDelta;
      const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
      bankInfo = `
        <div class="round-end-bank">
          <div class="bank-row"><span>내 자산</span><strong>${newPlayer}점</strong><small class="${playerDelta >= 0 ? "gain" : "loss"}">${sign(playerDelta)}</small></div>
          <div class="bank-row"><span>상대 자산</span><strong>${newCpu}점</strong><small class="${cpuDelta >= 0 ? "gain" : "loss"}">${sign(cpuDelta)}</small></div>
        </div>
      `;
    } else if (state.bank && isNagari) {
      bankInfo = `
        <div class="round-end-bank">
          <div class="bank-row"><span>내 자산</span><strong>${state.bank.player}점</strong></div>
          <div class="bank-row"><span>상대 자산</span><strong>${state.bank.cpu}점</strong></div>
        </div>
      `;
    }
    return `
      <div class="modal-backdrop">
        <div class="modal">
          <h2>${title}</h2>
          <p>${score}</p>
          ${bankInfo}
          <div class="modal-actions">
            <button class="primary" data-new-game>다음 라운드</button>
          </div>
        </div>
      </div>
    `;
  }
  if (matchPrompt) {
    const handCard = matchPrompt.handCard
      ?? state.players.player.hand.find((c) => c.id === matchPrompt.cardId);
    const month = matchPrompt.matches[0]?.month;
    return `
      <div class="modal-backdrop">
        <div class="modal match-prompt-modal">
          <h2>가져올 짝패 고르기</h2>
          <p class="match-prompt-help">
            <strong>${month}월</strong> 바닥패 중 한 장을 골라. 더 좋은 패(광 &gt; 열끗 &gt; 띠 &gt; 쌍피 &gt; 피)를 고르는 게 보통 이득이야.
          </p>
          ${handCard ? `
            <div class="match-prompt-handcard">
              <span class="match-prompt-label">내가 낸 패</span>
              <div class="match-prompt-card-row">
                ${cardMarkup(handCard)}
                <div class="match-prompt-info">
                  <strong>${handCard.name}</strong>
                  <span class="match-prompt-type ${handCard.types?.[0] ?? "pi"}">${cardTypeLabel(handCard)}</span>
                </div>
              </div>
            </div>
          ` : ""}
          <div class="match-prompt-options">
            ${matchPrompt.matches.map((card) => {
              const tags = cardTagLabels(card);
              return `
                <button class="match-prompt-option" data-field-choice="${card.id}">
                  ${cardMarkup(card)}
                  <div class="match-prompt-info">
                    <strong>${card.name}</strong>
                    <span class="match-prompt-type ${card.types?.[0] ?? "pi"}">${cardTypeLabel(card)}</span>
                    ${tags.length ? `<span class="match-prompt-tag">${tags.join(" · ")}</span>` : ""}
                  </div>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }
  if (bombPrompt) {
    return `
      <div class="modal-backdrop">
        <div class="modal">
          <h2>${bombPrompt.month}월 폭탄</h2>
          <p>3장을 한 번에 내거나 1장만 낼 수 있습니다.</p>
          <div class="modal-actions">
            <button class="danger" data-confirm-bomb="${bombPrompt.month}">폭탄</button>
            <button class="ghost" data-single-card="${bombPrompt.cardId}">1장만 내기</button>
          </div>
        </div>
      </div>
    `;
  }
  return "";
}

function bindEvents(app, state, setState, update) {
  app.querySelectorAll("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (isAnimating || state.currentTurn !== "player") return;
      const cardId = button.dataset.cardId;
      const card = state.players.player.hand.find((candidate) => candidate.id === cardId);
      const bomb = getBombOptions(state, "player").find((option) => option.month === card?.month);
      if (bomb) {
        bombPrompt = { month: bomb.month, cardId };
        update();
        return;
      }
      // For matches=2, the modal prompt (matchPrompt) handles the choice —
      // no more inline selection on the field cards.
      playCardWithPossibleChoice(state, cardId, update);
    });
  });
  app.querySelectorAll("[data-field-play]").forEach((button) => {
    button.addEventListener("click", () => {
      if (isAnimating || !selectedHandCardId) return;
      const fieldChoiceId = button.dataset.fieldPlay;
      const cardId = selectedHandCardId;
      selectedHandCardId = null;
      playCard(state, cardId, { fieldChoiceId });
      animateLatestAction(state, update);
    });
  });
  app.querySelectorAll("[data-shake-month]").forEach((button) => {
    button.addEventListener("click", () => {
      declareShake(state, Number(button.dataset.shakeMonth));
      selectedHandCardId = null;
      update();
    });
  });
  app.querySelector("[data-skip-shake]")?.addEventListener("click", () => {
    skipShake(state);
    selectedHandCardId = null;
    update();
  });
  app.querySelector("[data-go]")?.addEventListener("click", () => {
    state.lastActionSteps = [];
    chooseGo(state);
    animateLatestAction(state, update);
  });
  app.querySelector("[data-stop]")?.addEventListener("click", () => {
    state.lastActionSteps = [];
    chooseStop(state);
    animateLatestAction(state, update);
  });
  app.querySelector("[data-confirm-chongtong]")?.addEventListener("click", () => {
    if (state.result?.winner === "cpu") {
      setState();
      return;
    }
    confirmChongtong(state);
    update();
  });
  app.querySelector("[data-new-game]")?.addEventListener("click", () => setState());
  app.querySelectorAll("[data-show-captured]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showCapturedView(btn.dataset.showCaptured, { auto: false }, update);
    });
  });
  app.querySelectorAll("[data-close-captured]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeCapturedView(update);
    });
  });
  app.querySelectorAll("[data-field-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      playCard(state, matchPrompt.cardId, { fieldChoiceId: button.dataset.fieldChoice });
      matchPrompt = null;
      selectedHandCardId = null;
      animateLatestAction(state, update);
    });
  });
  app.querySelector("[data-confirm-bomb]")?.addEventListener("click", (event) => {
    playBomb(state, Number(event.currentTarget.dataset.confirmBomb));
    bombPrompt = null;
    selectedHandCardId = null;
    animateLatestAction(state, update);
  });
  app.querySelector("[data-single-card]")?.addEventListener("click", (event) => {
    const cardId = event.currentTarget.dataset.singleCard;
    bombPrompt = null;
    playCardWithPossibleChoice(state, cardId, update);
  });
}

function playCardWithPossibleChoice(state, cardId, update) {
  const card = state.players.player.hand.find((candidate) => candidate.id === cardId);
  const matches = card && !card.types.includes("bonus") ? state.field.filter((fieldCard) => fieldCard.month === card.month) : [];
  if (matches.length === 2) {
    // Two matching field cards — let the player pick which one to take.
    matchPrompt = { cardId, matches, handCard: card };
    selectedHandCardId = null;
    update();
    return;
  }
  playCard(state, cardId);
  selectedHandCardId = null;
  animateLatestAction(state, update);
}

function cardTypeLabel(card) {
  if (card.types?.includes("gwang")) return "광";
  if (card.types?.includes("ssangpi")) return "쌍피";
  if (card.types?.includes("yeol")) return "열끗";
  if (card.types?.includes("tti")) return "띠";
  if (card.types?.includes("bonus")) return "보너스";
  return "피";
}

function cardTagLabels(card) {
  const map = {
    hongdan: "홍단",
    cheongdan: "청단",
    chodan: "초단",
    godori: "고도리",
    rainGwang: "비광",
    sakeCup: "국준",
  };
  return (card.tags ?? []).map((tag) => map[tag]).filter(Boolean);
}

// Animate the resolution of bonus cards that were dealt to the field at
// game start. Called from main.js AFTER the dealing animation completes,
// AFTER `resolveInitialBonus(state)` has updated the engine state.
// Strategy: grab each bonus DOM element still on the rendered field, fly
// it to the player's summary area with a scale-down + fade, then re-render
// with the updated state (replacement cards already in state.field).
export async function animateInitialBonus(state, app) {
  const bonusEls = Array.from(app.querySelectorAll(".field-cards .bonus-card"));
  if (bonusEls.length === 0) return;

  const playerEl = app.querySelector(".player-zone .summary.player .avatar")
    || app.querySelector(".player-zone");
  if (!playerEl) return;

  const targetRect = playerEl.getBoundingClientRect();
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;

  for (const el of bonusEls) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.round(targetCx - cx);
    const dy = Math.round(targetCy - cy);
    el.style.transition = "transform 700ms cubic-bezier(0.4, 0, 0.2, 1), opacity 700ms ease-out";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(0.35) rotate(8deg)`;
    el.style.opacity = "0.15";
    el.style.zIndex = "30";
  }
  // Briefly show a "보너스!" toast.
  activeEvent = { type: "event", name: "bonus", playerId: "player", key: `init-bonus-${Date.now()}` };
  // Re-render just the toast layer doesn't exist here; force a re-render later.
  await sleep(820);
  activeEvent = null;

  // Re-render — engine state already has bonus in captured + replacements
  // on field. The new render replaces the bonus DOM (now offscreen due to
  // our inline transform) with the post-resolution field. Old inline
  // transforms vanish because the bonus DOM is no longer in the tree.
  if (typeof activeUpdate === "function") activeUpdate();
  // Tiny delay to let DOM update.
  await sleep(60);
}

async function animateLatestAction(state, update) {
  const allSteps = state.lastActionSteps ?? [];

  // Cards that the engine has already captured this turn. Any played/drawn
  // step whose card ends up here will participate in the BATCH capture phase
  // (all together) after every card has finished landing on the field.
  const capturedIds = new Set();
  for (const step of allSteps) {
    if (step.type === "capture") {
      for (const card of step.cards ?? []) {
        if (card?.id) capturedIds.add(card.id);
      }
    }
  }

  // Map each "post" step (event toast + stealPi flight) to the card step
  // (played/drawn/bomb) that triggered it. Naïvely we'd just take the most
  // recent played/drawn before the post step — but the engine emits stealPi
  // right after the *committed* capture, which can happen long after the
  // triggering card was drawn (e.g. a bonus drawn early, then committed at
  // the end of the turn after another draw landed a ppeok). So we look for
  // the nearest preceding `capture` step and try to match its cards back to
  // a played/drawn step. If the capture is a "deferred" placeholder, we walk
  // forward to find the matching committed capture's stealPi/event. Falls
  // back to the simple "most recent card step" heuristic if nothing matches.
  const postsByCardId = new Map();
  const orphanPosts = [];
  const findTriggerFromCapture = (captureStep) => {
    const cardIds = (captureStep?.cards ?? []).map((c) => c?.id).filter(Boolean);
    if (!cardIds.length) return null;
    // Look for the played/drawn/bomb step that introduced one of the captured cards.
    for (let k = allSteps.length - 1; k >= 0; k--) {
      const s = allSteps[k];
      if (!["played", "drawn", "bomb"].includes(s.type)) continue;
      const sid = s.card?.id ?? s.cards?.[0]?.id ?? null;
      if (sid && cardIds.includes(sid)) return sid;
    }
    return null;
  };
  for (let i = 0; i < allSteps.length; i++) {
    const step = allSteps[i];
    if (step.type !== "event" && step.type !== "stealPi") continue;
    let triggerId = null;

    // Prefer association via the nearest preceding capture step.
    for (let j = i - 1; j >= 0; j--) {
      const prev = allSteps[j];
      if (prev.type === "capture") {
        triggerId = findTriggerFromCapture(prev);
        if (triggerId) break;
        // If we hit a capture but couldn't resolve a trigger, keep looking
        // further back — sometimes the relevant capture is earlier.
      }
      // Stop the backwards walk early if we hit a card step boundary without
      // finding any capture — fall through to the played/drawn fallback.
      if (prev.type === "played" || prev.type === "drawn" || prev.type === "bomb") {
        if (triggerId) break;
        // Use this as a fallback candidate but keep scanning a little for a capture.
      }
    }

    // Fallback: the most recent played/drawn/bomb before this post step.
    if (!triggerId) {
      for (let j = i - 1; j >= 0; j--) {
        if (["played", "drawn", "bomb"].includes(allSteps[j].type)) {
          triggerId = allSteps[j].card?.id ?? allSteps[j].cards?.[0]?.id ?? null;
          break;
        }
      }
    }

    if (triggerId) {
      if (!postsByCardId.has(triggerId)) postsByCardId.set(triggerId, []);
      postsByCardId.get(triggerId).push(step);
    } else {
      orphanPosts.push(step);
    }
  }

  const cardSteps = allSteps
    .filter((step) => ["played", "drawn", "bomb"].includes(step.type))
    .map((step) => {
      const ghostCards = findStepMatches(allSteps, step);
      const willCapture = ["played", "drawn"].includes(step.type)
        && capturedIds.has(step.card?.id);
      return { ...step, ghostCards, willCapture };
    });

  if (!cardSteps.length && orphanPosts.length === 0) {
    update();
    return;
  }

  pendingAnimationCardIds = new Set();
  for (const step of cardSteps) {
    if (step.card?.id) pendingAnimationCardIds.add(step.card.id);
  }

  // Pre-seed pendingDrawnIds with every drawn card from this action so the
  // deck count stays at "pre-draw" until each card actually starts its
  // fly-out. Each entry is removed when its Phase 1 land begins below.
  pendingDrawnIds = new Set();
  for (const step of allSteps) {
    if (step.type === "drawn" && step.card?.id) pendingDrawnIds.add(step.card.id);
  }

  isAnimating = true;
  let eventCounter = 0;
  const showEvent = async (evStep) => {
    activeEvent = { ...evStep, key: `${evStep.name}-${++eventCounter}` };
    update();
    await sleep(eventDuration(evStep.name));
    activeEvent = null;
  };
  const showSteal = async (stealStep) => {
    activeStealStep = stealStep;
    update();
    await sleep(900);
    activeStealStep = null;
  };
  const runPostStep = async (post) => {
    if (post.type === "event") await showEvent(post);
    else if (post.type === "stealPi") await showSteal(post);
  };

  // Phase 1 (sequential): each card lands on the field. Captured cards stay
  // landed so they remain visible while subsequent cards land.
  const landedCapturedSteps = [];
  for (const step of cardSteps) {
    const current = { ...step, phase: "land" };
    // This drawn card is about to start its fly-out — remove it from
    // pendingDrawnIds so the deck count drops by 1 at exactly this moment.
    if (step.type === "drawn" && step.card?.id) {
      pendingDrawnIds.delete(step.card.id);
    }
    activeSteps = [
      ...landedCapturedSteps.map((s) => ({ ...s, phase: "landed" })),
      current,
    ];
    activeStep = current;
    update();
    const landDuration = step.type === "drawn"
      ? 620
      : step.type === "bomb"
        ? 640
        : 560;
    await sleep(landDuration);

    if (step.willCapture) {
      landedCapturedSteps.push(step);
    } else {
      // Stays on field (no match, or self-resolved like bomb). Release it
      // (so fieldCards renders it as a static field card) AND remove it
      // from activeSteps so its motion-card doesn't double-render on top
      // of that static card during the subsequent post-step toasts.
      if (step.card?.id) pendingAnimationCardIds.delete(step.card.id);
      activeSteps = landedCapturedSteps.map((s) => ({ ...s, phase: "landed" }));
      const posts = postsByCardId.get(step.card?.id) ?? [];
      for (const p of posts) await runPostStep(p);
    }
  }

  // Phase 2 (batch): hold every captured card briefly, fire any associated
  // event toasts (so 쪽/뻑/보너스 등이 카드들이 흘러가기 전에 나옴), then
  // sweep them all together to the player's pile.
  if (landedCapturedSteps.length > 0) {
    activeSteps = landedCapturedSteps.map((s) => ({ ...s, phase: "landed" }));
    activeStep = activeSteps[activeSteps.length - 1];
    update();
    // Hold the landed-but-not-yet-flown cards on the field a bit longer so
    // the user can see what just got captured before they fly away.
    await sleep(1300);

    // Event toasts BEFORE the cards fly to the pile.
    for (const step of landedCapturedSteps) {
      const posts = postsByCardId.get(step.card?.id) ?? [];
      for (const p of posts) await runPostStep(p);
    }

    activeSteps = landedCapturedSteps.map((s) => ({ ...s, phase: "capture" }));
    activeStep = activeSteps[activeSteps.length - 1];
    update();
    await sleep(640);

    for (const s of landedCapturedSteps) {
      if (s.card?.id) pendingAnimationCardIds.delete(s.card.id);
    }
  }

  activeSteps = [];
  activeStep = null;

  // Orphan posts (no associated card — e.g., a stop/go event recorded
  // directly via a button click).
  for (const p of orphanPosts) await runPostStep(p);

  pendingAnimationCardIds.clear();
  pendingDrawnIds.clear();
  isAnimating = false;

  // After captures complete, auto-show the captured pile for the actor for
  // ~2 seconds so the user sees what was just added. The actor is taken
  // from the first capture step (since by now `state.currentTurn` may have
  // already advanced to the other side).
  const captureStep = (state.lastActionSteps ?? []).find((s) => s.type === "capture");
  if (captureStep?.playerId && !state.roundOver) {
    showCapturedView(captureStep.playerId, { auto: true, ms: 2000 }, update);
  } else {
    update();
  }
}

function eventDuration(name) {
  if (name === "bonus" || name === "bomb") return 1000;
  return 850;
}

function fieldCardMarkup(card, selected, isGhost = false) {
  const isMatch = selected?.month != null && selected.month === card.month;
  if (isGhost) {
    const dir = card.ghostPlayerId === "cpu" ? "to-cpu" : "to-player";
    const phase = card.ghostPhase ? `phase-${card.ghostPhase}` : "";
    return `<span class="ghost-field-card ${dir} ${phase}">${cardMarkup(card)}</span>`;
  }
  if (!isMatch) return cardMarkup(card);
  return `<button class="field-choice-inline" data-field-play="${card.id}" aria-label="${card.name} 선택">${cardMarkup(card)}<span>선택</span></button>`;
}

function findStepMatches(steps, step) {
  if (!["played", "drawn"].includes(step.type) || !step.card) return [];
  const match = steps.find((candidate) =>
    candidate.type === "matchCheck"
    && candidate.card?.id === step.card.id
    && candidate.source === step.source
  );
  return match?.matches ?? [];
}

function activeStepGhostCards(step) {
  return step?.ghostCards ?? [];
}

function activeStepMonth(step) {
  if (!step) return null;
  if (step.month != null) return Number(step.month);
  const card = step.card ?? step.cards?.[0] ?? step.matches?.[0] ?? step.fieldCards?.[0];
  return card?.month == null ? null : Number(card.month);
}

function motionCards(step, startIndex = 0) {
  if (!step) return "";
  if (step.type === "matchCheck" && !step.matches?.length) return "";
  const ownCards = step.type === "capture" || step.type === "stealPi" || step.type === "bomb"
    ? step.cards ?? []
    : [step.card].filter(Boolean);
  const matchCards = step.type === "matchCheck" ? step.matches ?? [] : [];
  const cards = [...ownCards, ...matchCards].filter((card) => card?.month != null || card?.types?.includes("bonus"));
  if (!cards.length) return "";
  const willCapture = step.willCapture === true;
  const dirClass = step.playerId === "cpu" ? "to-cpu" : "to-player";
  const fromClass = step.playerId === "cpu" ? "from-cpu" : "from-player";
  const phaseClass = step.phase ? `phase-${step.phase}` : "";
  const capturedClass = willCapture ? `captured ${dirClass} ${phaseClass}` : "";
  return cards.map((card, index) => `
    <span class="motion-card ${step.type} ${capturedClass} ${fromClass}" style="--i: ${startIndex + index}">
      ${cardMarkup(card)}
    </span>
  `).join("");
}

function cardMarkup(card, options = {}) {
  if (card.types.includes("bonus")) {
    return `<span class="bonus-card ${options.small ? "small" : ""}" aria-label="${card.name}"><b>${card.piValue}피</b><em>보너스</em></span>`;
  }
  return `<span class="card-img ${options.small ? "small" : ""}" role="img" aria-label="${card.name}" style="background-image: url('${card.image}')"></span>`;
}

function cardBackMarkup(label) {
  return `<span class="card-img card-back" role="img" aria-label="${label}" style="background-image: url('${CARD_BACK}')"></span>`;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
