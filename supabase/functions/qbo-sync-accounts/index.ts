// Fetch the QBO chart of accounts (and the Coinbase vendor) and resolve our
// stored account names to QuickBooks Account Ids. Admin only.
//
// READ-ONLY AGAINST QUICKBOOKS. Every call here is a query; nothing is created
// or modified in QBO. The only writes are Account Ids into our own mapping.
//
// IT NEVER WRITES account_name. qbo_je_snapshots.lines freezes the resolved
// account names of every entered month, and detectDrift compares against them
// keyed on account+description — so rewriting a name would mark already-entered
// months as drifted. Ids are additive and invisible to drift.
//
// The realm is recorded alongside each Id. Sandbox and production are different
// company files with independent Id spaces; without this, syncing against
// sandbox and later connecting production would leave Ids that silently point
// at nothing, or at an unrelated account that happens to share the number.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, json, qboFetch, requireAdmin, serviceClient, NotConnectedError } from '../_shared/qbo.ts';

interface QboAccount {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  AcctNum?: string;
  AccountType?: string;
  Active?: boolean;
}

// QBO caps a query at 1000 rows and has no cursor — you page with STARTPOSITION.
const PAGE = 1000;

async function fetchAllAccounts(supabase: ReturnType<typeof serviceClient>): Promise<QboAccount[]> {
  const out: QboAccount[] = [];
  for (let start = 1; ; start += PAGE) {
    const res = (await qboFetch(supabase, '/query', {
      searchParams: {
        query: `SELECT Id, Name, FullyQualifiedName, AcctNum, AccountType, Active FROM Account STARTPOSITION ${start} MAXRESULTS ${PAGE}`,
      },
    })) as { QueryResponse?: { Account?: QboAccount[] } };
    const batch = res?.QueryResponse?.Account ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    await requireAdmin(req, supabase);

    const { data: connData, error: connError } = await supabase.rpc('qbo_get_connection');
    if (connError) throw connError;
    const conn = Array.isArray(connData) ? connData[0] : connData;
    if (!conn) {
      return json({ error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);
    }

    const accounts = await fetchAllAccounts(supabase);

    // The Coinbase vendor, for EntityRef on the Coinbase JE's exchange-account
    // line. Absent is not an error here — it becomes a BLOCK at post time, and
    // only for a JE that actually needs it.
    let vendor: { Id: string; DisplayName: string } | null = null;
    try {
      const vres = (await qboFetch(supabase, '/query', {
        searchParams: { query: "SELECT Id, DisplayName FROM Vendor WHERE DisplayName = 'Coinbase'" },
      })) as { QueryResponse?: { Vendor?: Array<{ Id: string; DisplayName: string }> } };
      vendor = vres?.QueryResponse?.Vendor?.[0] ?? null;
    } catch (e) {
      console.warn('Coinbase vendor lookup failed (non-fatal):', e);
    }

    // The matching itself is pure and lives in src/lib/qbo/account-match.ts so
    // it can be exercised by the harness against the real stored names. This
    // function returns the raw account list and lets the client match, so there
    // is exactly one matcher rather than a second Deno copy to keep in lockstep
    // (the transaction-status mirror is the cautionary precedent).
    return json({
      realmId: conn.realm_id,
      environment: conn.environment,
      companyName: conn.company_name,
      accounts,
      vendor,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof NotConnectedError) return json({ error: e.message, code: e.code }, 409);
    console.error('qbo-sync-accounts failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
