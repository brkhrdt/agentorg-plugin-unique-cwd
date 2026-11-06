import { expect, test } from "./assertions.ts";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { copyFile, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { OrganizationClient } from "agent-organization/client";
import type { AgentRecord, Operation } from "agent-organization/types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Opt in after building core and this plugin; deploy without sources/node_modules.
test("compiled host loads relocated cwd bundle and enforces workspace policy", { skip: !process.env.ORG_BINARY, timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cwd-binary-"));
  let server: ReturnType<typeof spawn> | undefined;
  let client: OrganizationClient | undefined;
  let mcp: Client | undefined;
  try {
    const binary = join(dir, "agentorg");
    await copyFile(resolve(process.env.ORG_BINARY!), binary);
    const plugin = join(dir, "cwd.js");
    await copyFile(join(dirname(new URL(import.meta.url).pathname), "../dist/index.js"), plugin);
    const agentScript = join(dir, "agent.js");
    await build({ entryPoints: [join(dirname(new URL(import.meta.url).pathname), "fixtures/agent.ts")], bundle: true, platform: "node", format: "esm", outfile: agentScript });
    const harness = join(dir, "harness.js");
    await writeFile(harness, `
      import { writeFileSync } from "node:fs";
      export default {
        apiVersion: 1, name: "fixture",
        setup(host) {
          host.registerHarness({
            name: "fixture",
            launch(ctx) {
              if (!ctx.agent.parentId) writeFileSync(${JSON.stringify(join(dir, "bridge.json"))}, JSON.stringify(ctx.mcpServers[0]));
              return { command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(agentScript)}], cwd: ${JSON.stringify(dir)} };
            }
          });
        }
      };
    `);
    const workspace = join(dir, "workspace");
    await mkdir(join(workspace, "child"), { recursive: true });
    const socket = join(dir, "data/server.sock");
    server = spawn(binary, ["--data-dir", join(dir, "data"), "--plugin", harness, "--plugin", plugin], {
      cwd: dir, env: { PATH: dir }, stdio: ["ignore", "ignore", "pipe"],
    });
    for (let attempt = 0; attempt < 250 && !client; attempt++) {
      try { client = await OrganizationClient.connect(socket); }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    if (!client) {
      if (server.exitCode === null) { server.kill("SIGTERM"); await new Promise<void>(resolve => server!.once("exit", () => resolve())); }
      const stderr = "";
      throw new Error(`Compiled server did not start: ${stderr}`);
    }
    const create = async (parentId: string | null, cwd: string) => client!.wait(await client!.request<Operation>("agent.create", {
      parentId, settings: { harness: "fixture", model: "test", cwd },
    }));
    const rootOp = await create(null, workspace);
    expect(rootOp.status).toBe("completed");
    const root = rootOp.result as AgentRecord;
    const rejected = await create(root.id, ".");
    expect(rejected.status).toBe("failed");
    expect(rejected.error?.code).toBe("INVALID_PARAMS");
    const childOp = await create(root.id, "child");
    expect(childOp.status).toBe("completed");
    const child = childOp.result as AgentRecord;
    expect(child.settings.cwd).toBe(join(workspace, "child"));
    const prompt = await client.wait(await client.request<Operation>("agent.prompt", { agentId: child.id, text: "cwd" }));
    expect(prompt.result).toMatchObject({ text: child.settings.cwd });

    // Use the root's host-owned MCP spec recorded by the trusted fixture harness.
    const bridge = JSON.parse(await readFile(join(dir, "bridge.json"), "utf8"));
    mcp = new Client({ name: "cwd-binary-test", version: "1" });
    await mcp.connect(new StdioClientTransport({ command: bridge.command, args: bridge.args, cwd: dir, env: { PATH: dir, ...Object.fromEntries(bridge.env.map((entry: { name: string; value: string }) => [entry.name, entry.value])) } }));
    const tool = (await mcp.listTools()).tools.find(t => t.name === "create_subagent")!;
    expect(tool.inputSchema.required).toContain("cwd");
    const malformed = await mcp.callTool({ name: "create_subagent", arguments: { settings: { harness: "fixture", model: "test" } } });
    expect(malformed.isError).toBe(true);
    expect(JSON.parse((malformed.content as any)[0].text).code).toBe("INVALID_PARAMS");
    const invalid = await mcp.callTool({ name: "create_subagent", arguments: { cwd: ".", settings: { harness: "fixture", model: "test" } } });
    const op = await client.wait(JSON.parse((invalid.content as any)[0].text));
    expect(op.error?.code).toBe("INVALID_PARAMS");
  } finally {
    await mcp?.close();
    client?.close();
    if (server && server.exitCode === null) { server.kill("SIGTERM"); await new Promise<void>(resolve => server!.once("exit", () => resolve())); }
    await rm(dir, { recursive: true, force: true });
  }
});
