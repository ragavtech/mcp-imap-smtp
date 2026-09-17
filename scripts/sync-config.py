"""Reconciles the Claude Desktop config with the mailboxes defined in .env.

Called by setup-claude.sh. Reads its settings from environment variables so no
credentials ever appear on a command line.
"""

import json
import os
import sys

config_path = os.environ["MCP_CONFIG"]
server = os.environ["MCP_SERVER"]
# The absolute path of the Node binary that just ran the connection tests.
# Writing "node" instead would rely on the assistant finding it on PATH, and
# GUI applications on macOS do not read your shell configuration, so a Node
# installed by nvm or moved by an upgrade would silently break the connector.
node_binary = os.environ.get("MCP_NODE", "node")
mode = os.environ.get("MCP_MODE", "sync")
wanted = os.environ.get("MCP_ACCOUNTS", "").split()

try:
    with open(config_path) as handle:
        config = json.load(handle)
except json.JSONDecodeError as error:
    print(f"  ERROR: existing config is not valid JSON ({error}).")
    print("  Restore the backup from your Desktop and try again.")
    sys.exit(1)

if not isinstance(config, dict):
    print("  ERROR: unexpected config format.")
    sys.exit(1)

servers = config.setdefault("mcpServers", {})


def belongs_to_us(entry):
    """True if a connector points at this project, including older layouts."""
    if not isinstance(entry, dict):
        return False
    args = entry.get("args") or []
    if not args:
        return False
    target = str(args[0])
    return target == server or target.endswith("mcp-imap-smtp/dist/index.js")


if mode == "remove":
    ours = [name for name, entry in servers.items() if belongs_to_us(entry)]
    for name in ours:
        del servers[name]
        print(f"  removed  '{name}'")
    if not ours:
        print("  Nothing from this project was registered.")
else:
    # The mailboxes in .env are the whole truth. Anything this project
    # registered before that is no longer listed gets removed, so renaming or
    # deleting a mailbox never leaves a stale connector behind.
    desired = {
        ("mail" if account == "default" else f"mail-{account}"): account
        for account in wanted
    }

    stale = [
        name
        for name, entry in servers.items()
        if belongs_to_us(entry) and name not in desired
    ]
    for name in stale:
        del servers[name]
        print(f"  removed  '{name}'  (no longer in .env)")

    for name, account in desired.items():
        existed = name in servers
        servers[name] = {
            "command": node_binary,
            "args": [server],
            "env": {"ACCOUNT": account},
        }
        print(f"  {'updated' if existed else 'added  '}  '{name}'  ->  {account}")

if not servers:
    config.pop("mcpServers", None)

with open(config_path, "w") as handle:
    json.dump(config, handle, indent=2)

print("")
print("  connectors now: " + (", ".join(sorted(servers)) or "(none)"))
