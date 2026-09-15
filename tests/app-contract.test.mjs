import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("release surfaces share a version and retain the audited classroom defaults", async () => {
  const [packageText, html, app, serviceWorker] = await Promise.all([
    read("package.json"), read("dist/index.html"), read("dist/app.js"), read("dist/sw.js")
  ]);
  const version = JSON.parse(packageText).version;

  assert.match(html, new RegExp(`v${version.replaceAll(".", "\\.")}`));
  assert.ok(app.includes(`APP_VERSION = "${version}"`));
  assert.ok(serviceWorker.includes(`VERSION = "v${version}"`));
  assert.ok(app.includes('recent.endType : "rounds"'));
  assert.ok(app.includes('endType === "rounds" ? 2 : 10'));
  assert.ok(app.includes('timers: { supported: 30, standard: 30, challenge: 30 }'));
  assert.ok(app.includes('"EIKEN Pre-2": 40'));
  assert.ok(app.includes('"EIKEN 2": 45'));
  assert.ok(app.includes('"EIKEN Pre-1": 60'));
  assert.ok(app.includes('wordBankCount: 0'));
  assert.ok(app.includes('function bankCount() { return session.settings.wordBankCount || modeMeta[session.config.mode].bank; }'));
  assert.ok(!app.includes("sort(() => Math.random() - 0.5)"));
});

test("audited source vocabulary remains byte-identical", async () => {
  const source = await readFile(new URL("../dist/data/vocabulary.json", import.meta.url));
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "9b1437e3815010691f5c57c29bcd6ae9398a438d43fc22b9ed10cf8995614712"
  );
});
