# @agentorg/plugin-unique-cwd

Optional workspace-nesting plugin for [agentorg](../agentorg/README.md), extracted from its built-in `src/plugins/cwd.ts`. The runtime plugin name remains **`cwd`** and the named export remains **`cwdPlugin`** (also the default export). Existing `settings.cwd` records need no migration.

## Install and load

With the repositories checked out side by side and Node.js 22.6+ / npm installed:

```sh
cd agentorg-plugin-unique-cwd
npm ci
cd ../agentorg
npm start -- --plugin ../agentorg-plugin-pi-agent/src/index.ts --plugin ../agentorg-plugin-unique-cwd/src/index.ts
```

This policy plugin does not provide a harness; load your chosen harness plugin separately. It uses plugin API v1 and has only type imports from core.

For a compiled server, bundle the plugin and load the resulting standalone module:

```sh
cd agentorg-plugin-unique-cwd
npm run build
cd ../agentorg
./dist/agentorg --plugin ../agentorg-plugin-pi-agent/dist/index.js --plugin ../agentorg-plugin-unique-cwd/dist/index.js
```

The cwd bundle includes its npm dependencies and can be relocated without sources or `node_modules`. The Pi plugin has its own build requirements; see its README. Without this plugin, core still supports `settings.cwd` but does not enforce workspace nesting.

## Workspace policy

MCP `create_subagent` gains a **required top-level `cwd`** argument; `settings.cwd` is rejected in this tool:

```json
{"name":"coder","cwd":"workers/coder","settings":{"harness":"pi","provider":"openai-codex","model":"gpt-6-luna"}}
```

- Directories must already exist. Relative child paths resolve from the **direct parent's cwd**; root paths resolve from the server cwd. Omitting root cwd uses the server cwd.
- Paths are canonicalized through symlinks. A child's cwd must be strictly inside its parent's, never equal or outside. Siblings and roots are not required to have distinct directories; “unique” does not add a global uniqueness policy.
- Client `agent.create` / `agent.modify` use **`settings.cwd`**; child creation requires it. Modifications cannot move an agent outside its parent or invalidate existing, nonremoved children's containment. Rejected modifications do not stop a running agent.
- Canonical absolute cwd is persisted and included in agent info as `settings.cwd`, including for stopped agents.
- The plugin sets harness process/ACP session cwd, rechecks containment at every launch (including restart/recovery), and validates the final resolved launch cwd.

This is launch-time workspace validation, **not a filesystem sandbox**. Agents still have ordinary shell/file access. Filesystem changes after validation and other trusted plugins can undermine containment.

## Development

The integration tests use a sibling `../agentorg` checkout for the server and MCP bridge, plus a local deterministic ACP fixture; no Pi installation or credentials are needed.

```sh
npm run check
npm test
npm run build
# Build the core binary first:
(cd ../agentorg && npm run build)
npm run test:binary
```

The binary test relocates the bundle and loads it into the compiled core, exercising canonical cwd, coded containment errors, and the MCP tool schema.
