# Codebase Concerns

**Analysis Date:** 2026-02-28

## Tech Debt

**Incomplete TODO in Message Creation:**

- Issue: Line 38 in `src/discord/discordActions.ts` concatenates body and login with "/" but has a TODO comment indicating the logic is incomplete
- Files: `src/discord/discordActions.ts:38`
- Impact: Message format may not be correct; unclear what the intended final format should be
- Fix approach: Define the exact message format needed and implement complete logic

**Production Mode Webpack Configuration Not Supported:**

- Issue: `webpack.config.js` is hardcoded to "development" mode with a TODO comment stating that "production mode" fails because `client.actions.ThreadCreate.handle(packet.d)` throws an error due to 'ThreadCreate' being undefined
- Files: `webpack.config.js:6`
- Impact: Cannot build or deploy to production; the application only works in development mode
- Fix approach: Debug the discord.js integration to understand why ThreadCreate actions are undefined in production; likely a webpack bundling or tree-shaking issue

**Unused Catch Blocks:**

- Issue: Multiple locations use empty catch blocks or bare `console.error()` without proper handling
- Files: `src/discord/discordActions.ts:86, 88, 174`
- Impact: Errors are silently ignored or only logged to console; makes debugging difficult and may hide critical failures
- Fix approach: Replace with proper logger.error() calls or implement retry logic where appropriate

**Inconsistent Error Handling Patterns:**

- Issue: Different modules use different error handling approaches:
  - `githubActions.ts` returns error objects from functions and checks `instanceof Error`
  - `discordActions.ts` uses promise `.catch(console.error)` chains
  - `discordHandlers.ts` has a 500ms setTimeout hack for race conditions
- Files: `src/github/githubActions.ts:102`, `src/discord/discordActions.ts:86-88`, `src/discord/discordHandlers.ts:104-115`
- Impact: Error handling behavior is unpredictable; makes it hard to trace failures across the system
- Fix approach: Establish unified error handling: use try/catch everywhere, always use logger, consider implementing error recovery strategies

**Race Condition Workaround with Magic Timeout:**

- Issue: `discordHandlers.ts:104-115` uses a hardcoded 500ms setTimeout to work around a race condition between Discord's archive and lock operations
- Files: `src/discord/discordHandlers.ts:104-115`
- Impact: Fragile fix that may fail under network latency; no guarantee 500ms is sufficient for all cases
- Fix approach: Implement proper event sequencing or await Discord API operations before state transitions

## Known Bugs

**Thread Update Race Condition:**

- Symptoms: When locking an archived thread or archiving a locked thread, the Discord API operations may conflict
- Files: `src/discord/discordHandlers.ts:96-117`, `src/discord/discordActions.ts:111-145`
- Trigger: Quickly toggling lock/archive states on a thread; Discord webhook latency
- Workaround: Current implementation includes `lockArchiving` and `lockLocking` flags to track state

**Message ID vs Discord ID Mismatch:**

- Symptoms: Comment tracking uses Discord message IDs and Git comment IDs inconsistently; may delete wrong comments
- Files: `src/interfaces.ts:17-20`, `src/discord/discordHandlers.ts:135-144`, `src/github/githubActions.ts:273-286`
- Trigger: When Discord message gets deleted or Git comment gets deleted
- Current workaround: Comments array tracks both IDs but lookup only uses one

## Security Considerations

**No Input Validation on GitHub Webhooks:**

- Risk: Webhook payloads from GitHub are accessed directly without schema validation (req.body.issue.node_id, req.body.comment, etc.)
- Files: `src/github/github.ts:34`, `src/github/githubHandlers.ts:15-52`
- Current mitigation: Assumes well-formed GitHub webhook payloads
- Recommendations:
  - Validate webhook signature using GitHub's X-Hub-Signature header
  - Add type guards or schema validation (zod, joi) for req.body structure
  - Implement rate limiting on webhook endpoint

**No Authentication/Authorization on Express Endpoint:**

- Risk: GitHub webhook endpoint (`/`) accepts POST requests without any authentication; anyone could send fake webhooks
- Files: `src/github/github.ts:33-36`
- Current mitigation: None
- Recommendations:
  - Implement GitHub webhook signature verification (already mentioned above)
  - Add environment-based secret tokens
  - Consider implementing IP whitelisting for GitHub's webhook IPs

**Exposed Secrets in Environment Variables:**

- Risk: Discord and GitHub tokens stored in `.env` file; visible in process memory
- Files: `src/config.ts`, `.env`
- Current mitigation: Using dotenv; relies on `.env` being in `.gitignore`
- Recommendations:
  - Use GitHub Secrets for deployment
  - Consider rotating tokens regularly
  - Implement token encryption at rest

**Type Assertions Bypass Type Safety:**

