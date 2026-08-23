import test from "node:test";
import assert from "node:assert/strict";
import { streamAgentChat } from "../../../api/v1/agent/runtime.ts";
import { shouldOpenLaunchCard } from "../../agents/go-command-parser.ts";

test("stream chat intercepts template requests and returns a launch card instead of LLM prose", async () => {
  assert.equal(shouldOpenLaunchCard("给我模板"), true);
  let delta = "";
  let result = null;
  await streamAgentChat({
    message: "给我模板",
    language: "zh",
    onDelta: ({ content }) => {
      delta += String(content || "");
    },
    onResult: (value) => {
      result = value;
    },
    timeoutMs: 8000,
  });
  assert.ok(result, "expected launch card result, not a streamed essay");
  assert.equal(result.cards?.[0]?.type, "launch_draft");
  assert.equal(result.agent?.used_llm, false);
  assert.equal(delta, "");
  const content = String(result.message?.content || "");
  assert.ok(content.length < 40, content);
});
