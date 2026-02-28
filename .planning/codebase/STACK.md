# Technology Stack

**Analysis Date:** 2026-02-28

## Languages

**Primary:**
- TypeScript 5.4.5 - Entire application (`src/**/*.ts`)
- JavaScript - Configuration and build files (`webpack.config.js`, `tsconfig.json`)

## Runtime

**Environment:**
- Node.js - Target: ES2020

**Package Manager:**
- npm - Package management
- Lockfile: package-lock.json (present)
- Alternative: pnpm (pnpm-lock.yaml also present)

## Frameworks

**Core:**
- discord.js 14.15.3 - Discord bot client and event handling
- express 4.19.2 - HTTP server for GitHub webhook endpoints

**Build/Dev:**
- webpack 5.92.0 - Module bundler with TypeScript support via ts-loader
- tsx 4.15.4 - TypeScript execution for development and watch mode
- ts-loader 9.5.1 - Webpack TypeScript loader

**Code Quality:**
- eslint 8.57.0 - Linting (configured in `.eslintrc.json`)
- prettier 3.3.2 - Code formatting
- @typescript-eslint/eslint-plugin 6.21.0 - TypeScript-specific ESLint rules
- @typescript-eslint/parser 6.21.0 - TypeScript parser for ESLint

## Key Dependencies

**Critical:**
- discord.js 14.15.3 - Discord bot client with event-driven architecture, used for bidirectional integration with Discord
- @octokit/graphql 7.1.0 - GitHub GraphQL API client, used for GitHub issue queries
- @octokit/rest 20.1.1 - GitHub REST API client, used for issue creation and updates
- express 4.19.2 - Web framework for receiving GitHub webhooks
- dotenv 16.4.5 - Environment variable management for configuration
- winston 3.13.0 - Logging framework for application events and errors

**WebSocket Optimization:**
- bufferutil 4.0.8 - WebSocket performance optimization for discord.js
- utf-8-validate 6.0.4 - UTF-8 validation for WebSocket messages

**Type Definitions:**
- @types/express 4.17.21 - Express TypeScript type definitions
- @types/node 20.14.2 - Node.js TypeScript type definitions

## Configuration

**Environment:**
- Configuration file: `src/config.ts`
- Required environment variables:
  - `DISCORD_TOKEN` - Discord bot authentication token
  - `GITHUB_ACCESS_TOKEN` - GitHub personal access token for API authentication
  - `GITHUB_USERNAME` - GitHub repository owner username
  - `GITHUB_REPOSITORY` - GitHub repository name
  - `DISCORD_CHANNEL_ID` - Discord forum/channel ID for syncing issues
  - `PORT` - (Optional) HTTP server port, defaults to 5000

**Build Configuration:**
- `webpack.config.js` - Webpack bundler configuration
  - Entry: `src/index.ts`
  - Output: `dist/index.js`
  - Mode: development (production mode disabled due to bundling issue with discord.js ThreadCreate action)
  - Target: node
  - Optimization: minified

**Compiler Configuration:**
- `tsconfig.json` - TypeScript compiler options
  - Target: ES2020
  - Module: CommonJS
  - Root directory: `./src`
  - Output directory: `./dist`
  - Strict type checking enabled
  - esModuleInterop enabled for CommonJS compatibility
  - JSON module resolution enabled

**Code Quality Configuration:**
- `.eslintrc.json` - ESLint rules for TypeScript linting
- `.editorconfig` - Cross-editor formatting consistency

## Platform Requirements

**Development:**
- Node.js 20.14+ (based on @types/node version)
- npm or pnpm package manager

**Production:**
- Node.js runtime environment
- Network access to GitHub API (https://api.github.com)
- Network access to Discord Gateway
- Outbound HTTP port for receiving GitHub webhooks (default: 5000)

## Scripts

**Development:**
```bash
npm run dev        # Watch mode with tsx (rebuilds on file changes)
npm run build      # Webpack bundle compilation
npm run format     # Prettier code formatting
npm run lint       # ESLint with auto-fix
npm run forward    # SSH tunneling to serveo.net for local webhook testing
```

**Production:**
```bash
npm start          # Run compiled dist/index.js with Node.js
```

---

*Stack analysis: 2026-02-28*
