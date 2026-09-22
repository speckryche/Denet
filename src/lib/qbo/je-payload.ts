// Turning a computed Je into the JournalEntry body Intuit expects.
//
// Pure: no I/O, no Supabase, no fetch. That matters because this is the last
// place our numbers are still recognisable before they become someone else's
// JSON — it is the thing most worth testing without a network.
//
// WHY ACCOUNT REQUIREMENTS ARE PER-LINE, NOT PER-MAPPING-ROW
// A month's JE only touches the accounts its lines actually name. SOL defaults
// to `investment`, so "Inventory - Solana" may legitimately never appear on any
// entry — and it does not exist in the production chart at all. Blocking a post
// because some unrelated mapping row is unmapped would gate real work on an
// account nobody uses. So `missingAccounts` is derived from the lines in front
// of us, never from the mapping table as a whole.

import { round2 } from './money';
import type { Je, JeLine } from './types';

/** DocNumber is short; QBO rejects an over-long one with an opaque fault. */
export const DOC_NUMBER_MAX = 21;

export interface JeEntityRef {
  type: 'Vendor' | 'Customer' | 'Employee';
  id: string;
  name?: string | null;
}

export interface PayloadInputs {
  je: Je;
  /** Our account name -> QBO Account Id. Only the names on this JE are consulted. */
  accountIdByName: Map<string, string>;
  /** Our account name -> entity to stamp on that line (the Coinbase vendor). */
  entityByAccountName?: Map<string, JeEntityRef>;
  /** Free-text provenance line. */
  privateNote?: string;
}

export interface JournalEntryPayload {
  TxnDate: string;
  DocNumber: string;
  PrivateNote: string;
  Line: Array<{
    Description: string;
    Amount: number;
    DetailType: 'JournalEntryLineDetail';
    JournalEntryLineDetail: {
      PostingType: 'Debit' | 'Credit';
      AccountRef: { value: string };
      Entity?: { Type: string; EntityRef: { value: string; name?: string } };
    };
  }>;
}

export interface BuildResult {
  payload: JournalEntryPayload | null;
  docNumber: string;
  /** Account names used by THIS JE that have no QBO Id. Non-empty => cannot post. */
  missingAccounts: string[];
  /** Non-fatal notes worth showing (e.g. a zero-amount line that was dropped). */
  warnings: string[];
}

/**
 * DEN-2026-08-SALES / DEN-2026-08-CB.
 *
 * Deterministic, because it is the recovery key: if a POST succeeds but its
 * response is lost, the only way to find the entry again is to query QBO for
 * this exact string. It must therefore be reproducible from (month, type)
 * alone, with nothing time- or attempt-dependent in it.
 */
export const buildDocNumber = (month: string, jeType: Je['type']): string => {
  const suffix = jeType === 'sales' ? 'SALES' : 'CB';
  const doc = `DEN-${month}-${suffix}`;
  if (doc.length > DOC_NUMBER_MAX) {
    throw new Error(`DocNumber "${doc}" exceeds ${DOC_NUMBER_MAX} characters.`);
  }
  return doc;
};

const postingOf = (line: JeLine): { type: 'Debit' | 'Credit'; amount: number } | null => {
  const debit = round2(line.debit);
  const credit = round2(line.credit);
  // Amount is always positive in QBO; PostingType carries the sign. A line with
  // neither side is not an error, just nothing to post.
  if (debit > 0) return { type: 'Debit', amount: debit };
  if (credit > 0) return { type: 'Credit', amount: credit };
  return null;
};

export function buildJournalEntryPayload(inputs: PayloadInputs): BuildResult {
  const { je, accountIdByName, entityByAccountName, privateNote } = inputs;
  const docNumber = buildDocNumber(je.month, je.type);

  const warnings: string[] = [];
  const missing = new Set<string>();
  const lines: JournalEntryPayload['Line'] = [];

  for (const line of je.lines) {
    const posting = postingOf(line);
    if (!posting) {
      warnings.push(`Skipped a zero-amount line on ${line.account}.`);
      continue;
    }

    const accountId = accountIdByName.get(line.account);
    if (!accountId) {
      // Recorded per line, so the operator is told exactly which account on
      // THIS entry needs mapping rather than a generic "mapping incomplete".
      missing.add(line.account);
      continue;
    }

    const entity = entityByAccountName?.get(line.account);
    lines.push({
      Description: line.description,
      Amount: posting.amount,
      DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: {
        PostingType: posting.type,
        AccountRef: { value: accountId },
        ...(entity
          ? { Entity: { Type: entity.type, EntityRef: { value: entity.id, ...(entity.name ? { name: entity.name } : {}) } } }
          : {}),
      },
    });
  }

  if (missing.size > 0) {
    return { payload: null, docNumber, missingAccounts: [...missing].sort(), warnings };
  }

  // Balance is re-checked here rather than trusted from upstream. The JE was
  // balanced when computed, but this function drops zero-amount lines, and a
  // silent imbalance is the one error QBO will happily reject after we have
  // already written our "attempting" marker.
  const debits = round2(lines.filter((l) => l.JournalEntryLineDetail.PostingType === 'Debit')
    .reduce((s, l) => s + l.Amount, 0));
  const credits = round2(lines.filter((l) => l.JournalEntryLineDetail.PostingType === 'Credit')
    .reduce((s, l) => s + l.Amount, 0));
  if (debits !== credits) {
    throw new Error(`Refusing to post an unbalanced entry: debits ${debits} vs credits ${credits}.`);
  }
  if (lines.length === 0) {
    throw new Error('Refusing to post an entry with no lines.');
  }

  return {
    payload: {
      TxnDate: je.date,
      DocNumber: docNumber,
      PrivateNote:
        privateNote ??
        `Posted by the Denet Dashboard — ${je.type === 'sales' ? 'Sales' : 'Coinbase'} JE for ${je.monthText}.`,
      Line: lines,
    },
    docNumber,
    missingAccounts: [],
    warnings,
  };
}
