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
  assert.match(mission.listenerRole, /follow-up/);
});

test("level routes scale preparation and speaking demand", () => {
  const source = [{ id: "example-1", category: "REAL EXAMPLE", prompt: "Give an example.", modes: ["supported", "standard"], compatibility: ["any"] }];
  const grade3 = chooseMission(source, word, { mode: "supported", level: "EIKEN 3", random: () => 0 });
  const pre2 = chooseMission(source, word, { mode: "standard", level: "EIKEN Pre-2", random: () => 0 });
  const grade2 = chooseMission(source, word, { mode: "standard", level: "EIKEN 2", random: () => 0 });
  assert.equal(grade3.preparationSeconds, 10);
  assert.equal(pre2.preparationSeconds, 15);
  assert.match(pre2.prompt, /two or three connected/);
  assert.match(grade2.prompt, /clear view or comparison/);
});
