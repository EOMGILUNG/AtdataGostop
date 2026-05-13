import assert from "node:assert/strict";
import { ALL_CARDS, createDeck } from "../src/data/cards.js";
import {
  calculateScore,
  chooseStop,
  confirmChongtong,
  createGame,
  declareShake,
  finalScore,
  getBombOptions,
  getShakeOptions,
  playBomb,
  playCard,
} from "../src/engine/game.js";

const byId = Object.fromEntries(createDeck().map((card) => [card.id, card]));

function c(id) {
  const card = byId[id];
  return { ...card, types: [...card.types], tags: [...card.tags] };
}

function padDeck(cards) {
  const used = new Set(cards.map((card) => card.id));
  return [...cards, ...createDeck().filter((card) => !used.has(card.id))];
}

test("deck has 48 base cards and 3 bonus cards", () => {
  assert.equal(ALL_CARDS.length, 51);
  assert.equal(ALL_CARDS.filter((card) => card.types.includes("bonus")).length, 3);
});

test("scoring handles rain gwang, sake cup, ssangpi, and bonus pi", () => {
  const score = calculateScore([c("01"), c("09"), c("45"), c("35"), c("43"), c("46"), c("B03")]);
  assert.equal(score.gwang, 2);
  assert.equal(score.piCount, 9);
  assert.equal(score.yeolCount, 1);
});

test("starting bonus moves to starter and field refills", () => {
  const deck = padDeck([
    c("01"), c("02"), c("03"), c("04"), c("05"), c("06"), c("07"), c("08"), c("09"), c("10"),
    c("11"), c("12"), c("13"), c("14"), c("15"), c("16"), c("17"), c("18"), c("19"), c("20"),
    c("B01"), c("21"), c("22"), c("23"), c("24"), c("25"), c("26"), c("27"),
  ]);
  const state = createGame({ deck, shuffle: false, rules: { enableChongtong: false } });
  assert.equal(state.field.length, 8);
  assert.equal(state.players.player.captured.some((card) => card.id === "B01"), true);
});

test("chongtong is detected before normal play", () => {
  const deck = padDeck([
    c("01"), c("02"), c("03"), c("04"), c("05"), c("06"), c("07"), c("08"), c("09"), c("10"),
  ]);
  const state = createGame({ deck, shuffle: false });
  assert.equal(state.phase, "chongtongDecision");
  assert.equal(state.result.winner, "player");
  confirmChongtong(state);
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.result.final.total, 10);
});

test("shake records multiplier state", () => {
  const state = createGame({
    deck: padDeck([
      c("01"), c("02"), c("03"), c("05"), c("06"), c("07"), c("08"), c("09"), c("10"), c("11"),
    ]),
    shuffle: false,
    rules: { enableChongtong: false },
  });
  const options = getShakeOptions(state, "player");
  assert.equal(options.some((option) => option.month === 1), true);
  declareShake(state, 1);
  assert.equal(state.players.player.shakeCount, 1);
  assert.deepEqual(state.players.player.shakenMonths, [1]);
});

test("bomb captures three hand cards, matching field, and refills two cards", () => {
  const state = createGame({
    deck: padDeck([
      c("01"), c("02"), c("03"), c("05"), c("06"), c("07"), c("08"), c("09"), c("10"), c("11"),
      c("12"), c("13"), c("14"), c("15"), c("16"), c("17"), c("18"), c("19"), c("20"), c("21"),
      c("04"), c("22"), c("23"), c("24"), c("25"), c("26"), c("27"), c("28"),
      c("29"), c("30"),
    ]),
    shuffle: false,
    rules: { enableChongtong: false, enableShake: false },
  });
  assert.equal(getBombOptions(state, "player").some((option) => option.month === 1), true);
  playBomb(state, 1);
  assert.equal(state.players.player.captured.filter((card) => card.month === 1).length, 4);
  assert.equal(state.players.player.hand.length, 9);
});

test("bonus card play captures bonus, steals pi, and refills hand", () => {
  const state = createGame({ rules: { enableChongtong: false } });
  state.currentTurn = "player";
  state.phase = "playerTurn";
  state.deck = [c("01"), c("02")];
  state.field = [];
  state.players.player.hand = [c("B02")];
  state.players.player.captured = [];
  state.players.cpu.captured = [c("05")];
  playCard(state, "B02");
  assert.equal(state.players.player.captured.some((card) => card.id === "B02"), true);
  assert.equal(state.players.player.captured.some((card) => card.id === "05"), true);
  assert.equal(state.players.player.hand.length, 1);
});

