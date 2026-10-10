import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

let sessionId: string = crypto.randomUUID();
acp
  .agent({ name: "cwd-fixture" })
  .onRequest("initialize", () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest("session/new", () => ({ sessionId }))
  .onRequest("session/load", (ctx) => {
    sessionId = ctx.params.sessionId;
    return {};
  })
  .onRequest("session/prompt", async (ctx) => {
    await ctx.client.notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: process.cwd() },
      },
    });
    return { stopReason: "end_turn" };
  })
  .connect(acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ));
