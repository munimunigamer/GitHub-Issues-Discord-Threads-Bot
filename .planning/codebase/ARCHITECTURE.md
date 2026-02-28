# Architecture

**Analysis Date:** 2026-02-28

## Pattern Overview

**Overall:** Event-Driven Dual-Client Synchronization

**Key Characteristics:**
- Two independent client systems that communicate through a shared store
- Discord.js listens to Discord events and triggers GitHub API calls
- Express.js receives GitHub webhooks and triggers Discord API calls
- Bidirectional synchronization with conflict resolution via state flags
- In-memory thread store acts as shared state between systems

## Layers

**Entry Point Layer:**
- Purpose: Bootstrap and initialize both systems
- Location: `src/index.ts`
- Contains: Application initialization
- Depends on: Discord init, GitHub init
- Used by: Node.js runtime

**Discord Client Layer:**
- Purpose: Manage Discord bot connection and event handling
- Location: `src/discord/discord.ts`
- Contains: Discord.js client instantiation, event listener registration
- Depends on: discord.js library, discord handlers
- Used by: Discord event system

**GitHub Webhook Layer:**
- Purpose: Receive and route GitHub webhook events
- Location: `src/github/github.ts`
- Contains: Express.js server setup, webhook routing
- Depends on: express, github handlers
- Used by: GitHub webhook delivery system

**Event Handler Layer:**
- Purpose: React to specific events from Discord or GitHub
- Location: `src/discord/discordHandlers.ts`, `src/github/githubHandlers.ts`
- Contains: Event-specific business logic, store updates, action triggering
- Depends on: Store, Actions layer, Interfaces, Logger
- Used by: Client layers

**Action Layer:**
- Purpose: Execute API calls and perform state mutations
- Location: `src/discord/discordActions.ts`, `src/github/githubActions.ts`
- Contains: Discord API calls, GitHub API calls, data transformations
- Depends on: Octokit, discord.js, Store, Config
- Used by: Handler layer

**Shared State Layer:**
- Purpose: Maintain synchronized state between Discord and GitHub
- Location: `src/store.ts`
- Contains: In-memory thread array, available tags cache
- Depends on: Interfaces
- Used by: All handlers and actions

**Configuration Layer:**
- Purpose: Manage environment variables and API credentials
- Location: `src/config.ts`
- Contains: Validated environment variable extraction
- Depends on: dotenv
- Used by: Clients and API wrappers

**Utilities Layer:**
- Purpose: Provide logging and shared helpers
- Location: `src/logger.ts`, `src/interfaces.ts`
- Contains: Winston logger, type definitions, action enums
- Depends on: winston
- Used by: All other layers

## Data Flow

**Discord Thread Create → GitHub Issue:**

1. User creates thread in Discord forum channel
2. Discord.js emits `ThreadCreate` event
3. `handleThreadCreate()` adds thread to store with basic metadata
4. User posts first message in thread
5. `handleMessageCreate()` detects thread has no `body` and calls `createIssue()`
6. `createIssue()` makes REST call to GitHub API via Octokit
7. GitHub issue created with Discord thread metadata in body
8. Response contains GitHub issue number and node_id
9. Store updated with issue metadata (number, node_id, body)
10. Logger records action

**GitHub Issue Comment → Discord Message:**

1. GitHub API receives comment via webhook
2. Express webhook handler routes to `handleCreated()`
3. Handler checks comment body for existing Discord link (prevents duplicates)
4. If new comment, calls `createComment()` to post in Discord thread
5. Comment authenticated via webhook using temporary webhook for author avatar
6. Discord message ID stored in `thread.comments` array alongside GitHub comment ID
7. Logger records action

**Discord Thread Archive → GitHub Issue Close:**

1. User archives Discord thread
2. Discord.js emits `ThreadUpdate` event
3. `handleThreadUpdate()` detects `archived` state change
4. Calls `closeIssue()` with thread metadata
5. GitHub API updates issue state to "closed"
6. Thread store state updated
7. Logger records action

**State Management:**

The `store` singleton in `src/store.ts` maintains:
- `threads[]`: Array of Thread objects with:
  - Discord metadata: `id`, `title`, `appliedTags`, `archived`, `locked`
  - GitHub metadata: `number`, `node_id`, `body`
  - Cross-system metadata: `comments[]` mapping Discord message IDs to GitHub comment IDs
