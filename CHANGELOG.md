# Changelog

## 1.22.0

- Removed the built-in settings for Gmail, Outlook and other large providers.
  The project is for mailboxes on your own domain, and those providers mostly
  require an app password and two-step verification, which is a different setup
  path. A mailbox elsewhere still works if it offers plain IMAP and SMTP: enter
  its server address when asked.

## 1.21.0

Correctness fixes found in review:

- Fixed a crash in every search. `client.search()` returns `false` when the
  server declines a query, and an unsafe cast to `number[]` hid that from the
  compiler, so `.slice()` threw a TypeError.
- `mark_email` and `move_email` discarded the server's answer and always
  reported success. Acting on a message that does not exist now fails rather
  than claiming to have worked.
- A rejected login is no longer treated as a transient error. It was matched by
  a broad check for "connection" and retried three times, which is exactly what
  causes a shared host to block your IP.
- `get_email` refuses messages over 25MB rather than buffering them whole, and
  truncates very long bodies rather than flooding the assistant's context.

Following MCP guidance:

- Every tool now carries annotations, so a client knows before calling whether
  a tool only reads, destroys anything, or is safe to repeat. `delete_mailbox`
  is the only one marked destructive.
- `search_emails` is properly paginated, returning `total`, `hasMore` and
  `nextOffset`, and fetching only the requested window. It previously pulled
  every message id in the folder before discarding all but a few.
- Migrated from the deprecated `server.tool()` to `registerTool`.

## 1.20.0

- Settings that can be known are corrected automatically rather than offered as
  a choice. If a Gmail mailbox is pointed at the wrong host, it is fixed and
  retried without interrupting you. A menu whose first option is plainly right
  and whose others are worse is a formality, not a decision.
- Questions are still asked when the answer genuinely is not known: a mailbox on
  its own domain with a wrong address, or any rejected password.

## 1.19.1

- A mailbox with the wrong server settings can be corrected in place. When the
  address belongs to a known provider, recovery offers its real settings as a
  first option rather than suggesting the same wrong guess again. Previously
  the only way out was to remove the mailbox and add it back.

## 1.19.0

- Large providers are now presented as fully supported rather than merely
  tolerated. One server covers every mailbox you have: a business domain on
  cPanel, a Gmail and an Outlook can all be added and appear as separate
  connectors.

## 1.18.1

- Saving a copy to Sent is switched off automatically for providers that
  already do it. Gmail files SMTP-sent mail in Sent Mail by itself, so the
  behaviour this project exists to provide would have left two copies of
  everything there.
- The README says plainly that large providers are supported so that pointing
  this at one does not fail confusingly, not because they are what it is for.

## 1.18.0

- Recognises common providers from the email address and uses their real
  settings. `mail.` plus the domain is correct for a domain on its own hosting
  but wrong for every large provider: there is no `mail.gmail.com`.
- Reading and sending can now use different hosts and ports, which Gmail,
  Outlook and iCloud all require. Previously one value was written to both.
- Warns before the password is typed when a provider requires an app password
  rather than the account password.
- Says plainly that Proton Mail and Tuta do not offer IMAP, instead of letting
  the connection fail without explanation.

## 1.17.1

- Fixed: a mailbox added partway through `npm start` was never tested, yet was
  still registered with the assistant. Two causes. The account list was read by
  re-importing a module, but dotenv does not overwrite variables already in the
  environment, so anything added during the run stayed invisible. And the setup
  step registered every mailbox in `.env` rather than only those that passed
  their connection test.

## 1.17.0

- Protocol tests that drive the server over stdio the way an assistant does,
  checking tool schemas, error handling, and that invalid input cannot crash
  the server. No mailbox required, so they run in CI.

## 1.16.0

- `npm run test:live` exercises every tool against a real mailbox and writes a
  report. It creates and deletes only its own folder, sends only to the
  mailbox's own address, and stops at the first authentication failure.

## 1.14.1

- Plainer wording throughout the setup. "Enter" instead of "Return", shorter
  sentences, one idea per line.
- Failures are explained once rather than three times during guided setup.

## 1.14.0

- `npm run mailboxes` lists every configured mailbox, its address, and which
  assistants it is registered with.
- `npm run remove` removes a mailbox from `.env` and from any assistant that
  had it, with a backup and a confirmation first.
- Setup questions are numbered, so a run reads as a sequence of steps.
- Fixed: the setup script assumed the macOS config path on every platform,
  so on Linux and Windows it wrote to a different file than the one the
  client detection read from.

## 1.13.0

- The absolute path of the Node binary is written into client configs rather
  than the bare word `node`. GUI applications do not inherit a shell PATH, so
  a Node installed by nvm or moved by an upgrade would otherwise break the
  connector silently.
- Node 20.19 or newer is now required, matching what the dependencies need.

## 1.12.0

- Every mailbox is named, including the first, with a name suggested from the
  email address. Previously the first was silently called "default".

## 1.11.0

- The password prompt shows a dot per character and the total count, so a
  paste that did not land, landed twice, or picked up a stray character is
  visible.

## 1.10.0

- Failed connections offer recovery in place: re-enter the password, correct
  the server address, try other ports, or trust a certificate, depending on
  why it failed. Previously a failure was a dead end.
- Repeated authentication failures are handled carefully, since shared hosts
  block an IP after a few and retrying makes it worse.
- Fixed: child processes inherited environment variables loaded from `.env`,
  so corrected settings had no effect on retry.

## 1.9.1

- Passwords are stored base64 encoded. An unquoted `#` in a `.env` file starts
  a comment, which silently truncated any password containing one, and dotenv's
  quoting cannot survive a value containing both quote types.
- Fixed: reading the password a byte at a time corrupted non-ASCII characters.

## 1.9.0

- Detects which MCP clients are installed and asks which to use. MCP is an open
  protocol; only the registration step is client-specific.
- Prints a pasteable configuration snippet for clients it does not recognise.

## 1.8.0

- Visual structure in the terminal: a banner, numbered steps, status symbols,
  and dimmed help text. Colour switches off when output is not a terminal.

## 1.7.0

- `npm run setup` reconciles rather than appends: mailboxes in `.env` are added
  or updated, and connectors this project registered previously that are no
  longer listed are removed.
- `npm run unregister` removes this project from a client entirely.

## 1.6.0

- Each mailbox is tested immediately after it is entered, so an error appears
  next to the answers that caused it.
- Updated nodemailer, which had a flaw where mail could be delivered to an
  unintended domain.

## 1.5.0

- `npm start` is a single guided command: builds, asks for mailboxes, tests
  them, and registers them. Nothing is registered unless a mailbox connects.

## 1.4.0

- `npm run add-account` asks questions and writes `.env`, so the variable
  naming convention never has to be worked out by hand.

## 1.3.0

- `.env` is the single source of truth. No passwords are written to client
  configs; they store only a path and a mailbox name.
- Multiple mailboxes, each appearing as its own connector.

## 1.1.0

Built for self-hosted and shared cPanel hosting, where three things behave
differently from the hosted providers most email tooling targets:

- Sent mail is saved to the Sent folder over IMAP after sending. Gmail does
  this automatically; most self-hosted servers do not, so outgoing mail would
  otherwise leave no record.
- The folder namespace is detected from the server rather than assumed, since
  cPanel commonly nests everything under `INBOX.`.
- One IMAP connection is held open and reused, because shared hosts throttle
  rapid login cycles.

## 1.0.0

Initial release: IMAP and SMTP tools over MCP.
