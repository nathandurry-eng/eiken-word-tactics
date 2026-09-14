import test from "node:test";
import assert from "node:assert/strict";
import { chooseMission } from "../dist/mission-engine.js";

const word = { id: "a", partOfSpeech: "adverb" };

test("mission selection uses a reviewed fallback when tags do not match", () => {
  const missions = [
    { id: "persuade-1", prompt: "Persuade.", modes: ["standard"], compatibility: ["noun"] },
    { id: "example-1", prompt: "Give an example.", modes: ["standard"], compatibility: ["any"] }
  ];
  assert.equal(chooseMission(missions, word, { mode: "standard", level: "EIKEN 3", random: () => 0 }).id, "example-1");
});

test("Pre-1 demands preparation and about sixty seconds", () => {
  const mission = chooseMission([{ id: "story-1", prompt: "Tell a story.", modes: ["challenge"], compatibility: ["any"] }], word, { mode: "challenge", level: "EIKEN Pre-1", random: () => 0 });
  assert.equal(mission.preparationSeconds, 20);
  assert.match(mission.prompt, /about 60 seconds/);
});