- Risk: Multiple unsafe type assertions (`<ThreadChannel | undefined>`, `<GitHubLabel[]>`) that could cause runtime errors
- Files: `src/discord/discordActions.ts:167, 172`, `src/github/githubHandlers.ts:25`
- Current mitigation: None
- Recommendations:
  - Use type guards instead of type assertions
  - Enable `noImplicitAny` and `noUncheckedIndexedAccess` in tsconfig

**SQL Injection-like Vulnerability in GraphQL Query:**

- Risk: Direct string interpolation in GraphQL mutation without escaping
- Files: `src/github/githubActions.ts:261`
- Current mitigation: Only uses node_id from internal state, but still poor practice
- Recommendations:
  - Use proper GraphQL variables instead of string interpolation
  - Example: Use graphql template with variables instead of `` `mutation {deleteIssue(input: {issueId: "${node_id}"}) {clientMutationId}}` ``

## Performance Bottlenecks

**Full Issues List Fetched on Startup:**

- Problem: `handleClientReady()` fetches ALL issues and ALL comments on startup
- Files: `src/discord/discordHandlers.ts:30`, `src/github/githubActions.ts:289-312, 314-338`
- Cause: No pagination; for repos with hundreds of issues, this causes long startup time and memory usage
- Improvement path:
  - Implement pagination in `getIssues()` and `fillCommentsData()`
  - Consider caching or storing in local database
  - Load issues on-demand rather than all at startup

**Promise.all() with No Error Boundaries:**

- Problem: `handleClientReady()` uses `Promise.all()` to fetch all thread channels; if one fails, entire promise chain breaks
- Files: `src/discord/discordHandlers.ts:52`
- Cause: No `Promise.allSettled()` or individual error handling
- Improvement path:
  - Use `Promise.allSettled()` instead
  - Log individual failures without blocking others

**Repeated Store Lookups:**

- Problem: Multiple `.find()` calls on `store.threads` array; O(n) for each lookup
- Files: `src/discord/discordActions.ts:164`, `src/discord/discordHandlers.ts:93, 124, 137, 150`
- Cause: No indexing structure; linear search for every operation
- Improvement path:
  - Consider using Map<id, Thread> instead of array
  - Or add memoization for frequent lookups

**No Connection Pooling for API Calls:**

- Problem: Each operation creates new Octokit instance or webhook
- Files: `src/github/githubActions.ts:15-17`, `src/discord/discordActions.ts:71-72`
- Cause: No singleton or factory pattern for clients
- Improvement path:
  - Reuse single Octokit instance (already done)
  - Batch webhook operations where possible

## Fragile Areas

**Discord Thread and Message Reconciliation:**

- Files: `src/discord/discordHandlers.ts`, `src/discord/discordActions.ts`, `src/github/githubActions.ts`
- Why fragile: Two-way sync between Discord and GitHub is complex:
  - Thread IDs may not exist in cache
  - Messages may be partially deleted
  - Archive/Lock state can get out of sync if operations fail
  - Race conditions between Discord and GitHub API calls
- Safe modification:
  - Add comprehensive logging before any sync operation
  - Implement idempotency for all two-way operations
  - Add transaction-like semantics or state machines
  - Test with network delays and API failures
- Test coverage: No test suite exists; all changes are untested

**Comment Tracking Logic:**

- Files: `src/interfaces.ts:17-20`, `src/discord/discordHandlers.ts:135-144`, `src/github/githubActions.ts:236-250, 273-286`
- Why fragile: Dual ID system (Discord ID + Git ID) creates synchronization challenges:
  - Deleting Discord message requires finding corresponding Git comment by Discord ID first
  - Deleting Git comment requires finding Discord message by Git ID first
  - If either lookup fails, orphaned data remains
- Safe modification:
  - Verify both IDs before deletion
  - Add cleanup process for orphaned comments
  - Test edge cases: rapid deletes, missing IDs
- Test coverage: No tests for comment lifecycle

**GraphQL Query Construction:**

- Files: `src/github/githubActions.ts:260-262`
- Why fragile: String interpolation in GraphQL; would break with special characters in node_id
- Safe modification:
  - Refactor to use graphql template variables
  - Add validation of node_id format before constructing query
  - Add error handling for malformed queries
- Test coverage: No tests

**Express Error Handling:**

- Files: `src/github/github.ts:33-36`
- Why fragile: Webhook handlers are async but errors are not caught:
  - `githubAction && githubAction(req)` has no await
  - If handler throws, exception is unhandled
  - Response is sent immediately without waiting for handler completion
- Safe modification:
  - Wrap handler call in try/catch
  - Add proper error response
  - Consider queuing webhooks for processing instead of fire-and-forget
- Test coverage: No tests

## Scaling Limits

**In-Memory State Only:**

