// Matching our stored account names to QuickBooks accounts.
//
// Pure: takes our mapping rows and a list of QBO accounts, returns what matched
// and what did not. No I/O.
//
// WHAT THIS WRITES, AND WHAT IT MUST NEVER WRITE
// It resolves a QBO Account **Id** for each of our account names. It must never
// rewrite the name itself. qbo_je_snapshots.lines is a frozen copy of the
// resolved account names at the moment a month was entered, and detectDrift
// compares recomputed lines against it keyed on `account + ' ' + description`
// (src/lib/qbo/snapshot.ts:37). Renaming an account in our mapping would
// therefore mark every already-entered month as drifted — three sales months
// are already entered. Ids are additive and invisible to drift.
//
// THE FOUR REAL NAME SHAPES, all present in the live data:
//   "1005 BTC Machine Cash"                      <num> <Name>
//   "4061 Transaction Fees:Fees - Denet BTMs"    <num> <Parent>:<Child>
//   "1610 Long-term Investments:Solana (SOL)"    <num> <Parent>:<Child> (<TICKER>)
//   "Inventory - Solana"                         <Name>, NO number
// The last one is why the matcher cannot simply require an account number.
//
// ':' is QBO's sub-account separator and is already embedded in our stored
// string, so our names are effectively AcctNum + ' ' + FullyQualifiedName —
// except where the number is missing.

/** One account as QBO returns it. Only the fields we match on. */
export interface QboAccount {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  AcctNum?: string;
  AccountType?: string;
  Active?: boolean;
}

/** One row of ours needing an Id: a fixed account, or an asset's inventory/investment account. */
export interface MappingTarget {
  /** Stable identifier for the caller to write the result back against. */
  ref: string;
  /** Human label for the UI, e.g. "Machine cash (debit, sales)" or "BTC — inventory". */
  label: string;
  /** Our stored account name. Never modified. */
  accountName: string;
  /** The Id already stored, if any. */
  currentId: string | null;
}

export type MatchMethod = 'acct_num' | 'fully_qualified_name' | 'name';

export interface AccountMatch {
  target: MappingTarget;
  account: QboAccount;
  method: MatchMethod;
  /** True when the stored Id already equals the matched one — nothing to write. */
  unchanged: boolean;
}

export interface AmbiguousMatch {
  target: MappingTarget;
  method: MatchMethod;
  candidates: QboAccount[];
}

export interface MatchResult {
  matched: AccountMatch[];
  /** More than one QBO account fits. Never guessed — the user picks. */
  ambiguous: AmbiguousMatch[];
  /** Nothing fits at any tier. */
  unmatched: MappingTarget[];
}

/**
 * Leading account number from one of our stored names, or null.
 *
 * Shared with the Coinbase buys table, which shows "→ 1100" beside the
 * treatment dropdown. Allows digits plus '.' and '-' so sub-account numbering
 * like "1100.5" survives.
 */
export const accountNumber = (accountName: string | undefined | null): string | null => {
  if (!accountName) return null;
  const m = String(accountName).trim().match(/^(\d[\d.\-]*)\b/);
  return m ? m[1] : null;
};

/** Our stored name with any leading account number removed. */
export const nameWithoutNumber = (accountName: string): string => {
  const num = accountNumber(accountName);
  if (!num) return accountName.trim();
  return accountName.trim().slice(num.length).trim();
};

// Case-, space- and punctuation-insensitive comparison key. QBO round-trips
// names with inconsistent spacing around ':' and '-', and our stored names were
// typed by hand, so an exact string compare is too brittle to be the last tier.
const norm = (s: string | undefined | null): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*/g, ':')
    .trim();

/**
 * Match every target against the QBO account list.
 *
 * Tiers, strongest first. A tier that produces exactly one hit wins; a tier
 * that produces several records an ambiguity and stops — it does NOT fall
 * through to a weaker tier, because a weaker tier agreeing would be
 * coincidence, not confirmation.
 *
 *   1. acct_num              our leading number === AcctNum
 *   2. fully_qualified_name  our name minus the number === FullyQualifiedName
 *   3. name                  === Name, or === FullyQualifiedName, normalised
 *
 * Inactive QBO accounts are excluded: posting to one fails at the API, so
 * surfacing it as unmatched is more useful than matching it and failing later.
 */
export function matchAccounts(targets: MappingTarget[], accounts: QboAccount[]): MatchResult {
  const active = accounts.filter((a) => a.Active !== false);

  const matched: AccountMatch[] = [];
  const ambiguous: AmbiguousMatch[] = [];
  const unmatched: MappingTarget[] = [];

  for (const target of targets) {
    const num = accountNumber(target.accountName);
    const bare = nameWithoutNumber(target.accountName);

    const tiers: Array<{ method: MatchMethod; hits: QboAccount[] }> = [
      {
        method: 'acct_num',
        hits: num ? active.filter((a) => a.AcctNum && a.AcctNum.trim() === num) : [],
      },
      {
        method: 'fully_qualified_name',
        hits: active.filter((a) => norm(a.FullyQualifiedName) === norm(bare)),
      },
      {
        method: 'name',
        hits: active.filter(
          (a) => norm(a.Name) === norm(bare) || norm(a.FullyQualifiedName) === norm(target.accountName),
        ),
      },
    ];

    const tier = tiers.find((t) => t.hits.length > 0);

    if (!tier) {
      unmatched.push(target);
      continue;
    }
    if (tier.hits.length > 1) {
      ambiguous.push({ target, method: tier.method, candidates: tier.hits });
      continue;
    }

    const account = tier.hits[0];
    matched.push({
      target,
      account,
      method: tier.method,
      unchanged: target.currentId === account.Id,
    });
  }

  return { matched, ambiguous, unmatched };
}

/** Everything still needing attention before a post can be attempted. */
export const unresolvedTargets = (result: MatchResult): MappingTarget[] => [
  ...result.unmatched,
  ...result.ambiguous.map((a) => a.target),
];
