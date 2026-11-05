/**
 * Unit tests — TP domain decided by the document; 3D model relevance (real Sketchfab hits seen in generated TPs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDomain } from "../src/services/pipeline";
import { isRelevant } from "../src/services/sketchfab";

test("domain: the document wins over the menu choice; the choice only fills an unknown domain", () => {
  // Electricity PDF imported with "Biologie" chosen in the menu (the reported bug).
  const r = resolveDomain("electrical", "biological");
  assert.equal(r.domain, "electrical");
  assert.match(r.warning ?? "", /TP de électricité.*Biologie|biologie/);
  assert.deepEqual(resolveDomain("biological", "biological"), { domain: "biological", warning: null });
  assert.deepEqual(resolveDomain("biological", undefined), { domain: "biological", warning: null });
  assert.equal(resolveDomain("other", "chemical").domain, "chemical");
});

const model = (name: string, tags: string[] = []) => ({ name, tags });

test("relevance: wrong models seen in generated TPs are rejected", () => {
  assert.equal(isRelevant("bean seeds", model("Jelly Bean Kidneys", ["bean", "jelly"])), false);
  assert.equal(isRelevant("alligator clip", model("Cavalry soldier toy", ["toy"])), false);
  assert.equal(isRelevant("crocodile clip toy", model("Cavalry soldier toy")), false, "one shared word is not enough");
  assert.equal(isRelevant("light bulb E10", model("Arc Lamp - Victorian Street Lamp", ["lamp", "light"])), false);
  assert.equal(isRelevant("pouring container", model("Small Alien Plant Bed", ["container"])), false);
  assert.equal(isRelevant("adhesive labels", model("Classic wine bottle with label", ["label"])), false);
  assert.equal(isRelevant("label", model("Classic wine bottle with label")), false, "one word of a title about a bottle");
  assert.equal(isRelevant("seed", model("SEED Sample Holder Assembly (VFinal)")), false);
  assert.equal(isRelevant("seed samples", model("SEED Sample Holder Assembly (VFinal)")), false, "head noun 'assembly' not asked");
  assert.equal(isRelevant("pouring bottle", model("Alchemist's bottle")), false);
});

test("relevance: right models are kept (name match, plurals, tags as a complement)", () => {
  assert.equal(isRelevant("9V battery", model("9V Battery")), true);
  assert.equal(isRelevant("digital multimeter", model("Digital Multimeter Model Free to use.")), true);
  assert.equal(isRelevant("plastic cups", model("Simple plastic cups")), true);
  assert.equal(isRelevant("paper towel roll", model("Paper Towel Roll")), true);
  assert.equal(isRelevant("bean seeds", model("Bean Seeds", ["seed"])), true);
  assert.equal(isRelevant("ruler", model("Metal Ruler")), true);
  assert.equal(isRelevant("incandescent light bulb", model("Incandescent Light Bulb")), true);
  assert.equal(isRelevant("permanent marker", model("Capped Permanent Marker Pens")), true);
  assert.equal(isRelevant("water bottle", model("Plastic Water Bottle")), true);
  assert.equal(isRelevant("marker pen", model("Marker - 6MB -")), true);
  assert.equal(isRelevant("ruler", model("Photo scales & rulers (low poly)")), true);
  assert.equal(isRelevant("ruler", model("Metal Ruler")), true);
});
