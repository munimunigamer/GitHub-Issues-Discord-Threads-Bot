# Testing Patterns

**Analysis Date:** 2026-02-28

## Test Framework

**Status:** Not Configured

**Note:** No test framework, runner, or test files are currently configured in this project. Testing infrastructure is absent.

- **Test Runner:** Not installed
- **Assertion Library:** Not installed
- **Test Configuration:** No jest.config.js, vitest.config.js, or equivalent exists

## Test File Organization

**Location:** Not applicable - no test files exist

**Pattern:** Not applicable

**Directory Structure:** Not applicable

## Run Commands

**Current Scripts (from package.json):**
```bash
npm run dev           # Development: tsx watch src/index.ts
npm start             # Production: node .
npm run build         # Build: webpack
npm run format        # Lint formatting: prettier --write "**/*.{json,ts}"
npm run lint          # Lint with fixes: eslint . --ext ts --fix
npm run forward       # SSH tunnel: ssh -R 80:localhost:5000 serveo.net
```

**No test commands exist.** To add testing, would need:
```bash
# Example commands (not currently available)
npm test              # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

## Testing Gap Analysis

**What is NOT Tested:**

1. **Discord Event Handlers** (`src/discord/discordHandlers.ts`):
   - `handleClientReady()` - Client initialization and thread loading
   - `handleThreadCreate()` - Thread creation event handling
   - `handleThreadUpdate()` - Thread state changes (archive/lock)
   - `handleMessageCreate()` - Message creation triggering issue creation
   - `handleMessageDelete()` - Comment deletion from Discord
   - `handleThreadDelete()` - Thread deletion triggering issue deletion

2. **Discord Actions** (`src/discord/discordActions.ts`):
   - `createThread()` - Thread creation in forum channel
   - `createComment()` - Discord webhook message creation
   - `archiveThread()` / `unarchiveThread()` - Thread archive state
   - `lockThread()` / `unlockThread()` - Thread lock state with special archive handling
   - `deleteThread()` - Thread deletion
   - `getThreadChannel()` - Channel fetching with cache fallback

3. **GitHub Actions** (`src/github/githubActions.ts`):
   - API calls: `closeIssue()`, `openIssue()`, `lockIssue()`, `unlockIssue()`
   - Issue/comment creation: `createIssue()`, `createIssueComment()`
   - Issue/comment deletion: `deleteIssue()`, `deleteComment()`
   - Data retrieval: `getIssues()`, `fillCommentsData()`
   - Helper functions: `getDiscordInfoFromGithubBody()`, `attachmentsToMarkdown()`, `formatIssuesToThreads()`

4. **GitHub Webhook Handlers** (`src/github/githubHandlers.ts`):
   - GitHub webhook event routing: `handleOpened()`, `handleCreated()`, `handleClosed()`, `handleReopened()`, `handleLocked()`, `handleUnlocked()`, `handleDeleted()`

5. **Store** (`src/store.ts`):
   - `Store` class: Thread array management
   - `deleteThread()` - Thread removal from store
   - Store initialization and state mutation

6. **Configuration** (`src/config.ts`):
   - Environment variable validation
   - Config object structure

7. **Integration Points:**
   - Discord.js client integration
   - GitHub API (Octokit) integration
   - Express webhook server

## Recommended Testing Approach

**Framework Recommendation:** Jest or Vitest

**Setup Approach:**
1. Install test framework: `npm install --save-dev jest @types/jest ts-jest` or `vitest`
2. Create test configuration file
3. Set up mocking for external dependencies (discord.js, octokit, express)
4. Create test files co-located or in `tests/` directory

**Mocking Strategy (Required):**

External dependencies that must be mocked:
- `discord.js` - Client, Channel, Thread, Message objects
- `@octokit/rest` - REST API client and responses
- `@octokit/graphql` - GraphQL mutations
- `express` - Request/Response objects
- `winston` - Logger

**Example Mock Pattern:**
```typescript
// Mock example (not currently used)
jest.mock("discord.js", () => ({
  Client: jest.fn(),
  Events: { ClientReady: "ready" },
}));

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn(() => ({
    rest: {
      issues: {
        create: jest.fn(),
        update: jest.fn(),
      },
    },
  })),
}));
```

## Test Complexity Factors

**High Complexity Areas Requiring Careful Testing:**

1. **Thread State Synchronization** (`discordHandlers.ts` lines 89-117):
   - Complex logic for archive/lock with 500ms timeout
   - Flags to prevent cascading updates: `lockArchiving`, `lockLocking`
   - Requires simulating Discord event timing

2. **Async Promise Chains** (`discordActions.ts`):
   - Creates webhook, sends message, deletes webhook in chain
   - Error handling scattered across `.catch()` blocks
   - Needs testing of partial failures

3. **Message Body Parsing** (`githubActions.ts` lines 52-71):
   - Regex extraction of Discord URLs from GitHub issue bodies
   - Fallback behavior when regex doesn't match
   - Multiple nested objects and optional fields

4. **Store Initialization** (`discordHandlers.ts` lines 30-55):
   - Loads issues from GitHub API
   - Fetches Discord thread channels to validate
   - Filters invalid threads
   - Needs mocking of async API calls

## Data Flow for Testing

**Example Test Scenario: Issue Creation**
1. GitHub webhook POST to `/`
2. Action identified: `handleOpened()`
3. Extract issue data: `title`, `body`, `node_id`, `labels`
4. Map labels to Discord tags
5. Call `createThread()` with Discord forum channel
6. Thread created, stored in `store.threads`
7. Log action with `info()` helper

**Example Test Scenario: Message to Comment**
1. Discord message created in forum thread
2. `handleMessageCreate()` triggered
3. Find thread in `store.threads` by `channelId`
4. Check if thread has `body` (determines new issue vs comment)
5. Call `createIssueComment()` if thread exists
6. Extract message content and attachments
7. Create webhook with author name/avatar
8. Send message to GitHub issue
9. Clean up webhook
10. Log action

## Current Testing State

**Test Coverage:** 0% - No tests written

**Static Analysis:**
- ESLint enforces code quality rules
- TypeScript strict mode catches type errors at compile time
- No runtime test suite

**Manual Testing Approach (Current):**
- `npm run dev` runs application in watch mode
- Console logging via Winston for debugging
- Manual verification of Discord/GitHub sync

## Suggested Test Priorities (If Testing Were to Be Added)

**High Priority (Critical Paths):**
1. Discord thread creation and synchronization
2. GitHub issue creation and synchronization
3. Store state management
4. Error handling in async operations

**Medium Priority:**
1. Thread state transitions (archive/lock/unlock)
2. Message to comment conversion
3. Comment deletion handling

**Low Priority:**
1. Configuration loading
2. Logger functionality
3. Helper functions (regex, formatting)

## Configuration Files Status

**ESLint** (`.eslintrc.json`):
- Configured for TypeScript linting
- No test-specific rules
- Plugin: `@typescript-eslint/eslint-plugin`

**TypeScript** (`tsconfig.json`):
- Strict type checking enabled
- Configured for CommonJS output (runnable with Node.js)
- No test-specific compiler options

**Package.json**:
- No test dependencies listed
- No test scripts defined
- No testing framework in devDependencies

---

*Testing analysis: 2026-02-28*

**Note:** This codebase currently lacks automated testing infrastructure. Before making significant changes, consider adding Jest or Vitest and establishing test coverage for critical integration points between Discord and GitHub APIs.
