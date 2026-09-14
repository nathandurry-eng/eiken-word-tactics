import test from "node:test";
import assert from "node:assert/strict";
import { TurnTimer } from "../dist/timer-engine.js";

test("timer derives remaining time from a deadline and keeps one source", () => {
  let now = 1_000;
  const timer = new TurnTimer(() => {}, () => {}, () => now);
  const first = { duration: 30, remaining: 30, running: false, deadline: null };
  timer.attach(first);
  timer.start();
  now = 11_200;
  timer.tick();
  assert.equal(first.remaining, 20);
  const second = { duration: 15, remaining: 15, running: false, deadline: null };
  timer.attach(second);
  assert.equal(first.running, false);
  assert.equal(timer.interval, null);
  timer.destroy();
});

test("timer add and restore remain paused", () => {
  const timer = new TurnTimer(() => {}, () => {});
  const state = { duration: 20, remaining: 7, running: false, deadline: null };
  timer.attach(state);
  timer.add(30);
  assert.deepEqual(state, { duration: 50, remaining: 37, running: false, deadline: null });
});
