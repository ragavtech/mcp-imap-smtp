# mcp-imap-smtp

An MCP (Model Context Protocol) server that connects any MCP-compatible AI
assistant to an IMAP/SMTP mailbox.

MCP is an open protocol, so this server is not tied to one assistant. It speaks
JSON-RPC over stdio and knows nothing about which client is talking to it. The
only client-specific part is where the server gets registered, and `npm start`
detects installed clients and handles that for you. Anything else is covered by
a configuration snippet you can paste in.

Built for the mailbox that comes with your own domain: cPanel shared hosting, a
self-hosted mail server, or any plain IMAP/SMTP account.

Most email MCP servers are written against Gmail and the other large providers,
and quietly break on these setups, which behave differently in ways that are
easy to miss. This one handles them properly.

## Why this exists

Three things go wrong on self-hosted and shared cPanel mail that hosted-provider tooling does not account for.

**Sent mail disappears.** Gmail's SMTP saves a copy to your Sent folder automatically. Dovecot and most self-hosted servers do not. A tool that only calls SMTP leaves you with no record of anything the assistant sent on your behalf. This server composes the message once, sends it, and appends the same copy to your Sent folder over IMAP.

**Folder names are not what you expect.** cPanel/Dovecot commonly nests everything under an `INBOX.` namespace, so the real path is `INBOX.Sent`, not `Sent`. Tools that assume bare names fail, often silently. This server reads the actual folder list from your server, works out the namespace, and resolves friendly names to real paths.

**Shared hosts throttle logins.** Opening a fresh IMAP connection for every operation is fine on Gmail. On shared hosting, five operations in a row is five rapid logins, which hosts rate limit or temporarily block. This server holds one authenticated connection open, reuses it, and closes it after a period of inactivity, with backoff and retry when the host pushes back.

## Tools

| Tool | Description |
|---|---|
| `diagnose_mailbox` | Report detected namespace, delimiter, Sent folder, and settings. Run this first. |
| `list_mailboxes` | List all folders with their real server paths |
| `create_mailbox` | Create a folder, namespace applied automatically |
| `rename_mailbox` | Rename a folder |
| `delete_mailbox` | Delete a folder and its contents |
| `search_emails` | Search by sender, subject, unread status, or date |
| `get_email` | Fetch full body and attachment list for one message |
| `mark_email` | Mark read/unread or flagged/unflagged |
| `move_email` | Move a message between folders |
| `send_email` | Send via SMTP and save a copy to Sent |

## Requirements

Node.js 20.19 or newer, and an IMAP/SMTP mailbox with its credentials.

Node 18 will install and the connection, search, and folder tools work, but a
transitive dependency used for parsing message bodies requires 20.19, so
`get_email` is untested there. If you are on 18, npm will warn during install.

## Setup

```bash
npm install
npm start
```

`npm start` walks you through everything: it builds the project, asks for your
email address, mail host, and password, tests the connection, and registers the
mailbox with your AI assistant. It works out a likely mail server address from your email domain and asks
you to confirm it, so you are never accepting a value you have not seen.

Nothing is registered unless the connection test passes first, so a typo cannot leave you with a broken connector.

Then restart your assistant and ask it to run `diagnose_mailbox`.

### Which servers it uses

The settings are `mail.yourdomain.com` on port 993 for reading and 465 for
sending. Confirm them in cPanel under Email Accounts, then Connect Devices.

A mailbox hosted elsewhere works too, as long as it offers plain IMAP and SMTP:
enter its server address when asked. Providers that require an app password
rather than the account password, or that do not offer IMAP at all, are outside
what this is built for.

## Running the steps individually

`npm start` is a wrapper around these, which you can also run on their own:

```bash
npm run build         # compile
npm run add-account   # add a mailbox to .env
npm run diagnose      # test every mailbox connects
npm run setup         # register mailboxes with Claude Desktop
```

If you prefer to configure by hand, copy `.env.example` to `.env`; every
setting is documented there.

### Credentials

`.env` is the single source of truth. No passwords are written to the Claude
Desktop config: it stores only the path to the server and a mailbox name, and
credentials are read from `.env` at startup. A password change is a one-file
edit with nothing to keep in sync.

To configure Claude Desktop by hand instead:

```json
{
  "mcpServers": {
    "mail": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-imap-smtp/dist/index.js"],
      "env": { "ACCOUNT": "default" }
    }
  }
}
```

## Managing mailboxes

```bash
npm run mailboxes    # see what is configured and where it is registered
npm run remove       # remove one, choosing from a list
npm run remove -- info   # remove a named one
```

`npm run mailboxes` lists every mailbox with its address, whether it is complete,
and which assistants it is registered with.

`npm run remove` takes a mailbox out of `.env` and removes its connector from
any assistant that had it. It backs up `.env` first and asks before doing
anything. The mailbox on your mail server is never touched.

## Multiple mailboxes

Run `npm start` again and answer yes when it asks whether to add another.
It keeps asking until you say no, so you can add several in one sitting, and
you can come back and add more at any time.

Every mailbox gets a short name describing its purpose, such as `accounts`,
`support`, `operations`, or `personal`. One is suggested from your email
address, so you can press Enter to accept it. It appears in your assistant as the
connector `mail-support`, with its own set of tools, so there is no way to
send from the wrong mailbox by mistake. Multi-word answers are tidied up, so
"Customer Care" becomes `customer-care`.

Test one mailbox on its own with `npm run diagnose -- support`.

