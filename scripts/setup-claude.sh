#!/bin/bash
# Syncs Claude Desktop with the mailboxes defined in .env.
#
# This is a reconcile, not an append: mailboxes in .env are added or updated,
# and connectors this project registered previously that are no longer in .env
# are removed. Renaming or deleting a mailbox therefore never leaves anything
# stale behind, and there is nothing to clean up by hand.
#
# Credentials stay in .env. Only a path and a mailbox name are written here.
#
#   npm run setup              sync
#   npm run setup -- --remove  remove all of this project's connectors

set -u

# Default to whatever the client detection says for this platform, rather than
# assuming macOS. npm start passes an explicit path when the user picks a client.
if [ -n "${MCP_CLIENT_CONFIG:-}" ]; then
  CONFIG="$MCP_CLIENT_CONFIG"
else
  CONFIG="$(node -e "
import('$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/clients.mjs').then(m => {
  const claude = m.allClients().find(c => c.id === 'claude-desktop');
  process.stdout.write(claude?.configPath ?? '');
});
")"
fi
if [ -z "$CONFIG" ]; then
  echo "  ERROR: could not determine the client config location."
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="$PROJECT_DIR/dist/index.js"
MODE="sync"

for arg in "$@"; do
  case "$arg" in
    --remove|--uninstall) MODE="remove" ;;
  esac
done

echo ""
if [ "$MODE" = "remove" ]; then
  echo "  Removing mcp-imap-smtp from ${MCP_CLIENT_NAME:-Claude Desktop}"
  echo "  -----------------------------------------"
else
  echo "  mcp-imap-smtp  ->  ${MCP_CLIENT_NAME:-Claude Desktop}"
  echo "  --------------------------------"
fi
echo ""

if [ "$MODE" = "sync" ]; then
  if [ ! -f "$SERVER" ]; then
    echo "  ERROR: $SERVER not found. Run 'npm run build' first."
    exit 1
  fi
  if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "  ERROR: no .env found. Run 'npm start' to set one up."
    exit 1
  fi
  # npm start passes the mailboxes that passed their connection test. Run on
  # its own, this registers everything in .env.
  if [ -n "${MCP_ACCOUNTS:-}" ]; then
    ACCOUNTS="$MCP_ACCOUNTS"
  else
    ACCOUNTS=$(node -e "
import('$PROJECT_DIR/dist/mailClient.js')
  .then(m => console.log(m.listAccounts().join(' ')))
  .catch(e => { console.error(e.message); process.exit(1); })
") || { echo "  ERROR: could not read mailboxes from .env"; exit 1; }
  fi

  if [ -z "$ACCOUNTS" ]; then
    echo "  ERROR: no mailboxes defined in .env"
    exit 1
  fi
  echo "  project:   $PROJECT_DIR"
  echo "  mailboxes: $ACCOUNTS"
  echo ""
else
  ACCOUNTS=""
fi

if [ ! -f "$CONFIG" ]; then
  if [ "$MODE" = "remove" ]; then
    echo "  No ${MCP_CLIENT_NAME:-Claude Desktop} config found. Nothing to remove."
    exit 0
  fi
  mkdir -p "$(dirname "$CONFIG")"
  echo '{}' > "$CONFIG"
  echo "  Created a new ${MCP_CLIENT_NAME:-Claude Desktop} config."
fi

BACKUP="$HOME/Desktop/claude_config_backup_$(date +%Y%m%d_%H%M%S).json"
cp "$CONFIG" "$BACKUP"
echo "  backup:    $BACKUP"
echo ""

MCP_NODE="$(command -v node)"
export MCP_SERVER="$SERVER" MCP_CONFIG="$CONFIG" MCP_ACCOUNTS="$ACCOUNTS" \
       MCP_MODE="$MODE" MCP_NODE="$MCP_NODE"

python3 "$SCRIPT_DIR/sync-config.py"
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo ""
  echo "  Nothing was changed."
  exit 1
fi

if python3 -m json.tool "$CONFIG" > /dev/null 2>&1; then
  chmod 600 "$CONFIG"
  echo ""
  if [ "$MODE" = "remove" ]; then
    echo "  Done. Restart ${MCP_CLIENT_NAME:-Claude Desktop} to apply."
  else
    echo "  Config is valid JSON. No passwords were written to it."
  fi
  echo ""
else
  echo ""
  echo "  Config came out invalid. Restoring your backup."
  cp "$BACKUP" "$CONFIG"
  echo "  Restored."
  exit 1
fi
