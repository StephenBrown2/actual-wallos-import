# Copilot Instructions for actual-wallos-import

## Project Overview

Single-file TypeScript CLI tool that imports subscription data from [Wallos](https://github.com/ellite/Wallos) into [Actual Budget](https://actualbudget.org/) as scheduled transactions. No build step—run directly with `npx ts-node`.

## Architecture

**Single entry point**: All logic lives in [actual-wallos-import.ts](../actual-wallos-import.ts) (~640 lines), organized into clear sections:
- **Types** (lines 28-80): `WallosSubscription`, `ParsedWallosSubscription`, `RecurConfig`, `Account`
- **Interactive prompts** (lines 85-145): readline-based user input for account selection
- **Parsers** (lines 150-300): Payment cycle parsing, price parsing, JSON/API response handling
- **Wallos API** (lines 305-355): Direct API fetching with Bearer auth
- **Argument parsing** (lines 360-420): CLI flag handling
- **Main import logic** (lines 425-639): Actual Budget API integration

## Key Patterns

### Amount Handling
Amounts are stored as **negative integers in cents** (expenses are negative):
```typescript
// Convert to cents, negate for expense
amount: -Math.round(price * 100)
```

### Payment Cycle Parsing
The `parsePaymentCycle()` function handles various Wallos formats → Actual's frequency/interval:
- Simple: "monthly", "yearly", "weekly", "daily"
- Interval: "Every 2 Months", "Every 3 Weeks"  
- Special: "Quarterly" → monthly/3, "Biweekly" → weekly/2

### Account Matching Priority
1. Payment method name matches account name
2. Notes field matches account name  
3. Default account from `--account` flag
4. Interactive prompt (user selects from list)

### Error Handling
Uses `console.warn` for recoverable issues (unrecognized payment cycles default to monthly), throws for fatal errors (invalid file format, API failures).

## Development Commands

```bash
# Run with JSON file
npx ts-node actual-wallos-import.ts --file subscriptions.json --account "Credit Card"

# Run with Wallos API (requires WALLOS_URL and WALLOS_API_KEY env vars)
npx ts-node actual-wallos-import.ts --api --account "Credit Card"
```

## Version Control

Prefer **jujutsu (`jj`)** over git when available. Fall back to git if `jj` is not installed.

```bash
# Check status
jj st          # preferred
git status     # fallback

# View log
jj log         # preferred
git log        # fallback
```

## Environment Variables

| Variable | Mode | Description |
|----------|------|-------------|
| `ACTUAL_DATA_DIR` | Both | Data directory (default: `./actual-data`) |
| `ACTUAL_BUDGET_ID` | Both | Budget ID (uses first available if omitted) |
| `ACTUAL_SERVER_URL` | Both | Sync server URL |
| `ACTUAL_PASSWORD` | Both | Sync server password |
| `WALLOS_URL` | API | Wallos instance base URL |
| `WALLOS_API_KEY` | API | Wallos API key |

## External Dependencies

- **@actual-app/api**: Budget management, payee/schedule creation, sync
- **uuid**: Generate unique IDs for parsed subscriptions (v4)
- **Node built-ins**: `fs`, `readline`

## When Modifying

- **Adding payment cycle formats**: Update `parsePaymentCycle()` switch/regex patterns
- **New data sources**: Follow `fetchFromWallosApi()` pattern—return `ParsedWallosSubscription[]`
- **CLI options**: Update `parseArgs()` and `printUsage()` together
- **Schedule fields**: Check Actual API types at `api.createSchedule()` call