test("jjok steals one opponent pi", () => {
  const state = createGame({ rules: { enableChongtong: false } });
  state.currentTurn = "player";
  state.phase = "playerTurn";
  state.players.player.hand = [c("01")];
  state.players.player.captured = [];
  state.players.cpu.captured = [c("05")];
  state.field = [];
  state.deck = [c("02")];
  playCard(state, "01");
  assert.equal(state.players.player.captured.some((card) => card.id === "05"), true);
  assert.equal(state.logs.some((log) => log.includes("쪽")), true);
});

test("ppeok-style three field match steals one opponent pi", () => {
  const state = createGame({ rules: { enableChongtong: false } });
  state.currentTurn = "player";
  state.phase = "playerTurn";
  state.players.player.hand = [c("04")];
  state.players.player.captured = [];
  state.players.cpu.captured = [c("05")];
  state.field = [c("01"), c("02"), c("03")];
  state.deck = [];
  playCard(state, "04");
  assert.equal(state.players.player.captured.filter((card) => card.month === 1).length, 4);
  assert.equal(state.players.player.captured.some((card) => card.id === "05"), true);
  assert.equal(state.logs.some((log) => log.includes("뻑")), true);
});

test("final score applies shake and pi bak multipliers", () => {
  const state = createGame({ rules: { enableChongtong: false } });
  state.players.player.captured = [c("B01"), c("B02"), c("B03"), c("35"), c("43")];
  state.players.cpu.captured = [];
  state.players.player.shakeCount = 1;
  state.nagariMultiplier = 1;
  for (const id of ["01", "09", "29"]) state.players.player.captured.push(c(id));
  state.players.player.score = calculateScore(state.players.player.captured, state.rules);
  state.players.cpu.score = calculateScore(state.players.cpu.captured, state.rules);
  const result = finalScore(state, "player");
  assert.equal(result.multiplier >= 4, true);
});

test("stop ends round with final score", () => {
  const state = createGame({ rules: { enableChongtong: false } });
  state.players.player.captured = [c("01"), c("09"), c("29"), c("B01"), c("B02"), c("B03"), c("35"), c("43")];
  state.players.player.score = calculateScore(state.players.player.captured, state.rules);
  state.pendingGoStop = { playerId: "player" };
  chooseStop(state);
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.winner, "player");
});

test("hand captures are committed after deck card is revealed", () => {
  const state = createGame({ rules: { enableChongtong: false } });
  state.currentTurn = "player";
  state.phase = "playerTurn";
  state.players.player.hand = [c("29")];
  state.players.player.captured = [];
  state.players.cpu.captured = [];
  state.field = [c("32"), c("01")];
  state.deck = [c("02")];
  playCard(state, "29");
  const captureSteps = state.lastActionSteps.filter((step) => step.type === "capture");
  const drawnIndex = state.lastActionSteps.findIndex((step) => step.type === "drawn" && step.card.id === "02");
  const deferredCaptureIndex = state.lastActionSteps.findIndex((step) => step.type === "capture" && step.deferred);
  const committedCaptureIndex = state.lastActionSteps.findIndex((step, index) => index > drawnIndex && step.type === "capture" && !step.deferred);
  assert.equal(captureSteps.length >= 2, true);
  assert.equal(deferredCaptureIndex > -1, true);
  assert.equal(drawnIndex > -1, true);
  assert.equal(committedCaptureIndex > drawnIndex, true);
  assert.equal(state.players.player.captured.some((card) => card.id === "29"), true);
  assert.equal(state.players.player.captured.some((card) => card.id === "32"), true);
});

test("simulates complete rounds without losing card render data", () => {
  for (let round = 0; round < 20; round += 1) {
    const state = createGame({ rules: { enableChongtong: false } });
    let guard = 0;
    while (!state.roundOver && guard < 80) {
      guard += 1;
      if (state.pendingGoStop?.playerId) {
        chooseStop(state);
        break;
      }
      if (state.phase === "shakeDecision") {
        state.pendingShake = null;
        state.phase = "playerTurn";
      }
      const player = state.players[state.currentTurn];
      const card = player.hand[0];
      if (!card) break;
      playCard(state, card.id);
      for (const zone of [state.field, state.deck, state.players.player.hand, state.players.cpu.hand, state.players.player.captured, state.players.cpu.captured]) {
        for (const zoneCard of zone) {
          if (!zoneCard.types.includes("bonus")) assert.ok(zoneCard.image, `missing image: ${zoneCard.id}`);
        }
      }
    }
    assert.ok(state.roundOver || guard < 80, "round should finish or remain bounded");
  }
});

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
