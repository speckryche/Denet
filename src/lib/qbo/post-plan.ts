// Deciding what to do with a snapshot when "Post to QBO" is pressed.
//
// Pure, so the branch that matters most — an entry whose POST outcome we never
// confirmed — can be exercised without a network. Getting this wrong creates a
// duplicate journal entry in a real general ledger, which is not something to
// discover in production.

export type PostState = 'idle' | 'manual' | 'posting' | 'unknown' | 'posted' | 'failed';

/** A JournalEntry as returned by a DocNumber query. */
export interface ExistingEntry {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  /**
   * QuickBooks reports TotalAmt as 0 for journal entries — verified against a
   * real posted entry (txn 145 came back with TotalAmt: 0 despite balancing at
   * 69,670.20). So it cannot be used to corroborate an entry, and the debit
   * lines have to be summed instead.
   */
  TotalAmt?: number;
  TxnDate?: string;
  Line?: Array<{
    Amount?: number;
    JournalEntryLineDetail?: { PostingType?: string };
  }>;
}

/** Sum of the debit side — the usable "size" of a journal entry. */
export const debitTotalOf = (entry: ExistingEntry): number | null => {
  if (!entry.Line || entry.Line.length === 0) return null;
  const sum = entry.Line
    .filter((l) => l.JournalEntryLineDetail?.PostingType === 'Debit')
    .reduce((s, l) => s + (l.Amount ?? 0), 0);
  return Math.round((sum + Number.EPSILON) * 100) / 100;
};

export type PostPlan =
  /** Normal path: claim and POST. */
  | { action: 'post' }
  /** The entry is already in QuickBooks. Record its id; do NOT post. */
  | { action: 'adopt'; entry: ExistingEntry }
  /** Was 'unknown', we checked, it is genuinely absent. Claim and POST. */
  | { action: 'recover_post' }
  /** Do nothing, and say why. */
  | { action: 'refuse'; code: string; reason: string }
  /** We must look in QuickBooks before we can decide. */
  | { action: 'check_qbo_first'; docNumber: string };

export interface PlanInput {
  postState: PostState;
  qboTxnId: string | null;
  docNumber: string;
  /** The DocNumber query result. undefined = not looked yet. */
  existing?: ExistingEntry | null;
}

/**
 * What should happen next.
 *
 * The ordering of the guards is the safety property:
 *
 *   posted   an id already recorded — never post again
 *   manual   keyed into QuickBooks by hand. There is no DocNumber to search on,
 *            because a human typed whatever number they liked, so we cannot even
 *            detect the duplicate afterwards. Refuse outright.
 *   posting  another attempt holds the lease
 *   unknown  a POST may or may not have landed. MUST look in QuickBooks before
 *            deciding; never posts on faith.
 */
export function planPost(input: PlanInput): PostPlan {
  const { postState, qboTxnId, docNumber, existing } = input;

  if (qboTxnId) {
    return {
      action: 'refuse',
      code: 'already_posted',
      reason: `Already posted to QuickBooks as transaction ${qboTxnId}.`,
    };
  }

  if (postState === 'posted') {
    return { action: 'refuse', code: 'already_posted', reason: 'Already marked as posted.' };
  }

  if (postState === 'manual') {
    return {
      action: 'refuse',
      code: 'entered_manually',
      reason:
        'This month was entered in QuickBooks by hand, so posting would create a duplicate. ' +
        'It carries no DocNumber we could search on. Un-mark it here first if you intend to post it through the API instead.',
    };
  }

  if (postState === 'posting') {
    return {
      action: 'refuse',
      code: 'post_in_progress',
      reason: 'A post is already in flight for this entry. Wait for it to finish.',
    };
  }

  if (postState === 'unknown') {
    // `existing === undefined` means the caller has not looked yet.
    if (existing === undefined) return { action: 'check_qbo_first', docNumber };
    if (existing) return { action: 'adopt', entry: existing };
    return { action: 'recover_post' };
  }

  // idle | failed — the posting flow created this row and nothing landed.
  // Still adopt if a DocNumber search happened to turn something up: that means
  // a previous attempt succeeded in a way we failed to record.
  if (existing) return { action: 'adopt', entry: existing };
  return { action: 'post' };
}

/**
 * Does a QBO entry found by DocNumber actually correspond to what we meant to
 * post? DocNumber is not unique in QuickBooks, so a match on it alone is not
 * proof. Corroborate on amount and date before adopting someone else's entry.
 */
export function entryCorroborates(
  entry: ExistingEntry,
  expected: { totalAmount: number; txnDate: string },
  tolerance = 0.005,
): boolean {
  if (entry.TxnDate && entry.TxnDate !== expected.txnDate) return false;

  // Sum the debit lines. TotalAmt is 0 on journal entries, so testing it would
  // either reject every genuine match or — if we skipped zeros — silently stop
  // checking the amount at all, leaving TxnDate as the only guard. Two entries
  // on the same month-end date under the same DocNumber is exactly the
  // situation this is meant to catch.
  const debits = debitTotalOf(entry);
  if (debits == null) {
    // No lines came back (a summary query). Date alone is not enough to adopt
    // someone else's entry, so refuse rather than assume.
    return false;
  }
  return Math.abs(debits - expected.totalAmount) <= tolerance;
}
