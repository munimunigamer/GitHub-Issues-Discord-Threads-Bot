# Coding Conventions

**Analysis Date:** 2026-02-28

## Naming Patterns

**Files:**
- PascalCase for module files: `discord.ts`, `discordActions.ts`, `discordHandlers.ts`
- camelCase for utility/config files: `config.ts`, `logger.ts`, `store.ts`, `interfaces.ts`
- Directory names use lowercase with underscores avoided: `src/discord/`, `src/github/`

**Functions:**
- camelCase for all function names: `createThread()`, `handleClientReady()`, `getIssues()`, `attachmentsToMarkdown()`
- Prefix handlers with "handle": `handleThreadCreate()`, `handleMessageCreate()`, `handleClientReady()`
- Prefix getters with "get": `getThreadChannel()`, `getIssueNodeId()`, `getDiscordUrl()`, `getGithubUrl()`
- Prefix creators with "create": `createThread()`, `createIssue()`, `createComment()`
- Verb-noun pattern for action functions: `closeIssue()`, `lockThread()`, `deleteThread()`

**Variables:**
- camelCase for all variables and constants: `config`, `client`, `store`, `logger`
- SCREAMING_SNAKE_CASE for true constants: None currently used, environment variables handled separately
- Descriptive names: `appliedTags`, `node_id`, `git_id`, `availableTags`, `parentId`, `channelId`, `guildId`
- Single letter for loop variables in forEach: `(i) =>`, `(item) =>`, `(thread) =>`, `(tag) =>`

**Types:**
- PascalCase for all interfaces and types: `Thread`, `ThreadComment`, `GitIssue`, `GitHubLabel`, `GithubHandlerFunction`, `ActionValue`
- Suffix handler functions with "Function": `GithubHandlerFunction`
- Export interfaces explicitly from `interfaces.ts`

## Code Style

**Formatting:**
- Tool: Prettier (configured via eslint-config-prettier)
- Enforced through `npm run format` which writes with `prettier --write "**/*.{json,ts}"`
- Line length: Default Prettier settings (80 characters)
- Indentation: 2 spaces (default Prettier)

**Linting:**
- Tool: ESLint 8.57.0 with TypeScript support
- Config: `.eslintrc.json`
- Parser: `@typescript-eslint/parser`
- Run with: `npm run lint` (applies --fix automatically)

**Key ESLint Rules:**
- Semicolons required: `"semi": ["warn", "always"]` - All statements must end with semicolon
- Double quotes required: `"quotes": ["warn", "double"]` - Use double quotes only
- Arrow function parentheses required: `"arrow-parens": ["warn", "always"]` - `(param) => {}` not `param => {}`
- Unused variables: `"no-unused-vars": "warn"` - Warns but doesn't block; disabled in comments with `// eslint-disable-next-line no-unused-vars`
- Console allowed: `"no-console": "off"` - console.log/error permitted throughout
- Named exports preferred: `"import/prefer-default-export": "off"` - Mix of default and named exports allowed

## Import Organization

**Order:**
1. External library imports (discord.js, express, @octokit, winston, dotenv)
2. Internal absolute imports (from src/ - no relative paths observed)
3. Type-only imports mixed with regular imports (not separated)

**Examples:**
```typescript
// External libraries first
import { Client, Events, GatewayIntentBits } from "discord.js";
import express from "express";
import { graphql } from "@octokit/graphql";
import winston, { format } from "winston";

// Internal imports
import { config } from "../config";
import { Thread } from "../interfaces";
import { store } from "../store";
import client from "./discord/discord";
```

**Path Style:**
- Relative imports using `../` for navigation between modules
- No path aliases or baseUrl configuration in tsconfig.json
- No barrel files (index.ts re-exports) currently used

**Default vs Named:**
- Module exports used: `export const config = {}`
- Default exports used: `export default client`, `export default app`
- Mixed pattern acceptable per ESLint config

## Error Handling

**Patterns:**
- Try-catch blocks for async operations: Used extensively in `githubActions.ts`
- Error type checking: `if (err instanceof Error)` pattern used to distinguish Error objects from unknown types
- Graceful degradation: Return undefined/empty array on errors rather than throwing

