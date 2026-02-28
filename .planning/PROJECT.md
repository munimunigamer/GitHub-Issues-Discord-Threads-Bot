# GitHub Issues Discord Threads Bot

## What This Is

A Discord bot that serves as a seamless bidirectional bridge between a Discord forum channel and a GitHub repository's issues. Any action on either platform — creating, commenting, tagging, locking, archiving, deleting — is automatically mirrored to the other, enabling teams to manage issues from whichever platform they prefer.

## Core Value

Every GitHub issue action is reflected in Discord and vice versa — the two platforms stay perfectly in sync without manual effort.

## Requirements

### Validated

- ✓ Discord thread creation → GitHub issue creation — existing
- ✓ Discord comments → GitHub issue comments — existing
- ✓ Discord lock/unlock → GitHub issue lock/unlock — existing
- ✓ GitHub issue lock/unlock → Discord thread lock/unlock — existing
- ✓ Discord archive → GitHub issue close — existing
- ✓ Discord unarchive → GitHub issue reopen — existing
- ✓ GitHub issue close → Discord thread archive — existing
- ✓ GitHub issue reopen → Discord thread unarchive — existing
- ✓ Discord thread deletion → GitHub issue deletion — existing
- ✓ GitHub issue deletion → Discord thread deletion — existing

### Active

- [ ] GitHub issue creation → Discord thread creation (reverse direction)
- [ ] GitHub issue comments → Discord thread messages (reverse direction)
- [ ] Tag sync: Discord forum tags → GitHub issue labels
- [ ] Tag sync: GitHub issue labels → Discord forum tags
- [ ] Tag initialization: sync all GitHub labels as Discord forum tags on startup
- [ ] Image sync: Discord attachments (png/jpeg) → GitHub issue body/comments
- [ ] Image sync: GitHub images → Discord messages
- [ ] Cross-link: Discord thread gets first message with GitHub issue URL + [#N] in title
- [ ] Cross-link: GitHub issue body contains Discord thread link
- [ ] Kanban: auto-detect GitHub Project linked to repo
- [ ] Kanban: column changes → mirror column name as Discord tag (replace old)
- [ ] Kanban: "Done" column (case-insensitive) → apply tag + archive Discord thread

### Out of Scope

- Backfilling existing GitHub issues as Discord threads — not needed
- Setup wizard or interactive CLI — keep it simple
- Gif, text, video attachments — png/jpeg only for now
- OAuth or multi-repo support — single repo, token auth
- Database persistence — in-memory store is sufficient
- Configurable label filtering — all GitHub labels sync, no whitelist/blacklist

## Context

- Existing TypeScript codebase with discord.js 14 + Octokit + Express webhook server
- Event-driven architecture: Discord events trigger GitHub API calls, GitHub webhooks trigger Discord API calls
- In-memory store (`src/store.ts`) tracks thread-to-issue mappings with lock flags for conflict resolution
- Webpack bundles to `dist/index.js`, must run in development mode due to discord.js ThreadCreate bundling issue
- GitHub webhooks received on Express server (port 5000 by default)
- Comments use temporary webhooks for author avatar attribution

## Constraints

- **Tech stack**: TypeScript, discord.js 14, @octokit/rest + @octokit/graphql, Express — must extend existing stack
- **Discord limits**: Forum channels have a 20-tag limit — GitHub repos with >20 labels will need handling
- **Attachments**: png and jpeg only for this milestone
- **Kanban detection**: Auto-detect first GitHub Project linked to the repo, no manual config
- **Done column**: Case-insensitive match on column name "Done"

## Key Decisions

| Decision                                    | Rationale                               | Outcome   |
| ------------------------------------------- | --------------------------------------- | --------- |
| All GitHub labels → Discord tags            | Simplicity, no config needed            | — Pending |
| Cross-link in both directions               | Easy navigation between platforms       | — Pending |
| Issue number [#N] in thread title           | Quick visual reference without opening  | — Pending |
| Replace kanban column tags (not accumulate) | Issue is only in one column at a time   | — Pending |
| Done column triggers archive + tag          | Matches existing archive→close behavior | — Pending |
| Env var for project ID not needed           | Auto-detect keeps config minimal        | — Pending |

---

_Last updated: 2026-02-28 after initialization_
