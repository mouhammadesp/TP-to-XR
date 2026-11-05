/**
 * LLM prompts (Llama 3.3 70B via Together AI).
 *
 * Placeholders use the {NAME} syntax and are filled with `fillPrompt()`,
 * never with String.replace(string, string): TP text may legitimately
 * contain "$&" or "$1", which replace() would interpret as patterns.
 */

/** Fills every {KEY} placeholder of a prompt template. Unknown keys throw. */
export function fillPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Z_]+)\}/g, (match, key: string) => {
    if (!(key in vars)) throw new Error(`Missing prompt variable: ${key}`);
    return vars[key];
  });
}

/** Shared system message: enforces JSON-only answers. */
export const SYSTEM_JSON_ONLY =
  "You are a precise assistant that answers with a single valid JSON object and nothing else: no markdown fences, no comments, no explanation.";

/**
 * PROMPT #1: Parse TP document → structured JSON
 * Purpose: extract materials, steps and safety rules from a lab assignment.
 * Variables: {TP_TEXT}
 */
export const PROMPT_TP_PARSER = `You are a technical document analyzer specializing in laboratory procedures (TPs, "travaux pratiques").

Your task: extract structured data from this lab assignment document.

DOCUMENT TEXT:
"""
{TP_TEXT}
"""

RULES:
1. Return ONLY valid JSON, no markdown, no explanation.
2. Keep names, actions and warnings in the SAME LANGUAGE as the document.
3. "domain" must be exactly one of: mechanical, electrical, chemical, biological, other.
4. Each material needs: name (string), quantity (number), unit (string: pieces, grams, liters, meters, ...).
5. Only list materials and tools actually mentioned in the document. Never invent items.
6. Each step needs: order (number, starting at 1), action (the instruction of the step COPIED VERBATIM from the document: keep its exact words, verbs and objects — never summarize, shorten or rephrase it; only drop the step number, its title and its duration), duration_sec (number; estimate realistically if not stated), key_points (array of strings), safety (string or null).
7. safety_warnings: specific, actionable warnings (from the document, plus obvious ones for the domain).
8. duration_minutes: total duration stated in the document, otherwise the sum of step durations rounded up.

Return this JSON structure:
{
  "title": "string",
  "domain": "mechanical | electrical | chemical | biological | other",
  "duration_minutes": number,
  "materials": [ { "name": "string", "quantity": number, "unit": "string" } ],
  "tools": ["string"],
  "steps": [
    { "order": number, "action": "string", "duration_sec": number, "key_points": ["string"], "safety": "string or null" }
  ],
  "safety_warnings": ["string"]
}

NOW PARSE THE DOCUMENT AND RETURN JSON ONLY.`;

/**
 * PROMPT #2: Generate Sketchfab search queries
 * Purpose: turn TP materials/tools into 3D asset search queries.
 * Variables: {MATERIALS_JSON}
 */
export const PROMPT_ASSET_SEARCH = `You are a 3D asset search specialist for Sketchfab.

Your task: given materials and tools from a lab procedure (TP), generate precise search queries to find realistic, downloadable, CC-licensed 3D models.

TP CONTEXT: a {TP_DOMAIN} laboratory session — "{TP_TITLE}".
Every object belongs to THIS lab context: search for the real lab object or material of this field
(e.g. in biology "graines de haricot" → "bean seeds", not "jelly bean"; "pinces crocodiles" → "alligator clip test lead", not a toy).
Never a toy, character, food item, vehicle or decoration.

TP MATERIALS:
{MATERIALS_JSON}

RULES:
1. For each material, generate exactly 3 alternative search queries, from most specific to most generic.
2. Queries MUST be in ENGLISH (Sketchfab content is mostly English), even if material names are in French.
3. Keep queries short (1-4 words); Sketchfab search is keyword-based.
4. Prefer terms that return realistic objects (avoid "cartoon", "low poly game asset").
5. Use the material name EXACTLY as given as the JSON key.

Example: "roulement à billes" → ["ball bearing", "deep groove bearing", "mechanical bearing"]

Return JSON structure (ONLY JSON):
{
  "queries": {
    "<material name as given>": ["query1", "query2", "query3"]
  }
}

NOW GENERATE SEARCH QUERIES. RETURN JSON ONLY.`;

/**
 * PROMPT #3: Placement agent
 * Purpose: choose a zone (and slot) for every asset; the server then validates
 * capacity and computes absolute coordinates from the workshop layout.
 * Variables: {WORKSHOP_ZONES} {ASSETS_LIST} {DOMAIN} {TP_STEPS}
 */
