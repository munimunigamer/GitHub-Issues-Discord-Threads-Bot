# External Integrations

**Analysis Date:** 2026-02-28

## APIs & External Services

**Discord Bot:**
- Discord API - Bot client for managing threads and messages in Discord
  - SDK/Client: discord.js 14.15.3
  - Auth: Environment variable `DISCORD_TOKEN`
  - Implementation: `src/discord/discord.ts`
  - Events handled: ThreadCreate, ThreadUpdate, ChannelUpdate, MessageCreate, ThreadDelete, MessageDelete

**GitHub:**
- GitHub REST API - Issue creation, updates, deletion, locking
  - SDK/Client: @octokit/rest 20.1.1
  - Auth: Environment variable `GITHUB_ACCESS_TOKEN`
  - Base URL: https://api.github.com
  - Implementation: `src/github/githubActions.ts`
  - Repository credentials: Specified via `GITHUB_USERNAME` and `GITHUB_REPOSITORY`

- GitHub GraphQL API - Issue queries and metadata retrieval
  - SDK/Client: @octokit/graphql 7.1.0
  - Auth: Environment variable `GITHUB_ACCESS_TOKEN`
  - Implementation: `src/github/githubActions.ts`

## Data Storage

**Databases:**
- None - Application is stateless

**File Storage:**
- Local filesystem only - No external file storage service

**Caching:**
- In-memory store - `src/store.ts` maintains runtime cache of thread-to-issue mappings
- Discord cache - discord.js built-in channel/message caching

## Authentication & Identity

**Auth Provider:**
- Custom token-based authentication
  - Discord: Token-based bot authentication via `DISCORD_TOKEN`
  - GitHub: Personal access token authentication via `GITHUB_ACCESS_TOKEN`

**Implementation:**
- `src/config.ts` - Loads and validates environment variables
- Octokit clients initialized with tokens in `src/github/githubActions.ts`
- Discord client authenticated in `src/discord/discord.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected - No external error tracking service (Sentry, etc.)

**Logs:**
- Winston logger (3.13.0)
  - Implementation: `src/logger.ts`
  - Output: Console transport
  - Format: Colorized with timestamps (`MM-DD HH:mm:ss`)
  - Disabled: File logging (commented out in logger configuration)
  - Log levels: Info, Error, Warn (standard Winston levels)

## CI/CD & Deployment

**Hosting:**
- Self-hosted Node.js application
- Can be accessed via serveo.net SSH tunnel for local development

**CI Pipeline:**
- GitHub Actions workflow present (`.github/` directory exists)
- Build: Webpack compilation to `dist/`
- Node.js version support: 20.14+

## Environment Configuration

**Required env vars:**
- `DISCORD_TOKEN` - Discord bot application token
- `GITHUB_ACCESS_TOKEN` - GitHub personal access token (requires repo scope)
- `GITHUB_USERNAME` - GitHub repository owner
- `GITHUB_REPOSITORY` - GitHub repository name
- `DISCORD_CHANNEL_ID` - Discord forum/channel ID for issue threads

**Optional env vars:**
- `PORT` - HTTP server port (defaults to 5000)

**Secrets location:**
- `.env` file (local development, not committed)
- Environment variables passed to production runtime

## Webhooks & Callbacks

**Incoming (GitHub to App):**
- Endpoint: POST `/` on HTTP server (port 5000 by default)
- Actions handled:
  - `opened` - New issue opened
  - `created` - Comment created on issue
  - `closed` - Issue closed
  - `reopened` - Issue reopened
  - `locked` - Issue locked
  - `unlocked` - Issue unlocked
  - `deleted` - Issue deleted
- Implementation: `src/github/github.ts`, `src/github/githubHandlers.ts`

**Outgoing (App to Discord/GitHub):**
- Discord message creation and updates via discord.js client
- GitHub issue creation and updates via Octokit REST API
- No explicit webhook callbacks to external services

## Data Flow Integration

**Discord to GitHub Flow:**
1. Discord event (thread create/update, message create) triggers handler
2. Handler invokes GitHub API via Octokit to create/update issue
3. Issue body contains Discord message metadata (user avatar, channel link)
4. Issue stored with reference back to Discord thread ID

**GitHub to Discord Flow:**
1. GitHub webhook payload received at POST `/`
2. Action handler queries GitHub GraphQL API for issue details
3. Discord thread created/updated with issue information
4. Thread metadata stored with reference back to GitHub issue number

**Cross-Reference Storage:**
- Discord thread ID embedded in GitHub issue body (as Discord channel links)
- GitHub issue number stored in Discord thread store (`src/store.ts`)
- Regex pattern for extracting Discord info: `/https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?=\))/`

---

*Integration audit: 2026-02-28*
