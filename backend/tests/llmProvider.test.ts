/**
 * Unit tests — LLM provider choice from the environment (run: npm test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TogetherAIService, hasLLMKey } from "../src/services/togetherAi";

/** Provider URL and model actually used by a service built from `env`. */
function setup(env: NodeJS.ProcessEnv): { url: string; model: string } {
  const s = new TogetherAIService(env) as unknown as { provider: { url: string }; model: string };
  return { url: s.provider.url, model: s.model };
}

test("LLM provider: OpenRouter key wins, Together AI otherwise", () => {
  assert.match(setup({ OPENROUTER_API_KEY: "sk-or-v1-x", TOGETHER_API_KEY: "tgp_v1_x" }).url, /openrouter\.ai/);
  assert.match(setup({ TOGETHER_API_KEY: "tgp_v1_x" }).url, /together\.xyz/);
});

test("LLM provider: an OpenRouter key pasted into TOGETHER_API_KEY goes to OpenRouter with an OpenRouter model", () => {
  const { url, model } = setup({ TOGETHER_API_KEY: "sk-or-v1-x", LLM_MODEL: "meta-llama/Llama-3.3-70B-Instruct-Turbo" });
  assert.match(url, /openrouter\.ai/);
  assert.equal(model, "meta-llama/llama-3.3-70b-instruct");
});

test("LLM provider: no usable key → 503, placeholders do not count", () => {
  assert.equal(hasLLMKey({ TOGETHER_API_KEY: "your_key_here" }), false);
  assert.throws(() => new TogetherAIService({}), /No LLM API key/);
});