**Examples:**
```typescript
// Try-catch with instance checking
try {
  const response = await octokit.rest.issues.lock({ ... });
  info(Actions.Locked, thread);
} catch (err) {
  if (err instanceof Error) {
    error(`Failed to lock issue: ${err.message}`, thread);
  } else {
    error("Failed to lock issue due to an unknown error", thread);
  }
}

// Return handling for async operations
.then(({ id }) => {
  const thread = store.threads.find((thread) => thread.id === id);
  if (!thread) return;
  // Continue processing
})
.catch(console.error);

// Guard clauses at function start
export async function closeIssue(thread: Thread) {
  const { number: issue_number } = thread;

  if (!issue_number) {
    error("Thread does not have an issue number", thread);
    return;
  }
  // Continue...
}
```

**Error Logging:**
- Use Winston logger with `logger.info()` and `logger.error()`
- Use helper functions: `info()` and `error()` wrap logger with context
- No silent failures; all errors logged to console or logger
- Some catch blocks use `.catch(console.error)` for promise chains

## Logging

**Framework:** Winston 3.13.0

**Patterns:**
- Create logger instance in `logger.ts` with Console transport
- Format includes timestamp `MM-DD HH:mm:ss` and colored output
- Log levels: `info` and `error`
- Helper functions provide context: `info(action, thread)` and `error(message, thread)`

**Usage:**
```typescript
import { logger } from "./logger";

// Simple logging
logger.info(`Logged in as ${client.user?.tag}!`);
logger.error("Some error occurred");

// Context-aware logging via helpers
info(Actions.Created, thread);  // Logs triggerer, action, and URL
error("Failed to create issue", thread);
```

## Comments

**When to Comment:**
- ESLint rules suppressed with comment: `// eslint-disable-next-line [rule]`
- TODO markers used for known issues: `// TODO` (one instance in `discordActions.ts` line 38)
- Empty catch blocks commented: `/* empty */` (used in `discordActions.ts`)

**JSDoc/TSDoc:**
- Minimal JSDoc usage; no formal JSDoc blocks observed
- Types documented through TypeScript interfaces and type annotations
- Function signatures are self-documenting via parameter types

**Example:**
```typescript
// eslint-disable-next-line no-unused-vars
type GithubHandlerFunction = (req: Request) => void;

try {
  const fetchChanel = await client.channels.fetch(thread.id);
  channel = <ThreadChannel | undefined>fetchChanel;
} catch (err) {
  /* empty */
}
```

## Function Design

**Size:** Functions range from 2 lines (simple handlers) to 50+ lines (complex operations like `handleThreadUpdate`)
- Prefer smaller, focused handler functions
- Keep business logic in action files (`discordActions.ts`, `githubActions.ts`)
- Keep integration/event handling in handler files (`discordHandlers.ts`, `githubHandlers.ts`)

**Parameters:**
- Destructure object parameters: `({ body, login, title, appliedTags, node_id, number }: { body: string; ... })`
- Inline type definitions for parameter objects
- Avoid positional parameters; use objects for clarity

**Return Values:**
- Functions that may fail return `undefined` on error rather than throwing
- Async functions often return Promise<void> (fire and forget for Discord API calls)
- Some functions return typed objects: `Promise<{ channel: ThreadChannel | undefined; thread: Thread | undefined }>`
- No explicit return statements required in handlers (returns implicitly undefined)

## Module Design

**Exports:**
- Default exports: Used for singleton instances (`export default client`)
- Named exports: Preferred for functions and types (`export function createThread()`, `export { Thread }`)
- Mixed approach acceptable per config

**Module Boundaries:**
- `src/discord/` - Discord.js client initialization and event handlers
- `src/github/` - GitHub API interactions and webhook handlers
- `src/` - Core config, logging, store, and interfaces

**Barrel Files:**
- Not used; no `index.ts` re-export files observed
- Direct imports from specific modules required

## Type System

**TypeScript Version:** 5.4.5

**Configuration:**
- Strict mode enabled: `"strict": true`
- ES2020 target output
- CommonJS module format
- JSON module resolution enabled

**Type Patterns:**
- Nullable types used: `Thread | undefined`, `number | undefined`, `boolean | null`
- Union types for states: `"open" | "closed"`, `ActionValue = typeof Actions[keyof typeof Actions]`
- Type assertions used sparingly: `<ThreadChannel | undefined>fetchChanel`, `(<GitHubLabel[]>labels)`
- No optional chaining overuse; guard clauses preferred

**Example Type Definition:**
```typescript
interface Thread {
  id: string;
  title: string;
  appliedTags: string[];
  number?: number;
  body?: string;
  archived: boolean | null;
  locked: boolean | null;
  comments: ThreadComment[];
}
```

---

*Convention analysis: 2026-02-28*
