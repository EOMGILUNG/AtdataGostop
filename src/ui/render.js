import { CARD_BACK } from "../data/cards.js?v=20260513-48";
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
} from "../engine/game.js?v=20260513-48";

let matchPrompt = null;
let bombPrompt = null;
let selectedHandCardId = null;
let activeStep = null;
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

  const update = () => {
    render(app, state, setState, update);
    if (!isAnimating && !state.roundOver && state.currentTurn === "cpu" && state.phase === "cpuTurn") {
      window.setTimeout(() => {
        if (isAnimating || state.currentTurn !== "cpu" || state.phase !== "cpuTurn") return;
        runCpuTurn(state);
        animateLatestAction(state, update);
      }, 700);
    }
  };
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
        <div class="deck-row">
          <div class="deck-pile">
            ${cardBackMarkup("더미")}
            <strong>${state.deck.length}</strong>
          </div>
        </div>
        <div class="field-cards">${fieldCards(state)}</div>
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
  return `
    <div class="summary ${playerId}">
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
      const col = isBonus ? 1 : ((monthNum - 1) % 4) + 1;
      const row = isBonus ? 4 : Math.floor((monthNum - 1) / 4) + 1;
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
          ${matchCount ? `<span class="match-badge">${matchCount}장</span>` : ""}
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
      // and play any inline post-steps tied to this card right away
      // (event toast + steal-pi flight, in original order).
      if (step.card?.id) pendingAnimationCardIds.delete(step.card.id);
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
    await sleep(700);

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
  isAnimating = false;
  update();
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