- Current capacity: Limited by available RAM; typical: 10k-100k threads
- Limit: Process restart loses all thread data; must re-fetch from GitHub/Discord
- Scaling path:
  - Add database layer (SQLite, PostgreSQL, MongoDB)
  - Persist thread state on disk
  - Implement caching strategy for frequently accessed threads

**Single-Process Only:**

- Current capacity: One Node.js process; single Discord bot connection
- Limit: Cannot handle multiple Discord servers; cannot scale horizontally
- Scaling path:
  - Implement session persistence for multi-process support
  - Add database-backed session store
  - Consider Discord bot sharding for multiple servers

**No Rate Limiting:**

- Current capacity: Subject to GitHub and Discord API rate limits
- Limit: Burst operations (batch comment creation) will hit rate limits
- Scaling path:
  - Implement request queuing with exponential backoff
  - Add rate limit tracking and adaptive throttling
  - Consider batching operations

## Dependencies at Risk

**discord.js v14.15.3:**

- Risk: Production mode breaks due to webpack bundling issue with ThreadCreate action; requires development mode workaround
- Impact: Cannot deploy to production; stuck in development mode
- Migration plan:
  - Upgrade to latest discord.js v14.x
  - Debug webpack configuration or switch to esbuild
  - Test thoroughly before deploying

**Hardcoded Compression Disabling in Discord Client:**

- Risk: Custom WebSocket strategy disables compression, increasing bandwidth usage
- Files: `src/discord/discord.ts:25-35`
- Impact: Higher memory/network costs; no clear reason documented for why this is needed
- Migration plan:
  - Document why compression was disabled
  - Test re-enabling compression
  - Consider removing if not needed

**Express as Webhook Server:**

- Risk: No validation, rate limiting, or sophisticated error handling in raw Express
- Impact: Webhook processing is brittle and could fail silently
- Migration plan:
  - Add middleware for webhook validation
  - Add proper error handling and response codes
  - Consider using webhook libraries (e.g., octokit/webhooks)

## Missing Critical Features

**No Request Validation:**

- Problem: GitHub webhooks processed without checking structure or signature
- Blocks: Cannot guarantee data integrity; vulnerable to malformed requests
- Priority: HIGH - Security and stability risk

**No Persistence Layer:**

- Problem: All thread state in memory; lost on process restart
- Blocks: Cannot reliably track issue-to-thread mappings across restarts
- Priority: HIGH - Data loss risk

**No Error Recovery:**

- Problem: Failed operations are logged but not retried or queued
- Blocks: If GitHub/Discord API temporarily fails, changes are silently dropped
- Impact: Silent data loss or desynchronization between systems
- Priority: HIGH - Data integrity risk

**No Transaction-like Semantics:**

- Problem: Two-way sync (create Discord thread AND GitHub issue) has no rollback if one fails
- Blocks: Can leave partial state if one API call fails after other succeeds
- Priority: MEDIUM - Data inconsistency risk

**No Monitoring or Observability:**

- Problem: Only basic winston logging; no metrics, alerts, or dashboards
- Blocks: Cannot detect issues until user reports; no SLA tracking
- Priority: MEDIUM - Operational risk

**No Tests:**

- Problem: Zero test coverage; all critical paths untested
- Blocks: Refactoring is dangerous; regressions undetected
- Priority: HIGH - Regression risk

## Test Coverage Gaps

**Two-Way Sync Operations:**

- What's not tested: Thread creation from Discord, issue creation from GitHub, comment sync in both directions, state synchronization (archive/lock)
- Files: `src/discord/discordHandlers.ts`, `src/github/githubHandlers.ts`, `src/discord/discordActions.ts`, `src/github/githubActions.ts`
- Risk: Complex bidirectional logic has race conditions and edge cases; undetected failures silent
- Priority: HIGH

**Error Handling Paths:**

- What's not tested: API failures, malformed responses, network timeouts, missing IDs in state
- Files: `src/github/githubActions.ts`, `src/discord/discordActions.ts`
- Risk: Error conditions cause crashes or silent failures; recovery paths untested
- Priority: HIGH

**Edge Cases:**

- What's not tested:
  - Thread deleted in Discord but exists in GitHub
  - Comment created in GitHub but Discord message not found
  - Webhook received for thread not in store
  - Rapid state changes (quick lock/archive/unlock/unarchive)
- Files: All handler files
- Risk: Orphaned data, inconsistent state, crashes
- Priority: MEDIUM

**Configuration and Initialization:**

- What's not tested: Missing environment variables, invalid Discord channel IDs, authentication failures
- Files: `src/config.ts`, `src/discord/discordHandlers.ts`, `src/github/github.ts`
- Risk: Application starts with invalid configuration or fails to initialize cleanly
- Priority: MEDIUM

---

_Concerns audit: 2026-02-28_
