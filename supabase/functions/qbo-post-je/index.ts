// Post one month's journal entry to QuickBooks. Admin only.
//
// This is the only function that creates a transaction in the general ledger,
// and the failure it is built around is not "the POST failed" — that is safe,
// nothing was created — but "the POST succeeded and we never found out".
// Retrying blindly after that creates a SECOND journal entry, and QuickBooks
// does not enforce DocNumber uniqueness, so nothing downstream would stop it.
//
// Order of operations, and why:
//   1. decide        planPost() — refuses manual/posted/in-flight outright
//   2. look first    for 'unknown', query QBO by DocNumber BEFORE anything else
//   3. claim         persist the intent (state, request id, doc number) and
//                    COMMIT it before the network call, so a retry can
//                    recognise its own earlier attempt
//   4. post          with Intuit's requestid for server-side dedup
//   5. commit        record the txn id, conditional on still holding the lease
//
// An outcome we cannot classify becomes 'unknown' and is NEVER auto-retried.
// Automated retry trades a rare stall for a rare duplicate entry in a real
// ledger — a strictly worse trade.

import { corsHeaders } from '../_shared/utils.ts';
import {
  AuthError, NotConnectedError, json, qboFetch, requireAdmin, serviceClient,
} from '../_shared/qbo.ts';