export const PROMPT_PLACEMENT_AGENT = `You are a VR scene designer for educational lab environments.

Your task: place 3D assets in a fixed virtual workshop to support learning.

WORKSHOP ZONES (meters, Y up; "position" is the center of each zone volume):
{WORKSHOP_ZONES}

TP ASSETS (objects to place):
{ASSETS_LIST}

TP DOMAIN:
{DOMAIN}

TP STEPS (for context):
{TP_STEPS}

TP SAFETY WARNINGS (from the document):
{TP_SAFETY}

PLACEMENT CONSTRAINTS:

1. SAFETY:
   - Hazardous objects must stay visible.
   - Small sharp tools on shelves, not on the workbench where the student stands.
   - Large heavy objects on the floor (zone_floor).

2. ACCESSIBILITY:
   - Primary objects (manipulated in the steps) on the workbench.
   - Reference items and secondary tools on shelves.

3. PEDAGOGY:
   - Objects used in early steps go on the workbench and the upper shelf slots.
   - Group related parts together. Main object at the workbench center, secondary around it.

4. PHYSICS / SIZE:
   - target_size_m = realistic largest dimension of the real object in meters (e.g. screwdriver 0.2, motor 0.4, workbench vise 0.3, gas cylinder 1.2).
   - Objects > 1 kg: floor or workbench. Objects < 0.5 kg: shelves are fine.

5. DOMAIN-SPECIFIC STYLE:
   - mechanical: gray/metallic (#808080), bright white light.
   - electrical: blue (#0064C8), bright white high-contrast light.
   - chemical: green/yellow safety colors.
   - biological / other: neutral white, clear light, warnings adapted to the steps.
   - Write warnings in the same language as the TP steps.

6. ZONE CAPACITY (hard limits):
   - zone_workbench: max 5 objects.
   - zone_shelf_left / zone_shelf_right: exactly 1 object per slot (slot 0 = top, 1 = middle, 2 = bottom).
   - zone_floor: max 3 objects.

OUTPUT FIELDS:
- Every asset of the list must appear exactly once, using its "id" as "asset_id".
- "zone": one of the zone ids above.
- "slot": integer slot index for shelf zones, null otherwise.
- "offset": position on the zone surface RELATIVE to the zone center, in meters (x along the width, z along the depth). Keep objects inside the zone and apart from each other. Use {"x":0,"z":0} for shelf slots.
- "rotation_y": rotation around the vertical axis in radians (0 = default orientation).
- "color_override": "#RRGGBB" or null (prefer null unless the color matters pedagogically).
- "safety_warnings": the 2 MOST IMPORTANT warnings of THIS TP (from "TP SAFETY WARNINGS" and the steps' safety notes),
  each rewritten as a short sign text (max 40 characters, imperative), keeping the exact meaning of the TP warning.
  NEVER invent a warning that is not in the TP. If the TP has none, return an empty list.

Return JSON structure (ONLY JSON):
{
  "placements": [
    {
      "asset_id": "string",
      "zone": "zone_workbench | zone_shelf_left | zone_shelf_right | zone_floor",
      "slot": number or null,
      "offset": { "x": number, "z": number },
      "rotation_y": number,
      "target_size_m": number,
      "color_override": "#RRGGBB or null"
    }
  ],
  "color_scheme": { "ambient": "#RRGGBB", "key_light": "#RRGGBB", "material_base": "#RRGGBB" },
  "safety_warnings": ["string", "string"],
  "reasoning": "string (2-3 sentences explaining the layout)"
}

Example output:
{
  "placements": [
    { "asset_id": "motor_001", "zone": "zone_workbench", "slot": null, "offset": {"x": 0, "z": 0}, "rotation_y": 0, "target_size_m": 0.4, "color_override": null },
    { "asset_id": "wrench_001", "zone": "zone_shelf_left", "slot": 0, "offset": {"x": 0, "z": 0}, "rotation_y": 1.57, "target_size_m": 0.25, "color_override": null }
  ],
  "color_scheme": { "ambient": "#404040", "key_light": "#FFFFFF", "material_base": "#808080" },
  "safety_warnings": ["PORTER DES GANTS", "MOTEUR À L'ARRÊT"],
  "reasoning": "Motor at the workbench center for the main manipulation. Wrench on the top left shelf, used in step 1."
}

NOW PLACE THE ASSETS. RETURN JSON ONLY.`;

/**
 * PROMPT #4 — pedagogical feedback on ONE finished (or interrupted) TP session.
 * Input: structured facts only (no name, no identifier). The step results come
 * from the validation engine / recorded events: the model explains, it never judges
 * whether a step was validated.
 */
