// Relative path so the game works whether it's served from the site root
// (e.g. localhost:4174/) or from a sub-path (e.g. GitHub Pages
// /GoStop_Game/). The HTML lives at the project root, so the cards/ folder
// is reachable as "cards/...".
export const CARD_BACK = "cards/back.png";

const monthNames = {
  1: "송학",
  2: "매조",
  3: "벚꽃",
  4: "흑싸리",
  5: "난초",
  6: "모란",
  7: "홍싸리",
  8: "공산",
  9: "국화",
  10: "단풍",
  11: "오동",
  12: "비",
};

const rawCards = [
  ["01", 1, "송학 광", ["gwang"], 0, []],
  ["02", 1, "송학 피 1", ["pi"], 1, []],
  ["03", 1, "송학 피 2", ["pi"], 1, []],
  ["04", 1, "송학 홍단", ["tti"], 0, ["hongdan"]],
  ["05", 2, "매조 피 1", ["pi"], 1, []],
  ["06", 2, "매조 피 2", ["pi"], 1, []],
  ["07", 2, "매조 열끗", ["yeol"], 0, ["godori"]],
  ["08", 2, "매조 홍단", ["tti"], 0, ["hongdan"]],
  ["09", 3, "벚꽃 광", ["gwang"], 0, []],
  ["10", 3, "벚꽃 피 1", ["pi"], 1, []],
  ["11", 3, "벚꽃 피 2", ["pi"], 1, []],
  ["12", 3, "벚꽃 홍단", ["tti"], 0, ["hongdan"]],
  ["13", 4, "흑싸리 피 1", ["pi"], 1, []],
  ["14", 4, "흑싸리 피 2", ["pi"], 1, []],
  ["15", 4, "흑싸리 열끗", ["yeol"], 0, ["godori"]],
  ["16", 4, "흑싸리 초단", ["tti"], 0, ["chodan"]],
  ["17", 5, "난초 피 1", ["pi"], 1, []],
  ["18", 5, "난초 피 2", ["pi"], 1, []],
  ["19", 5, "난초 열끗", ["yeol"], 0, []],
  ["20", 5, "난초 초단", ["tti"], 0, ["chodan"]],
  ["21", 6, "모란 피 1", ["pi"], 1, []],
  ["22", 6, "모란 피 2", ["pi"], 1, []],
  ["23", 6, "모란 열끗", ["yeol"], 0, []],
  ["24", 6, "모란 청단", ["tti"], 0, ["cheongdan"]],
  ["25", 7, "홍싸리 피 1", ["pi"], 1, []],
  ["26", 7, "홍싸리 피 2", ["pi"], 1, []],
  ["27", 7, "홍싸리 열끗", ["yeol"], 0, []],
  ["28", 7, "홍싸리 초단", ["tti"], 0, ["chodan"]],
  ["29", 8, "공산 광", ["gwang"], 0, []],
  ["30", 8, "공산 피 1", ["pi"], 1, []],
  ["31", 8, "공산 피 2", ["pi"], 1, []],
  ["32", 8, "공산 열끗", ["yeol"], 0, ["godori"]],
  ["33", 9, "국화 피 1", ["pi"], 1, []],
  ["34", 9, "국화 피 2", ["pi"], 1, []],
  ["35", 9, "국화 술잔", ["yeol", "ssangpi"], 2, ["sakeCup"]],
  ["36", 9, "국화 청단", ["tti"], 0, ["cheongdan"]],
  ["37", 10, "단풍 피 1", ["pi"], 1, []],
  ["38", 10, "단풍 피 2", ["pi"], 1, []],
  ["39", 10, "단풍 열끗", ["yeol"], 0, []],
  ["40", 10, "단풍 청단", ["tti"], 0, ["cheongdan"]],
  ["41", 11, "오동 광", ["gwang"], 0, []],
  ["42", 11, "오동 피 1", ["pi"], 1, []],
  ["43", 11, "오동 쌍피", ["ssangpi"], 2, []],
  ["44", 11, "오동 피 2", ["pi"], 1, []],
  ["45", 12, "비광", ["gwang"], 0, ["rainGwang"]],
  ["46", 12, "비 쌍피", ["ssangpi"], 2, []],
  ["47", 12, "비 열끗", ["yeol"], 0, []],
  ["48", 12, "비 띠", ["tti"], 0, []],
];

export const BASE_CARDS = rawCards.map(([id, month, name, types, piValue, tags]) => ({
  id,
  month,
  monthName: monthNames[month],
  name,
  types,
  piValue,
  tags,
  image: `cards/${id}.png`,
}));

export const BONUS_CARDS = [
  { id: "B01", month: null, monthName: "보너스", name: "보너스 2피", types: ["bonus"], piValue: 2, tags: ["bonus-pi"] },
  { id: "B02", month: null, monthName: "보너스", name: "보너스 2피", types: ["bonus"], piValue: 2, tags: ["bonus-pi"] },
  { id: "B03", month: null, monthName: "보너스", name: "보너스 3피", types: ["bonus"], piValue: 3, tags: ["bonus-pi"] },
];

export const ALL_CARDS = [...BASE_CARDS, ...BONUS_CARDS];

export function cloneCard(card) {
  return { ...card, types: [...card.types], tags: [...card.tags] };
}

export function createDeck() {
  return ALL_CARDS.map(cloneCard);
}