- `availableTags[]`: Forum channel tags fetched on client ready

Lock flags (`lockArchiving`, `lockLocking`) prevent race conditions when Discord state changes trigger API calls that might trigger events again.

## Key Abstractions

**Thread:**
- Purpose: Represents a Discord thread and its paired GitHub issue
- Examples: `src/interfaces.ts` Thread interface, `src/store.ts` threads array
- Pattern: Data structure with metadata from both systems

**ThreadComment:**
- Purpose: Maps Discord message to GitHub comment for deletion sync
- Examples: `src/interfaces.ts` ThreadComment interface
- Pattern: Bidirectional ID mapping

**Discord Actions:**
- Purpose: API operations on Discord side (create thread, archive, etc.)
- Examples: `src/discord/discordActions.ts` (createThread, archiveThread, etc.)
- Pattern: Async functions taking Thread metadata, no return values

**GitHub Actions:**
- Purpose: API operations on GitHub side (create issue, close, etc.)
- Examples: `src/github/githubActions.ts` (createIssue, closeIssue, etc.)
- Pattern: Async functions with comprehensive error handling

**Client Wrappers:**
- Purpose: Encapsulate external API clients
- Examples: `octokit` from Octokit REST, `client` from discord.js
- Pattern: Singleton instances exported for use in actions

## Entry Points

**Discord Entry Point:**
- Location: `src/discord/discord.ts` - `initDiscord()`
- Triggers: Application start
- Responsibilities:
  - Create Discord.js client with gateway intents
  - Register event listeners for all relevant Discord events
  - Load existing issues from GitHub on client ready
  - Login to Discord

**GitHub Entry Point:**
- Location: `src/github/github.ts` - `initGithub()`
- Triggers: Application start
- Responsibilities:
  - Start Express.js server on port 5000
  - Register webhook route handler
  - Map webhook action types to handler functions

**Application Entry Point:**
- Location: `src/index.ts`
- Triggers: `npm start` or `node dist/index.js`
- Responsibilities:
  - Import and call initDiscord() and initGithub()
  - Both systems run concurrently

## Error Handling

**Strategy:** Comprehensive try-catch with logging, graceful degradation

**Patterns:**

All API calls wrapped in try-catch:
```typescript
try {
  const response = await octokit.rest.issues.create({...});
  if (response && response.data) {
    // Process success
    info(Actions.Created, thread);
  } else {
    error("Failed to create issue - No response data", thread);
  }
} catch (err) {
  if (err instanceof Error) {
    error(`Failed to create issue: ${err.message}`, thread);
  } else {
    error("Failed to create issue due to an unknown error", thread);
  }
}
```

Discord handlers validate parent channel and thread existence before processing:
```typescript
if (params.parentId !== config.DISCORD_CHANNEL_ID) return;
const thread = store.threads.find((item) => item.id === params.id);
if (!thread) return;
```

Failed operations don't block the process; errors logged and execution continues.

## Cross-Cutting Concerns

**Logging:**

Winston logger in `src/logger.ts` with:
- Console transport only (file logging commented out)
- Timestamp format: MM-DD HH:mm:ss
- Action tracking: Triggerer (discord->github or github->discord) + Action + URL
- Examples:
  ```
  github->discord | created | https://discord.com/channels/.../threads/...
  discord->github | closed | https://github.com/.../issues/123
  ```

**Validation:**

Environment config validation at startup in `src/config.ts`:
- Throws error if any required env var missing
- Required vars: DISCORD_TOKEN, GITHUB_ACCESS_TOKEN, GITHUB_USERNAME, GITHUB_REPOSITORY, DISCORD_CHANNEL_ID

**Authentication:**

- Discord: Token-based via `config.DISCORD_TOKEN`
- GitHub: Access token via `config.GITHUB_ACCESS_TOKEN` passed to Octokit
- Webhook comments: Temporary webhook created per comment for proper attribution

**Conflict Resolution:**

Two-phase commit pattern with flags:
- `lockArchiving`, `lockLocking`: Prevent cascading state changes
- When Discord thread archive/lock triggered, set flag before API call
- When response event comes back, flag prevents re-syncing same change
- Timeout mechanism (500ms) ensures proper sequencing

---

*Architecture analysis: 2026-02-28*
