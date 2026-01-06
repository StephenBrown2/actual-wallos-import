/**
 * Standalone script to import Wallos subscriptions into Actual Budget as schedules.
 *
 * Usage:
 *   # From JSON file:
 *   npx ts-node actual-wallos-import.ts --file <subscriptions.json> [--account <default-account-name>]
 *
 *   # From Wallos API:
 *   npx ts-node actual-wallos-import.ts --api [--account <default-account-name>]
 *
 * Prerequisites:
 *   - npm install @actual-app/api uuid
 *   - Set environment variables:
 *     - ACTUAL_DATA_DIR: Path to Actual data directory
 *     - ACTUAL_BUDGET_ID: Budget sync ID (or omit to use first available)
 *     - ACTUAL_SERVER_URL: (optional) Sync server URL
 *     - ACTUAL_PASSWORD: (optional) Sync server password
 *     - WALLOS_URL: (required for --api) Wallos instance URL
 *     - WALLOS_API_KEY: (required for --api) Wallos API key
 */

import * as api from '@actual-app/api';
import * as fs from 'fs';
import * as readline from 'readline';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types (duplicated from wallos-types.ts)
// ============================================================================

/**
 * Raw Wallos subscription data structure from export
 */
type WallosSubscription = {
  Name: string;
  'Payment Cycle': string;
  'Next Payment': string;
  Renewal: string;
  Category: string;
  'Payment Method': string;
  'Paid By': string;
  Price: string;
  Notes: string;
  URL: string;
  State: string;
  Notifications: string;
  'Cancellation Date': string | null;
  Active: string;
};

/**
 * Parsed and normalized Wallos subscription data
 */
type ParsedWallosSubscription = {
  id: string;
  name: string;
  amount: number;
  nextPaymentDate: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  category: string;
  paymentMethod: string;
  notes: string;
  url: string;
  isActive: boolean;
  originalPrice: string;
};

/**
 * Recurrence configuration for Actual Budget schedules
 */
type RecurConfig = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  start: string;
  endMode: 'never' | 'on_date' | 'after_count';
  endDate?: string;
  endCount?: number;
};

/**
 * Account entity from Actual API
 */
type Account = {
  id: string;
  name: string;
  closed?: boolean;
};

// ============================================================================
// Interactive prompt utilities
// ============================================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
}

/**
 * Display a numbered list of accounts and prompt user to select one
 */
async function promptForAccount(
  accounts: Account[],
  subscriptionName: string,
  paymentMethod?: string,
  notes?: string,
): Promise<string> {
  console.log('');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`No matching account found for: ${subscriptionName}`);
  if (paymentMethod) {
    console.log(`  Payment Method: ${paymentMethod}`);
  }
  if (notes) {
    console.log(`  Notes: ${notes}`);
  }
  console.log('');
  console.log('Available accounts:');

  console.log(`  0. Skip this subscription`);
  const openAccounts = accounts.filter(a => !a.closed);
  openAccounts.forEach((account, index) => {
    console.log(`  ${index + 1}. ${account.name}`);
  });
  console.log('');

  while (true) {
    const answer = await prompt(`Select account (1-${openAccounts.length}, or 0 to skip): `);
    const selection = parseInt(answer, 10);

    if (selection === 0) {
      return ''; // Skip
    }

    if (selection >= 1 && selection <= openAccounts.length) {
      return openAccounts[selection - 1].id;
    }

    console.log(`Invalid selection. Please enter a number between 0 and ${openAccounts.length}.`);
  }
}

/**
 * Prompt user for yes/no confirmation
 */
