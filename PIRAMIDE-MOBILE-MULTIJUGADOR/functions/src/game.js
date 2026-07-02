"use strict";

const crypto = require("node:crypto");

const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = [
  { suit: "hearts", symbol: "♥", color: "red" },
  { suit: "diamonds", symbol: "♦", color: "red" },
  { suit: "clubs", symbol: "♣", color: "black" },
  { suit: "spades", symbol: "♠", color: "black" }
];
const REVEAL_ORDER = [10, 11, 12, 13, 14, 6, 7, 8, 9, 3, 4, 5, 1, 2, 0];
const VALID_VISIBILITY = new Set(["private", "public"]);
const DEFAULT_SETTINGS = Object.freeze({
  mode: "classic",
  cardsPerPlayer: 4,
  handVisibility: "public",
  bluffEnabled: false,
  powersEnabled: false,
  floorMultipliers: [1, 2, 4, 8, 16]
});

function gameError(message, code = "invalid-argument") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSettings(input = {}, previous = DEFAULT_SETTINGS) {
  const next = {
    ...DEFAULT_SETTINGS,
    ...previous,
    ...input
  };

  if (!VALID_VISIBILITY.has(next.handVisibility)) {
    throw gameError("La visibilidad debe ser private o public.");
  }
  if (!Number.isInteger(next.cardsPerPlayer) || next.cardsPerPlayer < 3 || next.cardsPerPlayer > 6) {
    throw gameError("Las cartas por jugador deben estar entre 3 y 6.");
  }
  if (typeof next.bluffEnabled !== "boolean" || typeof next.powersEnabled !== "boolean") {
    throw gameError("La configuración de bluff y poderes debe ser booleana.");
  }
  if (!Array.isArray(next.floorMultipliers) || next.floorMultipliers.length !== 5 ||
      next.floorMultipliers.some(value => !Number.isInteger(value) || value < 1 || value > 99)) {
    throw gameError("Los multiplicadores deben contener cinco enteros entre 1 y 99.");
  }

  next.mode = "classic";
  if (next.handVisibility === "public") next.bluffEnabled = false;
  return next;
}

function assertStartSettings(settings) {
  if (settings.handVisibility === "public" && settings.bluffEnabled === true) {
    throw gameError("El bluff no puede activarse con las cartas visibles.", "failed-precondition");
  }
}

function secureIndex(max) {
  return crypto.randomInt(0, max);
}

function shuffle(items, pickIndex = secureIndex) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const picked = pickIndex(index + 1);
    [copy[index], copy[picked]] = [copy[picked], copy[index]];
  }
  return copy;
}

function buildDeck(requiredCards, pickIndex = secureIndex) {
  const decksNeeded = Math.max(1, Math.ceil(requiredCards / 52));
  const cards = [];
  for (let deckNumber = 0; deckNumber < decksNeeded; deckNumber += 1) {
    for (const value of VALUES) {
      for (const suit of SUITS) {
        cards.push({
          id: `d${deckNumber}-${value}-${suit.suit}`,
          value,
          suit: suit.suit,
          symbol: suit.symbol,
          color: suit.color,
          used: false
        });
      }
    }
  }
  return shuffle(cards, pickIndex);
}

function toCardMap(cards) {
  return Object.fromEntries(cards.map(card => [card.id, card]));
}

function dealGame(playerUids, settings, pickIndex = secureIndex) {
  const required = 15 + playerUids.length * settings.cardsPerPlayer;
  const deck = buildDeck(required, pickIndex);
  const pyramidCards = deck.splice(0, 15).map((card, position) => ({
    ...card,
    position,
    revealed: false
  }));
  const hands = {};
  for (const uid of playerUids) {
    hands[uid] = toCardMap(deck.splice(0, settings.cardsPerPlayer));
  }

  return {
    hands,
    game: {
      round: 1,
      pyramidCards,
      revealOrder: REVEAL_ORDER,
      pyramidIndex: 0,
      currentFloor: 1,
      currentCard: null,
      highlightedValue: null,
      activeClaim: null,
      declaredThisCard: {},
      lastResult: null,
      startedAt: Date.now()
    }
  };
}

function floorForRevealIndex(index) {
  if (index < 5) return 1;
  if (index < 9) return 2;
  if (index < 12) return 3;
  if (index < 14) return 4;
  return 5;
}

function availableCards(hand = {}) {
  return Object.values(hand).filter(card => !card.used);
}

function findMatchingCard(hand = {}, value) {
  return availableCards(hand).find(card => card.value === value) || null;
}

function resolveClaimOutcome({ truthful, decision, multiplier }) {
  if (!["accept", "challenge"].includes(decision)) {
    throw gameError("La decisión debe ser accept o challenge.");
  }
  if (decision === "accept") {
    return {
      title: truthful ? "Carga aceptada" : "Bluff aceptado",
      claimantLoad: 0,
      targetLoad: multiplier,
      consumeCard: truthful,
      revealTruth: false
    };
  }
  if (truthful) {
    return {
      title: "La coincidencia era real",
      claimantLoad: 0,
      targetLoad: multiplier * 2,
      consumeCard: true,
      revealTruth: true
    };
  }
  return {
    title: "Bluff descubierto",
    claimantLoad: multiplier,
    targetLoad: 0,
    consumeCard: false,
    revealTruth: true
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  REVEAL_ORDER,
  normalizeSettings,
  assertStartSettings,
  shuffle,
  buildDeck,
  dealGame,
  floorForRevealIndex,
  availableCards,
  findMatchingCard,
  resolveClaimOutcome
};
