"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  assertStartSettings,
  dealGame,
  findMatchingCard,
  resolveClaimOutcome
} = require("../src/game");

test("la modalidad pública desactiva el bluff", () => {
  const settings = normalizeSettings({ handVisibility: "public", bluffEnabled: true });
  assert.equal(settings.handVisibility, "public");
  assert.equal(settings.bluffEnabled, false);
});

test("la validación del servidor rechaza público con bluff", () => {
  assert.throws(
    () => assertStartSettings({ ...DEFAULT_SETTINGS, handVisibility: "public", bluffEnabled: true }),
    /bluff no puede activarse/
  );
});

test("el reparto crea manos completas y separadas", () => {
  const settings = normalizeSettings({ cardsPerPlayer: 4 });
  const dealt = dealGame(["host", "guest", "third"], settings, () => 0);
  assert.equal(Object.keys(dealt.hands).length, 3);
  assert.equal(Object.keys(dealt.hands.host).length, 4);
  assert.equal(dealt.game.pyramidCards.length, 15);
});

test("una carta usada no vuelve a ser coincidencia", () => {
  const hand = {
    one: { id: "one", value: "7", used: true },
    two: { id: "two", value: "Q", used: false }
  };
  assert.equal(findMatchingCard(hand, "7"), null);
  assert.equal(findMatchingCard(hand, "Q").id, "two");
});

test("desafiar una coincidencia real duplica la carga", () => {
  const outcome = resolveClaimOutcome({ truthful: true, decision: "challenge", multiplier: 4 });
  assert.equal(outcome.targetLoad, 8);
  assert.equal(outcome.consumeCard, true);
  assert.equal(outcome.revealTruth, true);
});

test("desafiar un bluff carga al declarante", () => {
  const outcome = resolveClaimOutcome({ truthful: false, decision: "challenge", multiplier: 4 });
  assert.equal(outcome.claimantLoad, 4);
  assert.equal(outcome.consumeCard, false);
});
