/**
 * Reusable, deterministic quiz-session draw for the authored demonstrations.
 *
 * A session contains at most one question per answer target. Each target owns
 * several accurate formulations; the draw never mixes a prompt with another
 * target's answer, flag, hints or 3D selection zone.
 */

export interface QuizVariant {
  /** Globally unique question id, stable across sessions and reports. */
  id: string;
  prompt: string;
}

export interface QuizTarget {
  /** Component / instrument id used by the viewer and its selection zone. */
  answer: string;
  variants: readonly QuizVariant[];
}

export interface QuizQuestion extends QuizVariant {
  answer: string;
  /** State flag expected by the simulation rule for this exact question. */
  flag: string;
}

export interface QuizPlan {
  seed: string;
  questions: QuizQuestion[];
}

export const QUIZ_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DEMO_QUESTION_COUNT = 5;

/**
 * Draws `count` distinct targets, then one formulation per target.
 * The same seed always returns the same plan (including prompts and flags).
 */
export function drawQuiz(
  targets: readonly QuizTarget[],
  count: number,
  seed: string,
  flagFor: (target: QuizTarget, variant: QuizVariant) => string = (_target, variant) => `answered_${variant.id}`
): QuizPlan {
  if (!QUIZ_SEED_PATTERN.test(seed)) throw new Error(`Invalid quiz seed: ${seed}`);
  if (!Number.isInteger(count) || count < 1 || count > targets.length) {
    throw new Error(`Quiz count must be between 1 and ${targets.length}`);
  }
  const answers = new Set<string>();
  const variantIds = new Set<string>();
  for (const target of targets) {
    if (!target.answer || answers.has(target.answer)) throw new Error(`Duplicate or empty quiz answer: ${target.answer}`);
    answers.add(target.answer);
    if (!target.variants.length) throw new Error(`No question for quiz answer: ${target.answer}`);
    for (const variant of target.variants) {
      if (!variant.id || !variant.prompt.trim() || variantIds.has(variant.id)) throw new Error(`Duplicate or empty question: ${variant.id}`);
      variantIds.add(variant.id);
    }
  }

  const random = seededRandom(seed);
  const selected = shuffle([...targets], random).slice(0, count);
  const questions = selected.map((target) => {
    const variant = target.variants[Math.floor(random() * target.variants.length)];
    return { id: variant.id, prompt: variant.prompt, answer: target.answer, flag: flagFor(target, variant) };
  });
  if (new Set(questions.map((q) => q.flag)).size !== questions.length) throw new Error("Duplicate validation flag in quiz session");
  return { seed, questions };
}

/** Fisher–Yates, driven only by the supplied PRNG (testable, no Math.random). */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** FNV-1a seed hash + Mulberry32: small, stable across Node versions. */
export function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  let a = hash >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
