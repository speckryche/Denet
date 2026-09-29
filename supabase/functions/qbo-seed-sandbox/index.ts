// Create our chart of accounts in the Intuit SANDBOX company. Admin only.
//
// THIS IS THE ONLY STAGE-A/B FUNCTION THAT WRITES TO QUICKBOOKS, and it is
// fenced twice before it will do anything:
//
//   1. QBO_ENV must be 'sandbox'.
//   2. The connected realm must be the known sandbox realm.
//
// Both, not either. The env var says what we think we are pointed at; the realm
// says what we are ACTUALLY connected to. Checking only the first would let a
// stale secret paired with a production connection scribble a chart of accounts
// into the real books — accounts that cannot be deleted in QBO, only made
// inactive. The second check is the one that would catch that.
//
// Idempotent: existing accounts are matched by AcctNum and skipped, so a re-run
// after a partial failure completes the rest instead of duplicating.
//
// "Inventory - Solana" is deliberately NOT created. It does not exist in the
// production chart, and seeding it here would make the sandbox diverge from
// production in exactly the direction that hides a real mapping gap.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, NotConnectedError, json, qboFetch, requireAdmin, serviceClient } from '../_shared/qbo.ts';

// The sandbox company this project is tested against. Hardcoded on purpose:
// a value read from config could be changed by the same mistake it guards.
const SANDBOX_REALM_ID = '9341457959689478';

interface SeedAccount {
  acctNum: string;
  name: string;
  type: string;
  subType?: string;
  /** AcctNum of the parent, for sub-accounts. */
  parentAcctNum?: string;
}

// Ordered parents-before-children: a sub-account needs its parent's Id, which
// only exists once the parent is created.
const CHART: SeedAccount[] = [
  { acctNum: '1005', name: 'BTC Machine Cash',          type: 'Bank',               subType: 'CashOnHand' },
  { acctNum: '1010', name: 'Exchange Account - Coinbase', type: 'Bank',             subType: 'CashOnHand' },
  { acctNum: '1100', name: 'Bitcoin S/T Holdings',      type: 'Other Current Asset', subType: 'OtherCurrentAssets' },

  { acctNum: '1600', name: 'Long-term Investments',     type: 'Other Asset',        subType: 'LongTermInvestments' },
  { acctNum: '1605', name: 'Bitcoin (BTC)',             type: 'Other Asset',        subType: 'LongTermInvestments', parentAcctNum: '1600' },
  { acctNum: '1610', name: 'Solana (SOL)',              type: 'Other Asset',        subType: 'LongTermInvestments', parentAcctNum: '1600' },

  { acctNum: '4060', name: 'Transaction Fees',          type: 'Income',             subType: 'ServiceFeeIncome' },
  { acctNum: '4061', name: 'Fees - Denet BTMs',         type: 'Income',             subType: 'ServiceFeeIncome', parentAcctNum: '4060' },
  { acctNum: '4062', name: 'Fees - Bitstop BTMs',       type: 'Income',             subType: 'ServiceFeeIncome', parentAcctNum: '4060' },
  // Three levels deep: 4060 -> 4062 -> 4063.
  { acctNum: '4063', name: 'Refund Clawbacks - Bitstop', type: 'Income',            subType: 'ServiceFeeIncome', parentAcctNum: '4062' },

  { acctNum: '5015', name: 'Bitstop Fees',              type: 'Cost of Goods Sold', subType: 'SuppliesMaterialsCogs' },
  { acctNum: '6040', name: 'Exchange Fees',             type: 'Expense',            subType: 'BankCharges' },
];