export const PROMPT_PEDAGOGICAL_FEEDBACK = `You are a supportive laboratory teacher writing feedback for ONE student after a virtual-reality lab session (TP).
Write in FRENCH, addressing the student with "vous", in simple, concrete sentences a first-year university student understands.

FACTS (the ONLY source of truth — JSON):
{FACTS}

MEANING OF THE FACTS
- "interactive": true → a validation engine checked the steps. status "validated" = confirmed by the engine; "skipped" = the student moved on before the step was validated; "incomplete" = reached but not validated; "not_reached" = never reached; "done" = a step the engine could NOT check (no verifiable action): the student moved on — NEVER call it "validée", "réussie" or "correcte".
- "interactive": false → there was NO automatic check. status "done" only means the student moved on: NEVER say such a step was "validée", "réussie" or "correcte".
- "safety_faults" / "damages": texts of faults detected by the engine during that step.
- "wrong_objects": grabs of objects not mentioned by that step's instruction (guidance only, not an error in itself).
- "aids": uses of help (name tags, going back to re-read a step, close-up magnifier). Using help is normal: never present it as a fault.
- Times are in seconds.

STRICT RULES
1. Use ONLY the facts. Never invent an action, a measurement, a value, a mistake, a duration or a score. Every number you write must appear in the facts (step numbers included).
2. Refer to steps as "étape N" with N = the step number "n" from the facts, and quote/paraphrase the step action from the facts.
3. Explain each documented fault: why it matters for safety or for the result, based on the step action and the step "safety" text.
4. Advice must be concrete and actionable for THIS TP (what to check / do before the action), 1 to 4 items.
5. If there is no fault, say so plainly; do not invent difficulties. An empty "difficulties" list is fine.
6. No grade, no percentage, no comparison with other students.
7. Each list item ≤ 200 characters; "summary" ≤ 400 characters.

OUTPUT (JSON only, no markdown):
{
  "summary": "2-3 sentences on how the session went",
  "strengths": ["..."],
  "difficulties": ["..."],
  "advice": ["..."]
}`;


/**
 * PROMPT #5 — interaction extractor (palier P1).
 * Purpose: find, in each step, the actions the validation engine can check:
 * place an object (on the workbench / on another object), bring an object close
 * to another one, pick up and inspect an object. Everything else is reported as
 * "unsupported". The answer is a PROPOSAL: services/interactions.ts keeps an action
 * only if its evidence is really in the step text (verb + objects).
 * Variables: {OBJECTS} {STEPS}
 */
export const PROMPT_INTERACTIONS = `You are an instructional designer converting a lab procedure (TP) into checkable actions for a virtual-reality lab.

OBJECTS available in the virtual lab (use their "id"):
{OBJECTS}

STEPS of the TP (keep their "order"):
{STEPS}

SUPPORTED ACTION TYPES (the ONLY ones the lab can check):
- "place": the step tells the student to put / set / install one listed object ON the workbench (support = "workbench"; the step names the bench, table, workstation, "établi", "paillasse", "poste", "table", "plan de travail") or ON / IN another listed object (support = that object's id).
  NOT "place": connecting wires or probes, touching a terminal, pouring, screwing, plugging in.
- "approach": the step tells the student to bring one listed object CLOSE to another listed object (target = that object's id), without connecting them.
- "inspect": the step tells the student to pick up / examine / inspect / look at a listed object ITSELF (its state, defects, markings).
  NOT "inspect": observing a phenomenon, a reading, a measurement, a result, or a part that is not in the list.

RULES:
1. Return EVERY step, in order, even when it has no supported action.
2. "evidence" = the exact words copied from that step's text that ask for the action (a short clause containing the verb and the object names). Never paraphrase, never translate.
3. Only use object ids from the list. Never invent an object, a support or a target. If the object, the support or the target is not clearly stated in the step, do NOT create the action: list it in "unsupported" with reason "ambigu : …".
4. List in "unsupported" every other part of the step (measure, connect, adjust, write down, calculate, wait, pour, switch on, explain…), with a short reason in French.
5. Do not repeat the same action twice in a step.

Return JSON only:
{
  "steps": [
    {
      "step": 1,
      "actions": [
        { "type": "place", "object": "<id>", "support": "workbench | <id>", "target": null, "evidence": "<exact words of the step>" },
        { "type": "approach", "object": "<id>", "support": null, "target": "<id>", "evidence": "<exact words>" },
        { "type": "inspect", "object": "<id>", "support": null, "target": null, "evidence": "<exact words>" }
      ],
      "unsupported": [ { "text": "<exact words>", "reason": "mesure non prise en charge" } ]
    }
  ]
}

NOW ANALYZE THE STEPS. RETURN JSON ONLY.`;