interface SnapshotRow {
  month: string;
  je_type: 'sales' | 'coinbase';
  je_date: string;
  lines: Array<{ account: string; debit: number; credit: number; description: string }>;
  total_debits: number;
  total_credits: number;
  qbo_txn_id: string | null;
  doc_number: string | null;
  post_state: string;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const docNumberFor = (month: string, jeType: string) =>
  `DEN-${month}-${jeType === 'sales' ? 'SALES' : 'CB'}`;

/** Find a JournalEntry by DocNumber. Returns null when absent. */
async function findByDocNumber(supabase: any, docNumber: string) {
  const res = (await qboFetch(supabase, '/query', {
    searchParams: {
      query: `SELECT * FROM JournalEntry WHERE DocNumber = '${docNumber.replace(/'/g, "''")}'`,
    },
  })) as { QueryResponse?: { JournalEntry?: Array<{ Id: string; SyncToken: string; DocNumber?: string; TotalAmt?: number; TxnDate?: string }> } };
  return res?.QueryResponse?.JournalEntry?.[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    const admin = await requireAdmin(req, supabase);
    const { month, jeType, payload, snapshot } = (await req.json()) as {
      month: string; jeType: 'sales' | 'coinbase';
      payload: Record<string, unknown>;
      // The computed JE as the app rendered it. Persisted as part of the claim,
      // BEFORE the POST, so a lost response still leaves a record of what was
      // sent for the recovery path to compare against.
      snapshot: { jeDate: string; lines: unknown; totalDebits: number; totalCredits: number };
    };
    if (!month || !jeType || !payload || !snapshot) {
      return json({ error: 'month, jeType, payload and snapshot are required.' }, 400);
    }

    const { data: connData, error: connError } = await supabase.rpc('qbo_get_connection');
    if (connError) throw connError;
    const conn = Array.isArray(connData) ? connData[0] : connData;
    if (!conn) return json({ error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);

    const { data: snap, error: snapError } = await supabase
      .from('qbo_je_snapshots')
      .select('month, je_type, je_date, lines, total_debits, total_credits, qbo_txn_id, doc_number, post_state')
      .eq('month', month).eq('je_type', jeType).maybeSingle();
    if (snapError) throw snapError;

    const state = (snap as SnapshotRow | null)?.post_state ?? 'idle';
    const existingTxn = (snap as SnapshotRow | null)?.qbo_txn_id ?? null;
    const docNumber = (snap as SnapshotRow | null)?.doc_number ?? docNumberFor(month, jeType);

    // --- 1. Refusals that need no network call -----------------------------
    if (existingTxn) {
      return json(
        { error: `Already posted to QuickBooks as transaction ${existingTxn}.`, code: 'already_posted', txnId: existingTxn },
        409,
      );
    }
    if (state === 'posted') {
      return json({ error: 'Already marked as posted.', code: 'already_posted' }, 409);
    }
    if (state === 'manual') {
      return json(
        {
          error:
            'This month was entered in QuickBooks by hand, so posting would create a duplicate. ' +
            'It carries no DocNumber we could search on. Un-mark it here first if you intend to post through the API instead.',
          code: 'entered_manually',
        },
        409,
      );
    }
    if (state === 'posting') {
      return json({ error: 'A post is already in flight for this entry.', code: 'post_in_progress' }, 409);
    }

    const expectedTotal = round2(Number((snap as SnapshotRow | null)?.total_debits ?? snapshot.totalDebits ?? 0));
    const txnDate = String((payload as any).TxnDate ?? '');

    // --- 2. For 'unknown', look in QuickBooks BEFORE deciding --------------
    // A row is 'unknown' precisely because a POST may already have landed.
    // Claiming it without looking is the duplicate-entry bug this whole design
    // exists to avoid.
    let recovered = false;
    if (state === 'unknown') {
      const found = await findByDocNumber(supabase, docNumber);
      if (found) {
        // DocNumber is not unique in QBO, so corroborate before adopting.
        // TotalAmt is 0 on QuickBooks journal entries (verified on a real
        // posted entry), so the debit lines are summed instead. Without lines
        // we refuse rather than adopt on date alone.
        const debitSum = Array.isArray(found.Line)
          ? round2(found.Line
              .filter((l: any) => l?.JournalEntryLineDetail?.PostingType === 'Debit')
              .reduce((acc: number, l: any) => acc + Number(l?.Amount ?? 0), 0))
          : null;
        const dateOk = !found.TxnDate || found.TxnDate === txnDate;
        const amtOk = debitSum != null && Math.abs(debitSum - expectedTotal) <= 0.005;
        if (!dateOk || !amtOk) {
          return json(
            {
              error:
                `Found a QuickBooks entry with DocNumber ${docNumber}, but it does not match this month ` +
                `(QBO: ${found.TxnDate ?? '?'} / ${found.TotalAmt ?? '?'}; expected: ${txnDate} / ${expectedTotal}). ` +
                `Resolve this in QuickBooks before posting.`,
              code: 'doc_number_conflict',
              found,
            },
            409,
          );
        }
        const { data: adopted, error: adoptError } = await supabase.rpc('qbo_adopt_post', {
          p_month: month, p_je_type: jeType, p_txn_id: found.Id,
          p_sync_token: found.SyncToken, p_realm_id: conn.realm_id,
          p_adopted_by: admin.email,
        });
        if (adoptError) throw adoptError;
        return json({
          adopted: true, posted: false, txnId: found.Id, docNumber,
          message: `This entry was already in QuickBooks (transaction ${found.Id}). Recorded it here — no new entry was created.`,
          committed: adopted,
        });
      }
      recovered = true; // checked, genuinely absent
    }

    // --- 3. Claim, persisting the intent before any network call -----------
    const claimFn = recovered ? 'qbo_claim_post_recovered' : 'qbo_claim_post';
    const { data: claimData, error: claimError } = await supabase.rpc(claimFn, {
      p_month: month, p_je_type: jeType, p_doc_number: docNumber,
      p_realm_id: conn.realm_id, p_lease_seconds: 120,
      // qbo_claim_post INSERTs the snapshot when the month has never been
      // entered — the normal case. The recovered path only ever updates an
      // existing 'unknown' row, so it takes no snapshot fields.
      ...(recovered
        ? {}
        : {
            p_je_date: snapshot.jeDate,
            p_lines: snapshot.lines,
            p_total_debits: snapshot.totalDebits,
            p_total_credits: snapshot.totalCredits,
          }),
    });
    if (claimError) throw claimError;
    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
      | { lease_id: string; doc_number: string; request_id: string; attempts: number } | undefined;
    if (!claim) {
      return json(
        { error: 'Could not claim this entry for posting — another attempt may be in flight, or its state changed.', code: 'claim_failed' },
        409,
      );
    }

    // --- 4. POST -----------------------------------------------------------
    let created: any = null;
    try {
      const res = (await qboFetch(supabase, '/journalentry', {
        method: 'POST',
        body: JSON.stringify({ ...payload, DocNumber: claim.doc_number }),
        // Intuit deduplicates a retried POST carrying the same requestid. The id
        // was persisted at claim time, so a retry of THIS attempt reuses it.
        searchParams: { requestid: claim.request_id },
      })) as { JournalEntry?: any };
      created = res?.JournalEntry ?? null;
      if (!created?.Id) throw new Error('QuickBooks returned no JournalEntry Id.');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // A business fault means QBO rejected it — nothing was created, so this is
      // safely retryable. Anything else (timeout, 5xx, unparseable) leaves the
      // outcome genuinely unknown and must go to a human.
      const rejected = /QuickBooks API 4\d\d/.test(message);
      await supabase.rpc('qbo_fail_post', {
        p_lease_id: claim.lease_id,
        p_error: message.slice(0, 500),
        p_unknown: !rejected,
      });
      return json(
        {
          error: rejected
            ? `QuickBooks rejected the entry: ${message}`
            : `The post could not be confirmed: ${message}. Check QuickBooks for DocNumber ${claim.doc_number} before retrying — this will not retry automatically.`,
          code: rejected ? 'qbo_rejected' : 'post_unknown',
          docNumber: claim.doc_number,
        },
        rejected ? 422 : 502,
      );
    }

    // --- 5. Commit ---------------------------------------------------------
    const { data: committed, error: commitError } = await supabase.rpc('qbo_commit_post', {
      p_lease_id: claim.lease_id, p_txn_id: created.Id,
      p_sync_token: created.SyncToken ?? null, p_posted_by: admin.email,
    });
    if (commitError) throw commitError;

    return json({
      posted: true, adopted: false,
      txnId: created.Id, syncToken: created.SyncToken ?? null,
      docNumber: created.DocNumber ?? claim.doc_number,
      txnDate: created.TxnDate, totalAmt: created.TotalAmt,
      attempts: claim.attempts, committed,
      realmId: conn.realm_id, environment: conn.environment,
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof NotConnectedError) return json({ error: e.message, code: e.code }, 409);
    console.error('qbo-post-je failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
