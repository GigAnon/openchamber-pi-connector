/// <reference types="node" />
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager, type ManagedSession } from "../src/sessions.js";
import { SessionStore } from "../src/session-store.js";

function session(): ManagedSession {
  return {
    info: { id: "ses_tools", projectID: "/tmp/test", directory: "/tmp/test", title: "Tools", version: "test", time: { created: 1000, updated: 1000 } },
    pi: undefined, messages: [], status: { type: "idle" }, model: undefined, streaming: undefined,
    toolByCallId: new Map(), tree: { messageEntries: {} },
    hasPendingInteraction: () => false, hasRunningChildren: () => false,
  };
}

/** The `completed` time of each assistant message.updated the manager emitted, in order. */
function completions(events: Array<{ type: string; properties?: { info?: { role?: string; time?: { completed?: number } } } }>) {
  return events
    .filter((e) => e.type === "message.updated" && e.properties?.info?.role === "assistant")
    .map((e) => e.properties?.info?.time?.completed);
}

function setup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "ocpi-tool-msg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const events: Array<{ type: string; properties?: Record<string, never> }> = [];
  // A copy at emit time: the manager mutates the message object it emitted (as a client would have received it).
  const manager = new SessionManager((_dir, event) => { events.push(structuredClone(event) as never); }, new SessionStore(join(dir, "state")));
  t.after(() => manager.disposeAll());
  return { manager, events, live: session() };
}

test("a tool-use assistant message stays open until turn_end, so its running tools are not shown as interrupted", (t) => {
  // Given: pi ends an assistant message that asked for a tool, before running it.
  const { manager, events, live } = setup(t);
  const message = { role: "assistant", content: [], timestamp: 1000 };
  manager["onPiEvent"](live, { type: "message_start", message });
  manager["onPiEvent"](live, { type: "message_end", message: { ...message, stopReason: "toolUse" } });
  // Then: the message is updated but not completed while the tool runs.
  assert.ok(completions(events as never).every((c) => c === undefined), "completed before its tools ran");
  manager["onPiEvent"](live, { type: "tool_execution_start", toolCallId: "call_1", toolName: "Agent", args: {} });
  assert.ok(completions(events as never).every((c) => c === undefined), "completed while its tool runs");
  // When: the turn ends with the tool results.
  manager["onPiEvent"](live, { type: "turn_end", toolResults: [] });
  // Then: the message is completed once.
  const done = completions(events as never).filter((c) => c !== undefined);
  assert.equal(done.length, 1);
  assert.equal(live.messages?.at(-1)?.info.role === "assistant" && typeof (live.messages.at(-1)?.info as { time: { completed?: number } }).time.completed, "number");
});

test("an assistant message that does not stop for tools completes at message_end", (t) => {
  const { manager, events, live } = setup(t);
  const message = { role: "assistant", content: [], timestamp: 1000 };
  manager["onPiEvent"](live, { type: "message_start", message });
  manager["onPiEvent"](live, { type: "message_end", message: { ...message, stopReason: "stop" } });
  assert.equal(completions(events as never).filter((c) => c !== undefined).length, 1);
});

test("agent_end completes a tool-use message whose turn_end never came", (t) => {
  const { manager, events, live } = setup(t);
  const message = { role: "assistant", content: [], timestamp: 1000 };
  manager["onPiEvent"](live, { type: "message_start", message });
  manager["onPiEvent"](live, { type: "message_end", message: { ...message, stopReason: "toolUse" } });
  manager["onPiEvent"](live, { type: "agent_end" });
  assert.equal(completions(events as never).filter((c) => c !== undefined).length, 1);
});