interface QboAccount { Id: string; Name: string; AcctNum?: string; FullyQualifiedName?: string; Active?: boolean }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    await requireAdmin(req, supabase);

    // Fence 1: what we think we are pointed at.
    const env = (Deno.env.get('QBO_ENV') ?? '').toLowerCase();
    if (env !== 'sandbox') {
      return json(
        { error: `Refusing to seed: QBO_ENV is '${env || 'unset'}', not 'sandbox'.`, code: 'not_sandbox_env' },
        409,
      );
    }

    // Fence 2: what we are actually connected to.
    const { data: connData, error: connError } = await supabase.rpc('qbo_get_connection');
    if (connError) throw connError;
    const conn = Array.isArray(connData) ? connData[0] : connData;
    if (!conn) return json({ error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);
    if (conn.realm_id !== SANDBOX_REALM_ID) {
      return json(
        {
          error:
            `Refusing to seed: connected to realm ${conn.realm_id} (${conn.company_name ?? 'unknown company'}), ` +
            `which is not the sandbox realm ${SANDBOX_REALM_ID}. This function never writes to a production company.`,
          code: 'not_sandbox_realm',
        },
        409,
      );
    }

    // Existing accounts, so a re-run skips what is already there.
    const existingRes = (await qboFetch(supabase, '/query', {
      searchParams: { query: 'SELECT Id, Name, AcctNum, FullyQualifiedName, Active FROM Account MAXRESULTS 1000' },
    })) as { QueryResponse?: { Account?: QboAccount[] } };
    const existing = existingRes?.QueryResponse?.Account ?? [];
    const byAcctNum = new Map(existing.filter((a) => a.AcctNum).map((a) => [a.AcctNum!.trim(), a]));

    const created: Array<{ acctNum: string; name: string; id: string }> = [];
    const skipped: Array<{ acctNum: string; name: string; id: string }> = [];
    const failed: Array<{ acctNum: string; name: string; error: string }> = [];

    for (const spec of CHART) {
      const already = byAcctNum.get(spec.acctNum);
      if (already) {
        skipped.push({ acctNum: spec.acctNum, name: already.FullyQualifiedName ?? already.Name, id: already.Id });
        continue;
      }

      const parent = spec.parentAcctNum ? byAcctNum.get(spec.parentAcctNum) : undefined;
      if (spec.parentAcctNum && !parent) {
        failed.push({ acctNum: spec.acctNum, name: spec.name, error: `Parent ${spec.parentAcctNum} not found` });
        continue;
      }

      const body: Record<string, unknown> = {
        Name: spec.name,
        AcctNum: spec.acctNum,
        AccountType: spec.type,
        ...(spec.subType ? { AccountSubType: spec.subType } : {}),
        ...(parent ? { SubAccount: true, ParentRef: { value: parent.Id } } : {}),
      };

      try {
        let res: any;
        try {
          res = await qboFetch(supabase, '/account', { method: 'POST', body: JSON.stringify(body) });
        } catch (e) {
          // AccountSubType is an enum that varies by QBO locale and edition. If
          // it is rejected, retry with the type alone and let QBO pick its own
          // default rather than failing the whole seed over a label.
          if (spec.subType && String(e).includes('AccountSubType')) {
            delete body.AccountSubType;
            res = await qboFetch(supabase, '/account', { method: 'POST', body: JSON.stringify(body) });
          } else {
            throw e;
          }
        }
        const acct = res?.Account as QboAccount | undefined;
        if (!acct?.Id) throw new Error('No Account returned');
        byAcctNum.set(spec.acctNum, acct);
        created.push({ acctNum: spec.acctNum, name: acct.FullyQualifiedName ?? acct.Name, id: acct.Id });
      } catch (e) {
        failed.push({ acctNum: spec.acctNum, name: spec.name, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      }
    }

    // The Coinbase vendor, for EntityRef on the Coinbase JE.
    let vendor: { Id: string; DisplayName: string } | null = null;
    let vendorCreated = false;
    try {
      const vres = (await qboFetch(supabase, '/query', {
        searchParams: { query: "SELECT Id, DisplayName FROM Vendor WHERE DisplayName = 'Coinbase'" },
      })) as { QueryResponse?: { Vendor?: Array<{ Id: string; DisplayName: string }> } };
      vendor = vres?.QueryResponse?.Vendor?.[0] ?? null;
      if (!vendor) {
        const made = (await qboFetch(supabase, '/vendor', {
          method: 'POST',
          body: JSON.stringify({ DisplayName: 'Coinbase' }),
        })) as { Vendor?: { Id: string; DisplayName: string } };
        vendor = made?.Vendor ?? null;
        vendorCreated = vendor != null;
      }
    } catch (e) {
      console.error('Coinbase vendor seed failed:', e);
    }

    return json({
      realmId: conn.realm_id,
      companyName: conn.company_name,
      created,
      skipped,
      failed,
      vendor,
      vendorCreated,
      note: '"Inventory - Solana" is intentionally not created — it does not exist in production.',
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof NotConnectedError) return json({ error: e.message, code: e.code }, 409);
    console.error('qbo-seed-sandbox failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
