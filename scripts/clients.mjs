// Which MCP clients are installed on this machine.
//
// MCP is an open protocol, so this server works with any client that speaks it.
// Only the registration step differs: each client keeps its server list in its
// own file. Clients whose config location is not known here are still fully
// supported through the manual snippet the setup script prints.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

/**
 * Known clients and where they keep their MCP server list.
 *
 * `style` describes the shape of the file:
 *   "mcpServers" - a top level { "mcpServers": { ... } } object
 *
 * Paths are best effort and can change between client releases. If a client is
 * not detected, the manual snippet still works.
 */
const CLIENTS = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    style: "mcpServers",
    paths: {
      darwin: path.join(
        home,
        "Library/Application Support/Claude/claude_desktop_config.json"
      ),
      win32: path.join(
        process.env.APPDATA || path.join(home, "AppData/Roaming"),
        "Claude/claude_desktop_config.json"
      ),
      linux: path.join(home, ".config/Claude/claude_desktop_config.json"),
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    style: "mcpServers",
    paths: {
      darwin: path.join(home, ".cursor/mcp.json"),
      win32: path.join(home, ".cursor/mcp.json"),
      linux: path.join(home, ".cursor/mcp.json"),
    },
  },
  {
    id: "windsurf",
    name: "Windsurf",
    style: "mcpServers",
    paths: {
      darwin: path.join(home, ".codeium/windsurf/mcp_config.json"),
      win32: path.join(home, ".codeium/windsurf/mcp_config.json"),
      linux: path.join(home, ".codeium/windsurf/mcp_config.json"),
    },
  },
];

/** The config path for a client on this platform, or null. */
export function configPathFor(client) {
  return client.paths[process.platform] ?? null;
}

/**
 * Clients that appear to be installed, judged by whether the parent directory
 * of their config exists. A missing config file is fine: we can create it.
 */
export function detectClients() {
  const found = [];
  for (const client of CLIENTS) {
    const configPath = configPathFor(client);
    if (!configPath) continue;
    const installed =
      existsSync(configPath) || existsSync(path.dirname(configPath));
    if (installed) found.push({ ...client, configPath });
  }
  return found;
}

export function allClients() {
  return CLIENTS.map((c) => ({ ...c, configPath: configPathFor(c) }));
}

/** The JSON a user can paste into any client that uses the mcpServers shape. */
export function manualSnippet(serverPath, accounts) {
  const servers = {};
  for (const account of accounts) {
    const name = account === "default" ? "mail" : `mail-${account}`;
    servers[name] = {
      // Absolute path, because GUI applications do not inherit your shell PATH.
      command: process.execPath,
      args: [serverPath],
      env: { ACCOUNT: account },
    };
  }
  return JSON.stringify({ mcpServers: servers }, null, 2);
}