async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${hint}: `);
  
  if (answer === '') {
    return defaultYes;
  }
  
  return answer.toLowerCase().startsWith('y');
}

// ============================================================================
// Parser functions (duplicated from wallos.ts)
// ============================================================================

/**
 * Parse Wallos "Payment Cycle" string into frequency and interval
 */
function parsePaymentCycle(cycle: string): {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
} {
  const normalizedCycle = cycle.toLowerCase().trim();

  // Handle simple cases
  if (normalizedCycle === 'daily') {
    return { frequency: 'daily', interval: 1 };
  }
  if (normalizedCycle === 'weekly') {
    return { frequency: 'weekly', interval: 1 };
  }
  if (normalizedCycle === 'monthly') {
    return { frequency: 'monthly', interval: 1 };
  }
  if (normalizedCycle === 'yearly' || normalizedCycle === 'annually') {
    return { frequency: 'yearly', interval: 1 };
  }

  // Handle "Every X Days/Weeks/Months/Years" patterns
  const everyMatch = normalizedCycle.match(
    /every\s+(\d+)\s*(day|week|month|year)s?/i,
  );
  if (everyMatch) {
    const interval = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();

    switch (unit) {
      case 'day':
        return { frequency: 'daily', interval };
      case 'week':
        return { frequency: 'weekly', interval };
      case 'month':
        return { frequency: 'monthly', interval };
      case 'year':
        return { frequency: 'yearly', interval };
    }
  }

  // Handle "Biweekly" / "Bi-weekly" patterns
  if (
    normalizedCycle.includes('biweekly') ||
    normalizedCycle.includes('bi-weekly')
  ) {
    return { frequency: 'weekly', interval: 2 };
  }

  // Handle "Bimonthly" / "Bi-monthly" patterns
  if (
    normalizedCycle.includes('bimonthly') ||
    normalizedCycle.includes('bi-monthly')
  ) {
    return { frequency: 'monthly', interval: 2 };
  }

  // Handle "Quarterly"
  if (normalizedCycle.includes('quarterly')) {
    return { frequency: 'monthly', interval: 3 };
  }

  // Handle "Semi-annual" / "Semiannual"
  if (
    normalizedCycle.includes('semi-annual') ||
    normalizedCycle.includes('semiannual')
  ) {
    return { frequency: 'monthly', interval: 6 };
  }

  // Default to monthly if unrecognized
  console.warn(`Unrecognized payment cycle: "${cycle}", defaulting to monthly`);
  return { frequency: 'monthly', interval: 1 };
}

/**
 * Parse a price string with currency symbol into an integer (cents)
 */
function parsePrice(priceStr: string): number {
  // Remove everything except digits and periods
  const cleanedPrice = priceStr.replace(/[^\d.]/g, '');
  const price = parseFloat(cleanedPrice);
  if (isNaN(price)) {
    return 0;
  }
  // Convert to cents and round to avoid floating point issues
  return Math.round(price * 100);
}

/**
 * Parse a single Wallos subscription into our internal format
 */
function parseSubscription(sub: WallosSubscription): ParsedWallosSubscription {
  const { frequency, interval } = parsePaymentCycle(sub['Payment Cycle']);
  const amount = parsePrice(sub.Price);

  return {
    id: uuidv4(),
    name: sub.Name,
    // Subscriptions are expenses, so negate the amount
    amount: -amount,
    nextPaymentDate: sub['Next Payment'],
    frequency,
    interval,
    category: sub.Category,
    paymentMethod: sub['Payment Method'],
    notes: sub.Notes,
    url: sub.URL,
    isActive: sub.State === 'Enabled' && sub.Active === 'Yes',
    originalPrice: sub.Price,
  };
}

/**
 * Parse a Wallos JSON export file into a structured format
 */
function parseWallosFile(content: string): ParsedWallosSubscription[] {
  const data = JSON.parse(content);

  // Handle both array format and wrapped object format
  let subscriptions: WallosSubscription[];
  if (Array.isArray(data)) {
    subscriptions = data;
  } else if (data.subscriptions && Array.isArray(data.subscriptions)) {
    subscriptions = data.subscriptions;
  } else {
    throw new Error(
      'Invalid Wallos export format: expected array or { subscriptions: [...] }',
    );
  }

  return subscriptions.map(parseSubscription);
}

/**
 * Convert a parsed Wallos subscription to Actual's RecurConfig format
 */
function toRecurConfig(sub: ParsedWallosSubscription): RecurConfig {
  return {
    frequency: sub.frequency,
    interval: sub.interval,
    start: sub.nextPaymentDate,
    endMode: 'never',
  };
}

// ============================================================================
// Wallos API support
// ============================================================================

/**
 * Fetch subscriptions directly from Wallos API
 *
 * @param wallosUrl - Base URL of the Wallos instance (e.g., "https://wallos.example.com")
 * @param apiKey - Wallos API key for authentication
 * @returns Array of parsed subscriptions
 */
async function fetchFromWallosApi(
  wallosUrl: string,
  apiKey: string,
): Promise<ParsedWallosSubscription[]> {
  const endpoint = `${wallosUrl.replace(/\/$/, '')}/api/subscriptions`;

  console.log(`Fetching subscriptions from: ${endpoint}`);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Wallos API request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  // Handle API response format
  let subscriptions: WallosSubscription[];
  if (Array.isArray(data)) {
    subscriptions = data;
  } else if (data && Array.isArray(data.subscriptions)) {
    subscriptions = data.subscriptions;
  } else if (data && Array.isArray(data.data)) {
    subscriptions = data.data;
  } else {
    throw new Error(
      'Unexpected API response format: expected array or { subscriptions: [...] } or { data: [...] }',
    );
  }

  return subscriptions.map(parseSubscription);
}

// ============================================================================
// Argument parsing helpers
// ============================================================================

interface ParsedArgs {
  mode: 'file' | 'api';
  filePath?: string;
  accountName?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): ParsedArgs {
  let mode: 'file' | 'api' = 'file';
  let filePath: string | undefined;
  let accountName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--api') {
      mode = 'api';
    } else if (arg === '--file') {
      mode = 'file';
      // Next arg should be the file path
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        filePath = args[++i];
      }
    } else if (arg === '--account') {
      // Next arg should be the account name
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        accountName = args[++i];
      }
    } else if (arg.startsWith('--')) {
      console.warn(`Unknown option: ${arg}`);
    }
  }

  return { mode, filePath, accountName };
}

/**
 * Print usage help and exit
 */
function printUsage(): void {
  console.error('Usage:');
  console.error('  npx ts-node actual-wallos-import.ts --file <subscriptions.json> [--account <name>]');
  console.error('  npx ts-node actual-wallos-import.ts --api [--account <name>]');
  console.error('');
  console.error('Options:');
  console.error('  --file <path>     Import from Wallos JSON export file');
  console.error('  --api             Import directly from Wallos API');
  console.error('  --account <name>  Default account for subscriptions');
  console.error('');
  console.error('Environment variables:');
  console.error('  ACTUAL_DATA_DIR     - Path to Actual data directory');
  console.error('  ACTUAL_BUDGET_ID    - Budget sync ID (optional, uses first available)');
  console.error('  ACTUAL_SERVER_URL   - Sync server URL (optional)');
  console.error('  ACTUAL_PASSWORD     - Sync server password (optional)');
  console.error('');
  console.error('For --api mode:');
  console.error('  WALLOS_URL          - Base URL of Wallos instance');
  console.error('  WALLOS_API_KEY      - Wallos API key');
}

// ============================================================================
// Main import logic
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  // Validate arguments
  if (parsed.mode === 'file' && !parsed.filePath) {
    console.error('Error: --file mode requires a file path');
    console.error('');
    printUsage();
    process.exit(1);
  }

  if (parsed.mode === 'api') {
    if (!process.env.WALLOS_URL || !process.env.WALLOS_API_KEY) {
      console.error('Error: --api mode requires WALLOS_URL and WALLOS_API_KEY environment variables');
      console.error('');
      printUsage();
      process.exit(1);
    }
  }

  const dataDir = process.env.ACTUAL_DATA_DIR || './actual-data';
  const budgetId = process.env.ACTUAL_BUDGET_ID;
  const serverUrl = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;

  // Get subscriptions from file or API
  let subscriptions: ParsedWallosSubscription[];
  
  if (parsed.mode === 'api') {
    subscriptions = await fetchFromWallosApi(
      process.env.WALLOS_URL!,
      process.env.WALLOS_API_KEY!,
    );
  } else {
    console.log(`Reading Wallos export from: ${parsed.filePath}`);
    const content = fs.readFileSync(parsed.filePath!, 'utf-8');
    subscriptions = parseWallosFile(content);
  }
  
  console.log(`Parsed ${subscriptions.length} subscriptions`);

  // Filter to active subscriptions only
  const activeSubscriptions = subscriptions.filter(s => s.isActive);
  console.log(`${activeSubscriptions.length} active subscriptions to import`);

  if (activeSubscriptions.length === 0) {
    console.log('No active subscriptions to import.');
    rl.close();
    return;
  }

  // Initialize API
  console.log('Initializing Actual API...');
  await api.init({
    dataDir,
    serverURL: serverUrl,
    password,
  });

  // Download/open budget
  if (budgetId) {
    console.log(`Downloading budget: ${budgetId}`);
    await api.downloadBudget(budgetId);
  } else {
    // List available budgets and use the first one
    const budgets = await api.getBudgets();
    if (budgets.length === 0) {
      throw new Error('No budgets found. Please specify ACTUAL_BUDGET_ID.');
    }
    console.log(`Using first available budget: ${budgets[0].name}`);
    await api.downloadBudget(budgets[0].id);
  }

  // Get existing payees and accounts for matching
  const payees = await api.getPayees();
  const accounts = await api.getAccounts();

  const payeeMap = new Map(
    payees.map(p => [p.name.toLowerCase().trim(), p.id]),
  );
  const accountMap = new Map(
    accounts.map(a => [a.name.toLowerCase().trim(), a.id]),
  );

  // Find default account (if provided)
  let defaultAccountId: string | undefined;
  if (parsed.accountName) {
    defaultAccountId = accountMap.get(parsed.accountName.toLowerCase().trim());
    if (!defaultAccountId) {
      console.warn(`Warning: Default account "${parsed.accountName}" not found.`);
      console.warn('You will be prompted to select an account for each subscription.');
    } else {
      console.log(`Default account: ${parsed.accountName}`);
    }
  }

  console.log('');
  console.log('Starting import...');
  console.log('');

  // Import each subscription
  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const sub of activeSubscriptions) {
    try {
      // Find or create payee
      let payeeId = payeeMap.get(sub.name.toLowerCase().trim());
      if (!payeeId) {
        console.log(`  Creating payee: ${sub.name}`);
        payeeId = await api.createPayee({ name: sub.name });
        payeeMap.set(sub.name.toLowerCase().trim(), payeeId);
      }

      // Try to match account by payment method or notes
      let accountId: string | undefined;
      
      if (sub.paymentMethod) {
        accountId = accountMap.get(sub.paymentMethod.toLowerCase().trim());
      }
      if (!accountId && sub.notes) {
        accountId = accountMap.get(sub.notes.toLowerCase().trim());
      }
      
      // Fall back to default account
      if (!accountId && defaultAccountId) {
        accountId = defaultAccountId;
      }
      
      // If still no account, prompt the user
      if (!accountId) {
        accountId = await promptForAccount(
          accounts,
          sub.name,
          sub.paymentMethod,
          sub.notes,
        );
        
        if (!accountId) {
          console.log(`⊘ Skipped: ${sub.name}`);
          skippedCount++;
          continue;
        }
      }

      // Create schedule
      await api.createSchedule({
        name: sub.name,
        payee: payeeId,
        account: accountId,
        amount: sub.amount,
        amountOp: 'is',
        date: toRecurConfig(sub),
      });

      const accountName = accounts.find(a => a.id === accountId)?.name || accountId;
      console.log(
        `✓ Created schedule: ${sub.name} (${sub.originalPrice}, ${sub.frequency}${sub.interval > 1 ? ` x${sub.interval}` : ''}) → ${accountName}`,
      );
      successCount++;
    } catch (err) {
      console.error(
        `✗ Failed to create schedule for "${sub.name}": ${err instanceof Error ? err.message : err}`,
      );
      errorCount++;
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Import complete:`);
  console.log(`  ✓ ${successCount} schedules created`);
  if (skippedCount > 0) {
    console.log(`  ⊘ ${skippedCount} skipped`);
  }
  if (errorCount > 0) {
    console.log(`  ✗ ${errorCount} failed`);
  }

  // Sync changes to server if configured
  if (serverUrl) {
    const shouldSync = await promptYesNo('Sync changes to server?');
    if (shouldSync) {
      console.log('Syncing to server...');
      await api.sync();
      console.log('Sync complete.');
    }
  }

  rl.close();
  await api.shutdown();
}

main().catch(err => {
  console.error('Fatal error:', err);
  rl.close();
  process.exit(1);
});