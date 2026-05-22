import { createDeck } from "../data/cards.js?v=20260513-79";
import { DEFAULT_RULES } from "../data/rules.js?v=20260513-79";

export function shuffle(cards, random = Math.random) {
  const copy = cards.map((card) => ({ ...card, types: [...card.types], tags: [...card.tags] }));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createGame(options = {}) {
  const rules = { ...DEFAULT_RULES, ...options.rules };
  const sourceDeck = options.deck ?? createDeck();
  const deck = options.shuffle === false ? sourceDeck.map((card) => ({ ...card, types: [...card.types], tags: [...card.tags] })) : shuffle(sourceDeck, options.random);
  const player = createPlayer("player");
  const cpu = createPlayer("cpu");
  const field = [];

  player.hand = deck.splice(0, 10);
  cpu.hand = deck.splice(0, 10);
  field.push(...deck.splice(0, 8));

  const startingPlayer = options.startingPlayer === "cpu" ? "cpu" : "player";
  const state = {
    phase: `${startingPlayer}Turn`,
    deck,
    field,
    players: { player, cpu },
    currentTurn: startingPlayer,
    pendingChoice: null,
    pendingGoStop: null,
    turnContext: null,
    lastActionSteps: [],
    roundOver: false,
    winner: null,
    nagariMultiplier: options.nagariMultiplier ?? 1,
    result: null,
    logs: [],
    ppeokMonths: [],
    ppeokCreators: {},
    pendingHandMatch: null,
    rules,
  };

  // Initial-bonus handling is normally done synchronously inside createGame
  // (any bonus card dealt to the field is captured immediately + replaced
  // from the deck). When `skipInitialBonus` is true we leave the bonus on
  // the field so the UI can show the dealing animation with the bonus
  // visible, then run resolveInitialBonus() to animate it flying to the
  // player's pile.
  if (!options.skipInitialBonus) {
    handleStartingBonus(state);
  }
  const chongtong = detectChongtong(state);
  if (chongtong) {
    state.phase = "chongtongDecision";
    state.result = {
      type: "chongtong",
      winner: chongtong.playerId,
      score: rules.chongtongScore,
      cards: chongtong.cards,
    };
    state.logs.unshift(`${label(chongtong.playerId)} 총통: ${chongtong.cards[0].monthName}`);
  } else {
    beginTurn(state, startingPlayer);
  }
  return state;
}

function createPlayer(id) {
  return {
    id,
    hand: [],
    captured: [],
    score: emptyScore(),
    goCount: 0,
    shakeCount: 0,
    shakenMonths: [],
    skippedShakeMonths: [],
  };
}

export function emptyScore() {
  return {
    gwang: 0,
    yeol: 0,
    tti: 0,
    pi: 0,
    total: 0,
    piCount: 0,
    gwangCount: 0,
    yeolCount: 0,
    ttiCount: 0,
    details: [],
    yaku: [],
  };
}

export function calculateScore(captured, rules = DEFAULT_RULES) {
  const score = emptyScore();
  const gwangs = captured.filter((card) => card.types.includes("gwang"));
  const yeols = captured.filter((card) => card.types.includes("yeol"));
  const ttis = captured.filter((card) => card.types.includes("tti"));
  const piCount = captured.reduce((sum, card) => sum + (card.piValue || 0), 0);

  score.gwangCount = gwangs.length;
  score.yeolCount = yeols.length;
  score.ttiCount = ttis.length;
  score.piCount = piCount;

  const push = (id, label, points, group) => {
    score.details.push(label);
    score.yaku.push({ id, label, points, group });
  };

  if (gwangs.length === 3) {
    const rainy = gwangs.some((card) => card.tags.includes("rainGwang"));
    score.gwang = rainy ? rules.rainGwangThreeScore : 3;
    push(rainy ? "rainSamgwang" : "samgwang", rainy ? "비삼광" : "삼광", score.gwang, "gwang");
  } else if (gwangs.length === 4) {
    score.gwang = 4;
    push("sagwang", "사광", 4, "gwang");
  } else if (gwangs.length === 5) {
    score.gwang = 15;
    push("ogwang", "오광", 15, "gwang");
  }

  if (yeols.length >= 5) {
    const points = yeols.length - 4;
    score.yeol += points;
    push("yeolCount", `열끗 ${yeols.length}장`, points, "yeol");
  }
  if (["2", "4", "8"].every((month) => yeols.some((card) => String(card.month) === month && card.tags.includes("godori")))) {
    score.yeol += 5;
    push("godori", "고도리", 5, "yeol");
  }

  if (ttis.length >= 5) {
    const points = ttis.length - 4;
    score.tti += points;
    push("ttiCount", `띠 ${ttis.length}장`, points, "tti");
  }
  for (const [tag, id, name] of [["hongdan", "hongdan", "홍단"], ["cheongdan", "cheongdan", "청단"], ["chodan", "chodan", "초단"]]) {
    if (ttis.filter((card) => card.tags.includes(tag)).length === 3) {
      score.tti += 3;
      push(id, name, 3, "tti");
    }
  }

  if (piCount >= 10) {
    const points = piCount - 9;
    score.pi = points;
    push("piCount", `피 ${piCount}장`, points, "pi");
  }

  score.total = score.gwang + score.yeol + score.tti + score.pi;
  return score;
}

export function finalScore(state, winnerId) {
  const winner = state.players[winnerId];
  const loser = state.players[other(winnerId)];
  let points = winner.score.total;
  const multipliers = [];

  if (winner.goCount === 1) points += 1;
  if (winner.goCount === 2) points += 2;
  if (winner.goCount >= 3) multipliers.push(2 ** (winner.goCount - 2));
  if (winner.shakeCount > 0) multipliers.push(state.rules.shakeMultiplier ** winner.shakeCount);
  if (state.nagariMultiplier > 1) multipliers.push(state.nagariMultiplier);
  if (state.rules.enableGwangBak && winner.score.gwang > 0 && loser.score.gwangCount === 0) multipliers.push(2);
  if (state.rules.enablePiBak && winner.score.pi > 0 && loser.score.piCount <= 5) multipliers.push(2);
  if (state.rules.enableMeongBak && winner.score.yeol > 0 && winner.score.yeolCount >= 7 && loser.score.yeolCount === 0) multipliers.push(2);

  return {
    base: winner.score.total,
    additive: points - winner.score.total,
    multiplier: multipliers.reduce((acc, value) => acc * value, 1),
    total: points * multipliers.reduce((acc, value) => acc * value, 1),
    multipliers,
  };
}

function handleStartingBonus(state) {
  let changed = true;
  while (changed) {
    changed = false;
    const bonus = state.field.filter(isBonus);
    if (bonus.length > 0) {
      state.field = state.field.filter((card) => !isBonus(card));
      for (const card of bonus) captureCards(state, "player", [card], { stealPi: true, reason: "시작 보너스" });
      while (state.field.length < 8 && state.deck.length > 0) state.field.push(state.deck.shift());
      changed = true;
    }
  }
}

// Like handleStartingBonus, but records each bonus capture + replacement draw
// as steps in state.lastActionSteps so the UI can replay them with
// animations after the initial dealing. Call this when createGame was
// invoked with skipInitialBonus: true.
export function resolveInitialBonus(state) {
  state.lastActionSteps = [];
  state.deferredCaptures = [];
  let changed = true;
  while (changed) {
    changed = false;
    const bonus = state.field.filter(isBonus);
    if (bonus.length > 0) {
      // Snapshot bonus before removing it from the field.
      for (const card of bonus) {
        // The "initial-field" source tells the UI: this card is ALREADY on
        // the field (placed by dealing); skip the Phase 1 deck→field flight
        // and just do the Phase 2 field→player-pile flight.
        recordStep(state, { type: "drawn", playerId: "player", source: "initial-field", card, month: card.month });
      }
      state.field = state.field.filter((card) => !isBonus(card));
      for (const card of bonus) {
        captureCards(state, "player", [card], { stealPi: true, reason: "시작 보너스" });
        recordStep(state, { type: "event", name: "bonus", playerId: "player" });
      }
      while (state.field.length < 8 && state.deck.length > 0) {
        const refill = state.deck.shift();
        recordStep(state, { type: "drawn", playerId: "player", source: "deck", card: refill, month: refill.month });
        state.field.push(refill);
      }
      changed = true;
    }
  }
}

export function detectChongtong(state) {
  if (!state.rules.enableChongtong) return null;
  for (const playerId of ["player", "cpu"]) {
    const byMonth = groupByMonth(state.players[playerId].hand.filter((card) => !isBonus(card)));
    for (const cards of byMonth.values()) {
      if (cards.length === 4) return { playerId, cards };
    }
  }
  return null;
}

export function confirmChongtong(state) {
  if (!state.result || state.result.type !== "chongtong") return state;
  state.roundOver = true;
  state.winner = state.result.winner;
  state.phase = "roundEnd";
  state.result.final = { base: state.rules.chongtongScore, additive: 0, multiplier: 1, total: state.rules.chongtongScore, multipliers: [] };
  return state;
}

export function beginTurn(state, playerId) {
  state.currentTurn = playerId;
  state.pendingChoice = null;
  state.pendingGoStop = null;
  state.phase = playerId === "player" ? "playerTurn" : "cpuTurn";
  updateScores(state);
  const shakeOptions = getShakeOptions(state, playerId);
  if (shakeOptions.length > 0) {
    state.phase = playerId === "player" ? "shakeDecision" : "cpuTurn";
    state.pendingShake = shakeOptions;
  } else {
    state.pendingShake = null;
  }
}

export function getShakeOptions(state, playerId) {
  if (!state.rules.enableShake) return [];
  const player = state.players[playerId];
  const byMonth = groupByMonth(player.hand.filter((card) => !isBonus(card)));
  return [...byMonth.entries()]
    .filter(([month, cards]) => cards.length === 3 && !player.shakenMonths.includes(month) && !player.skippedShakeMonths.includes(month))
    .map(([month, cards]) => ({ month, cards }));
}

export function declareShake(state, month) {
  const player = state.players[state.currentTurn];
  player.shakeCount += 1;
  player.shakenMonths.push(month);
  player.skippedShakeMonths = player.skippedShakeMonths.filter((value) => value !== month);
  state.logs.unshift(`${label(player.id)} 흔들기: ${month}월`);
  state.pendingShake = null;
  state.phase = player.id === "player" ? "playerTurn" : "cpuTurn";
  return state;
}

export function skipShake(state) {
  const player = state.players[state.currentTurn];
  for (const option of state.pendingShake ?? []) player.skippedShakeMonths.push(option.month);
  state.pendingShake = null;
  state.phase = player.id === "player" ? "playerTurn" : "cpuTurn";
  return state;
}

export function getBombOptions(state, playerId = state.currentTurn) {
  if (!state.rules.enableBomb) return [];
  const player = state.players[playerId];
  const byMonth = groupByMonth(player.hand.filter((card) => !isBonus(card)));
  return [...byMonth.entries()]
    .filter(([month, cards]) => cards.length === 3 && state.field.some((card) => card.month === month))
    .map(([month, cards]) => ({ month, cards, fieldCards: state.field.filter((card) => card.month === month) }));
}

export function playBomb(state, month) {
  const player = state.players[state.currentTurn];
  state.lastActionSteps = [];
  const handCards = player.hand.filter((card) => card.month === month);
  const fieldCards = state.field.filter((card) => card.month === month);
  recordStep(state, { type: "bomb", playerId: player.id, month, cards: handCards, fieldCards });
  player.hand = player.hand.filter((card) => card.month !== month);
  state.field = state.field.filter((card) => card.month !== month);
  captureCards(state, player.id, [...handCards, ...fieldCards], { stealPi: true, reason: "폭탄" });
  recordStep(state, { type: "event", name: "bomb", playerId: player.id, month });
  for (let i = 0; i < state.rules.bombDrawCount && state.deck.length > 0; i += 1) {
    const refill = state.deck.shift();
    player.hand.push(refill);
    recordStep(state, { type: "refill", playerId: player.id, card: refill });
  }
  state.logs.unshift(`${label(player.id)} 폭탄: ${month}월`);
  afterTurn(state, player.id);
}

export function playCard(state, cardId, options = {}) {
  if (state.roundOver || state.pendingChoice) return state;
  const playerId = state.currentTurn;
  const player = state.players[playerId];
  const card = removeById(player.hand, cardId);
  if (!card) return state;
  state.lastActionSteps = [];
  state.deferredCaptures = [];
  // Reset any leftover pending hand match (should not normally carry over).
  state.pendingHandMatch = null;
  recordStep(state, { type: "played", playerId, source: "hand", card, month: card.month });

  if (isBonus(card)) {
    captureCards(state, playerId, [card], { stealPi: true, reason: "보너스", defer: true });
    recordStep(state, { type: "event", name: "bonus", playerId });
    if (state.deck.length > 0) {
      const refill = state.deck.shift();
      player.hand.push(refill);
      recordStep(state, { type: "refill", playerId, card: refill });
    }
    // Bonus is a "free play" — commit the capture but don't draw a deck card
    // or end the turn. The player keeps the same turn and can play again.
    commitDeferredCaptures(state);
    updateScores(state);
    state.phase = playerId === "player" ? "playerTurn" : "cpuTurn";
    return state;
  }

  resolvePlayedCard(state, playerId, card, "hand", options.fieldChoiceId, true);
  drawUntilNormal(state, playerId, true);
  finalizeHandMatch(state, true);
  commitDeferredCaptures(state);
  afterTurn(state, playerId);
  return state;
}

function drawUntilNormal(state, playerId, deferCaptures = false) {
  while (state.deck.length > 0) {
    const drawn = state.deck.shift();
    recordStep(state, { type: "drawn", playerId, source: "deck", card: drawn, month: drawn.month });
    if (isBonus(drawn)) {
      captureCards(state, playerId, [drawn], { stealPi: true, reason: "더미 보너스", defer: deferCaptures });
      recordStep(state, { type: "event", name: "bonus", playerId });
      continue;
    }
    resolvePlayedCard(state, playerId, drawn, "deck", undefined, deferCaptures);
    break;
  }
}

function resolvePlayedCard(state, playerId, card, source, fieldChoiceId, deferCaptures = false) {
  // When the deck draws the same month as a deferred hand match, all three
  // cards (the field card, the played hand card, the drawn deck card) stay
  // on the field as a real ppeok (stuck pile) instead of resolving as a
  // normal pair capture.
  if (source === "deck" && state.pendingHandMatch && state.pendingHandMatch.month === card.month) {
    const month = card.month;
    const matches = state.field.filter((fieldCard) => fieldCard.month === card.month);
    recordStep(state, { type: "matchCheck", playerId, source, card, month, matches });
    state.field.push(card);
    if (!state.ppeokMonths.includes(month)) state.ppeokMonths.push(month);
    state.ppeokCreators = state.ppeokCreators ?? {};
    state.ppeokCreators[month] = state.pendingHandMatch.playerId;
    state.logs.unshift(`${label(state.pendingHandMatch.playerId)} 뻑`);
    recordStep(state, { type: "event", name: "ppeok", playerId: state.pendingHandMatch.playerId, month });
    state.pendingHandMatch = null;
    return;
  }

  const matches = state.field.filter((fieldCard) => fieldCard.month === card.month);
  recordStep(state, { type: "matchCheck", playerId, source, card, month: card.month, matches });

  if (matches.length === 0) {
    state.field.push(card);
    if (source === "hand") {
      state.turnContext = { ...state.turnContext, noMatchCardId: card.id, month: card.month };
    } else if (source === "deck" && state.turnContext?.handMatchedMonth === card.month) {
      // Deck drew the same month the player just captured from hand — treat
      // this as a 따닥 (3 same-month cards appeared this turn). Card still
      // lands on the field (no pair to capture), but reward the player.
      state.logs.unshift(`${label(playerId)} 따닥`);
      recordStep(state, { type: "event", name: "ttadak", playerId });
      const stolen = stealPi(state, playerId);
      if (stolen) recordStep(state, { type: "stealPi", playerId, cards: [stolen], reason: "따닥 보너스" });
    }
    return;
  }

  if (matches.length === 1) {
    if (source === "hand") {
      // Defer the capture — hand card joins the field next to its match.
      // If the deck then draws the same month it becomes a ppeok stuck pile
      // (handled at the top of this function); otherwise finalizeHandMatch
      // commits the pair capture after drawUntilNormal.
      state.field.push(card);
      state.pendingHandMatch = {
        handCardId: card.id,
        matchedCardId: matches[0].id,
        month: card.month,
        playerId,
      };
      state.turnContext = { ...state.turnContext, handMatchedMonth: card.month };
      return;
    }
    // Deck source: normal pair capture with jjok / ttadak detection.
    state.field = state.field.filter((fieldCard) => fieldCard.id !== matches[0].id);
    const isJjok = state.turnContext?.noMatchCardId === matches[0].id;
    const isTtadak = (state.turnContext?.handMatchCount === 2 && state.turnContext?.month === card.month)
      || (state.turnContext?.handMatchedMonth === card.month);
    captureCards(state, playerId, [card, matches[0]], { stealPi: isJjok || isTtadak, reason: source, defer: deferCaptures });
    if (isJjok) {
      state.logs.unshift(`${label(playerId)} 쪽`);
      recordStep(state, { type: "event", name: "jjok", playerId });
    }
    if (isTtadak) {
      state.logs.unshift(`${label(playerId)} 따닥`);
      recordStep(state, { type: "event", name: "ttadak", playerId });
    }
    return;
  }

  if (matches.length === 2) {
    const chosen = fieldChoiceId
      ? matches.find((fieldCard) => fieldCard.id === fieldChoiceId)
      : chooseBestMatch(matches);
    state.field = state.field.filter((fieldCard) => fieldCard.id !== chosen.id);
    captureCards(state, playerId, [card, chosen], { reason: source, defer: deferCaptures });
    if (source === "hand") {
      state.turnContext = { ...state.turnContext, handMatchCount: 2, month: card.month, handMatchedMonth: card.month };
    }
    return;
  }

  // matches.length >= 3: capture all 4 + steal pi. Clear ppeok mark if present.
  state.field = state.field.filter((fieldCard) => fieldCard.month !== card.month);
  captureCards(state, playerId, [card, ...matches], { stealPi: true, reason: "뻑", defer: deferCaptures });
  const wasPpeok = state.ppeokMonths.includes(card.month);
  state.ppeokMonths = state.ppeokMonths.filter((m) => m !== card.month);
  if (state.ppeokCreators) delete state.ppeokCreators[card.month];
  state.logs.unshift(`${label(playerId)} 뻑${wasPpeok ? "풀기" : ""}`);
  recordStep(state, { type: "event", name: wasPpeok ? "ppeok-clear" : "quad", playerId, month: card.month });
}

function finalizeHandMatch(state, defer = false) {
  if (!state.pendingHandMatch) return;
  const pending = state.pendingHandMatch;
  state.pendingHandMatch = null;
  const handCard = state.field.find((c) => c.id === pending.handCardId);
  const matchedCard = state.field.find((c) => c.id === pending.matchedCardId);
  if (!handCard || !matchedCard) return;
  state.field = state.field.filter(
    (c) => c.id !== pending.handCardId && c.id !== pending.matchedCardId
  );
  captureCards(state, pending.playerId, [handCard, matchedCard], { reason: "hand", defer });
}

function afterTurn(state, playerId) {
  updateScores(state);
  applySweep(state, playerId);
  updateScores(state);

  const player = state.players[playerId];
  if (player.score.total >= state.rules.winningScore) {
    state.phase = playerId === "player" ? "goStopDecision" : "cpuTurn";
    state.pendingGoStop = { playerId };
    return;
  }
  if (isNagari(state)) {
    state.roundOver = true;
    state.phase = "roundEnd";
    state.result = { type: "nagari", winner: null, nextMultiplier: state.nagariMultiplier * 2 };
    state.logs.unshift("나가리");
    return;
  }
  state.turnContext = null;
  beginTurn(state, other(playerId));
}

export function chooseGo(state) {
  const playerId = state.pendingGoStop?.playerId;
  if (!playerId) return state;
  state.players[playerId].goCount += 1;
  state.logs.unshift(`${label(playerId)} 고 ${state.players[playerId].goCount}`);
  state.turnContext = null;
  recordStep(state, { type: "event", name: "go", playerId });
  beginTurn(state, other(playerId));
  return state;
}

export function chooseStop(state) {
  const playerId = state.pendingGoStop?.playerId;
  if (!playerId) return state;
  updateScores(state);
  state.roundOver = true;
  state.winner = playerId;
  state.phase = "roundEnd";
  state.result = { type: "stop", winner: playerId, final: finalScore(state, playerId) };
  state.logs.unshift(`${label(playerId)} 스톱`);
  state.turnContext = null;
  recordStep(state, { type: "event", name: "stop", playerId });
  return state;
}

export function runCpuTurn(state) {
  if (state.roundOver || state.currentTurn !== "cpu") return state;
  const shake = getShakeOptions(state, "cpu")[0];
  if (shake && shouldCpuShake(state, shake.month)) declareShake(state, shake.month);
  else if (state.pendingShake) skipShake(state);

  const bomb = getBombOptions(state, "cpu")[0];
  if (bomb && shouldCpuBomb(state, bomb.month)) {
    playBomb(state, bomb.month);
  } else {
    const card = chooseCpuCard(state);
    if (card) playCard(state, card.id);
  }

  if (state.pendingGoStop?.playerId === "cpu") {
    if (state.players.cpu.score.total >= 10 || state.players.cpu.goCount >= 1) chooseStop(state);
    else chooseGo(state);
  }
  return state;
}

export function updateScores(state) {
  for (const playerId of ["player", "cpu"]) {
    state.players[playerId].score = calculateScore(state.players[playerId].captured, state.rules);
  }
}

function chooseCpuCard(state) {
  const hand = state.players.cpu.hand;
  const scoring = hand
    .map((card) => ({ card, value: evaluatePlay(state, card) }))
    .sort((a, b) => b.value - a.value);
  return scoring[0]?.card ?? null;
}

function evaluatePlay(state, card) {
  if (isBonus(card)) return 100;
  const matches = state.field.filter((fieldCard) => fieldCard.month === card.month);
  return matches.reduce((sum, match) => sum + cardValue(match), cardValue(card)) + matches.length * 5;
}

function shouldCpuShake(state, month) {
  return state.field.some((card) => card.month === month) || state.players.cpu.score.total < 5;
}

function shouldCpuBomb(state, month) {
  return state.field.some((card) => card.month === month);
}

function cardValue(card) {
  if (isBonus(card)) return 20 + card.piValue;
  if (card.types.includes("gwang")) return 12;
  if (card.types.includes("yeol")) return 8;
  if (card.types.includes("tti")) return 6;
  return card.piValue || 1;
}

function captureCards(state, playerId, cards, options = {}) {
  if (options.defer) {
    state.deferredCaptures ??= [];
    state.deferredCaptures.push({ playerId, cards, options: { ...options, defer: false } });
    recordStep(state, { type: "capture", playerId, cards, reason: options.reason, deferred: true });
    return;
  }
  state.players[playerId].captured.push(...cards);
  recordStep(state, { type: "capture", playerId, cards, reason: options.reason });
  if (options.stealPi && state.rules.bonusStealsPi) {
    const stolen = stealPi(state, playerId);
    if (stolen) recordStep(state, { type: "stealPi", playerId, cards: [stolen], reason: "피 가져오기" });
  }
}

function commitDeferredCaptures(state) {
  const captures = state.deferredCaptures ?? [];
  state.deferredCaptures = [];
  for (const capture of captures) {
    captureCards(state, capture.playerId, capture.cards, capture.options);
  }
}

function stealPi(state, playerId) {
  const loser = state.players[other(playerId)];
  const normalPi = loser.captured.find((card) => card.piValue === 1);
  const anyPi = loser.captured.find((card) => card.piValue > 0);
  const card = normalPi ?? anyPi;
  if (!card) return null;
  loser.captured = loser.captured.filter((candidate) => candidate.id !== card.id);
  state.players[playerId].captured.push(card);
  return card;
}

function applySweep(state, playerId) {
  if (!state.rules.enableSweep || state.field.length !== 0) return;
  stealPi(state, playerId);
  state.logs.unshift(`${label(playerId)} 싹쓸이`);
  recordStep(state, { type: "event", name: "sweep", playerId });
}

function isNagari(state) {
  return state.rules.enableNagari && state.deck.length === 0 && state.players.player.hand.length === 0 && state.players.cpu.hand.length === 0;
}

function removeById(cards, id) {
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return null;
  return cards.splice(index, 1)[0];
}

function chooseBestMatch(cards) {
  return [...cards].sort((a, b) => cardValue(b) - cardValue(a))[0];
}

function groupByMonth(cards) {
  const map = new Map();
  for (const card of cards) {
    if (card.month == null) continue;
    if (!map.has(card.month)) map.set(card.month, []);
    map.get(card.month).push(card);
  }
  return map;
}

function isBonus(card) {
  return card.types.includes("bonus");
}

function other(playerId) {
  return playerId === "player" ? "cpu" : "player";
}

function label(playerId) {
  return playerId === "player" ? "플레이어" : "상대";
}

function recordStep(state, step) {
  state.lastActionSteps.push(step);
}