Under the hood each mailbox is stored in `.env` with its name as an uppercase
prefix, for example `SUPPORT_IMAP_HOST`. You never need to work that out yourself,
but if you do edit `.env` by hand and get a prefix wrong, `npm run diagnose`
tells you exactly which variable names are missing.

One caution on shared hosting: each mailbox holds its own IMAP connection, so
several accounts on the same host means several concurrent logins against
whatever limit that host enforces.

## Upgrading Node

The connector stores the absolute path of the Node binary that ran the setup,
not the bare word `node`. GUI applications on macOS do not read your shell
configuration, so relying on PATH would break the connector whenever Node moved.

If you change Node versions, re-run `npm start`. It rebuilds, retests, and
rewrites the connector with the new path.

## A note on lockouts

Shared cPanel hosts commonly block your IP address after a few failed logins,
and will then reject even the correct password. If authentication suddenly
starts failing on credentials that worked before, stop retrying, since each
attempt can extend the block. Test the password in webmail, then wait 15 to 30
minutes.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` | required | IMAP connection |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | required | SMTP connection |
| `IMAP_PORT` / `SMTP_PORT` | 993 / 465 | Ports |
| `IMAP_SECURE` / `SMTP_SECURE` | true | TLS on connect |
| `FROM_ADDRESS` | `SMTP_USER` | From header |
| `SAVE_TO_SENT` | true | Append sent mail to Sent over IMAP |
| `TLS_REJECT_UNAUTHORIZED` | true | Set false only for a known cert mismatch |
| `IDLE_TIMEOUT_MS` | 60000 | How long to hold the connection open |

## A note on sending

`send_email` cannot be undone. The tool description instructs assistants to confirm content with you before calling it, and in practice Claude will show you a draft and wait. That is a convention, not a hard guarantee, so treat the send tool with the same care you would treat any irreversible action.

If you would rather the assistant never send at all, remove the `send_email` block from `src/index.ts` and rebuild. Everything else keeps working.

## Security

Credentials live in `.env` (gitignored) or your MCP client's own config, never in source. Passwords are not logged. Note that most cPanel mailboxes do not support app-specific passwords, so `.env` will hold your real mailbox password: keep it out of version control.

`delete_mailbox` permanently removes a folder and its contents.

## Tests

```bash
npm test          # no mailbox needed, runs in CI on every push
npm run test:live # against a real mailbox, see below
```

`npm test` covers folder namespace detection, `.env` editing, prompt parsing,
the fresh-install path, and the MCP protocol itself. The protocol tests drive
the server as an assistant does, over stdio, with credentials pointing at a host
that does not resolve: what they check is that every tool is advertised with a
usable schema, that failures come back as proper errors rather than crashes, and
that invalid arguments are rejected without taking the server down.

## Testing against a real mailbox

```bash
npm run test:live              # the first mailbox in .env
npm run test:live -- support   # a named mailbox
```

This exercises every tool against a live server and writes a report to
`reports/`. It is safe to run against a mailbox holding real mail:

- It creates its own folder and deletes only that folder. Existing folders and
  messages are read but never modified or removed.
- The only address it sends to is the mailbox's own, so no mail reaches anyone
  else.
- It stops at the first authentication failure rather than retrying, because
  shared hosts block an IP after a few and retrying makes that worse.

It asks for confirmation before starting, and lists exactly what it will do.

## Status

Tested against a live cPanel mailbox: connecting, authenticating, folder
namespace detection, and searching. Namespace detection is confirmed working on
a server that nests folders under `INBOX.`.

Implemented but not yet verified against a live server: sending, saving sent
mail to the Sent folder, reading full message bodies, moving messages, changing
flags, and creating or deleting folders. Run `npm run test:live` to check these
against your own mailbox; it writes a report you can paste into an issue.

## Roadmap

Not built yet, and only worth adding if there is real demand:

- Attachment support on send
- Multiple accounts in one server
- POP3. Deliberately excluded: POP3 has no server-side folder model, so folder and flag operations have nothing to act on.

## Updating to a newer version

Your `.env` is not tracked by git and is never included in a release, so it
survives an update. If you are replacing the folder wholesale rather than
pulling, back it up first.

Pulling from git:

```bash
git pull
npm install
npm run build
npm run diagnose
```

Replacing the folder from a downloaded copy:

```bash
# from inside the existing project folder
cp .env ~/Desktop/env-backup.txt

# replace the folder, keeping the same path so client config stays valid
cd ..
rm -rf mcp-imap-smtp
# unzip or clone the new copy here, then:
cd mcp-imap-smtp
cp ~/Desktop/env-backup.txt .env
chmod 600 .env
npm install
npm run build
npm run diagnose
rm ~/Desktop/env-backup.txt
```

Keep the folder at the same path. Claude Desktop stores that path, so moving
the project means re-running `npm run setup`.

Re-run `npm run setup` after updating only if the release notes say the client
configuration changed.

## Development

```bash
npm run build      # compile TypeScript
npm test           # namespace detection tests
npm start            # guided setup, does everything below
npm run add-account  # add a mailbox, writes .env for you
npm run diagnose     # check every mailbox connects
npm run mailboxes    # list configured mailboxes
npm run remove       # remove a mailbox
npm run setup        # sync mailboxes to your assistant
npm run unregister   # remove this project from Claude Desktop
npm run server       # run the MCP server directly
npm run dev        # watch mode
```

## License

MIT
