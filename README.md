# Actual Wallos Import

Import subscription data from [Wallos](https://github.com/ellite/Wallos) into [Actual Budget](https://actualbudget.org/) as scheduled transactions.

## Features

- Import from Wallos JSON export file
- Import directly from Wallos API
- Interactive account selection for each subscription
- Automatic payee creation
- Supports all Wallos payment cycles (monthly, yearly, weekly, daily, etc.)
- Multi-currency support with automatic amount parsing

## Installation

```bash
# Clone the repository
git clone https://github.com/StephenBrown2/actual-wallos-import.git
cd actual-wallos-import

# Install dependencies
npm install
```

## Usage

### From Wallos JSON Export

1. Export your subscriptions from Wallos (Settings → Export → JSON)
2. Run the import script:

```bash
# Basic usage
npx ts-node actual-wallos-import.ts --file subscriptions.json

# With default account
npx ts-node actual-wallos-import.ts --file subscriptions.json --account "Credit Card"
```

### From Wallos API (Direct)

Set the required environment variables and use `--api` mode:

```bash
export WALLOS_URL="https://wallos.example.com"
export WALLOS_API_KEY="your-api-key"

npx ts-node actual-wallos-import.ts --api --account "Credit Card"
```

## Environment Variables

### Actual Budget Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `ACTUAL_DATA_DIR` | No | Path to Actual data directory (default: `./actual-data`) |
| `ACTUAL_BUDGET_ID` | No | Budget sync ID (uses first available if not specified) |
| `ACTUAL_SERVER_URL` | No | Sync server URL for remote budgets |
| `ACTUAL_PASSWORD` | No | Sync server password |

### Wallos API Configuration (for `--api` mode)

| Variable | Required | Description |
|----------|----------|-------------|
| `WALLOS_URL` | Yes | Base URL of your Wallos instance |
| `WALLOS_API_KEY` | Yes | Wallos API key (Settings → API) |

## Command Line Options

```
Usage:
  npx ts-node actual-wallos-import.ts --file <subscriptions.json> [--account <name>]
  npx ts-node actual-wallos-import.ts --api [--account <name>]

Options:
  --file <path>     Import from Wallos JSON export file
  --api             Import directly from Wallos API
  --account <name>  Default account for subscriptions
```

## Account Matching

The script attempts to match subscriptions to accounts in the following order:

1. **Payment Method** - If the subscription's payment method matches an account name
2. **Notes** - If the subscription's notes field matches an account name
3. **Default Account** - The account specified via `--account` option
4. **Interactive Prompt** - If no match is found, you'll be prompted to select an account

## Example Output

```
Reading Wallos export from: subscriptions.json
Parsed 15 subscriptions
12 active subscriptions to import
Initializing Actual API...
Using first available budget: My Budget

Starting import...

  Creating payee: Netflix
✓ Created schedule: Netflix ($15.99, monthly) → Credit Card
✓ Created schedule: Spotify ($9.99, monthly) → Credit Card
  Creating payee: AWS
✓ Created schedule: AWS ($25.00, monthly) → Checking

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Import complete:
  ✓ 12 schedules created
```

## Requirements

- Node.js 18+
- TypeScript
- An Actual Budget instance (local or synced)
- Wallos subscriptions to import

## Dependencies

- `@actual-app/api` - Actual Budget API client

## Development

```bash
# Type check
npx tsc --noEmit

# Run directly
npx ts-node actual-wallos-import.ts --help
```

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [Actual Budget](https://github.com/actualbudget/actual) - Local-first personal finance tool
- [Wallos](https://github.com/ellite/Wallos) - Open-source subscription tracker

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
