/**
 * Unit tests — real-world sizes of TP objects (run: npm test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRealSize } from "../src/config/realSizes";

test("dimension written in the TP wins (name, then step text right after the object)", () => {
  assert.deepEqual(
    [resolveRealSize("Tube à essai 16 x 160 mm", 0.1).size_m, resolveRealSize("Tube à essai 16 x 160 mm", 0.1).source],
    [0.16, "tp_text"]
  );
  const r = resolveRealSize("règle graduée", 0.3, ["Mesurer la longueur avec la règle graduée de 20 cm."]);
  assert.equal(r.size_m, 0.2);
  assert.equal(r.source, "tp_text");
  // A distance in the text is not the object's size.
  assert.notEqual(resolveRealSize("coton", 0.2, ["Placer le coton à 2 cm du bord."]).source, "tp_text");
});

test("standardized formats (IEC batteries, ISO A4, glassware with capacity)", () => {
  assert.equal(resolveRealSize("Pile 9 V", 0.1).size_m, 0.0485);
  assert.equal(resolveRealSize("Pile AA 1,5 V", 0.1).size_m, 0.0505);
  assert.equal(resolveRealSize("Pile AAA", 0.1).size_m, 0.0445);
  assert.equal(resolveRealSize("Feuille A4", 0.2).size_m, 0.297);
  const b = resolveRealSize("Bécher 250 mL", 0.2);
  assert.deepEqual([b.size_m, b.source], [0.095, "standard"]);
  assert.equal(resolveRealSize("Erlenmeyer 250 mL", 0.2).size_m, 0.145);
});

test("estimates: kept when plausible, aberrant ones brought into the typical range, unknown models untouched", () => {
  const bulb = resolveRealSize("Ampoule 6 V à culot E10", 0.1);
  assert.deepEqual([bulb.size_m, bulb.source], [0.045, "typical_range"]);
  const meter = resolveRealSize("Multimètre numérique", 0.2);
  assert.deepEqual([meter.size_m, meter.source], [0.2, "estimate"]);
  assert.equal(resolveRealSize("marqueur", 0.1).size_m, 0.12);
  const unknown = resolveRealSize("graines de haricot", 0.1);
  assert.deepEqual([unknown.size_m, unknown.source], [0.1, "estimate"]);
  assert.equal(resolveRealSize("objet inconnu", 0.001).size_m, 0.01);
});
