import fs from 'fs';
import { parseCoinbaseZip, parseStatementEntries, parseDetailCsv, CoinbaseParseError } from '@/lib/qbo/coinbase-parse';
import { computeCoinbaseJe } from '@/lib/qbo/coinbase-je';
import { computeSalesJe } from '@/lib/qbo/sales-je';
import { salesChecks, coinbaseChecks, checkSalesFreshness, hasBlocker } from '@/lib/qbo/checks';
import { detectDrift, monthStatus } from '@/lib/qbo/snapshot';
import { fmtAmount } from '@/lib/qbo/money';
import type { AccountMap, CryptoAsset, CoinbaseDetailRow, CoinbaseBalanceRow } from '@/lib/qbo/types';

// Point at a real Coinbase Prime monthly ZIP. The sample is intentionally not
// committed — it holds account data — so pass your own path:
//   COINBASE_ZIP="~/Downloads/Coinbase Monthly Files.zip" npm run qbo:harness
const ZIP = (process.env.COINBASE_ZIP || `${process.env.HOME}/Downloads/Coinbase Monthly Files.zip`)
  .replace(/^~/, process.env.HOME || '~');
if (!fs.existsSync(ZIP)) {
  console.error(`No Coinbase ZIP at ${ZIP}. Set COINBASE_ZIP to a monthly export and re-run.`);
  process.exit(2);
}
let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`);
};

const ACCOUNTS: AccountMap = {
  machine_cash: 'BTC Machine Cash',
  transaction_fees: 'Transaction Fees',
  bitstop_fees: 'Bitstop Fees',
  exchange_account: 'Exchange Account - Coinbase',
  exchange_fees: 'Exchange Fees',
};
const ASSETS: CryptoAsset[] = [
  { symbol: 'BTC', name: 'Bitcoin', default_treatment: 'inventory', inventory_account_name: 'Inventory - Bitcoin', investment_account_name: 'Long-term Investments:Bitcoin', active: true },
  { symbol: 'SOL', name: 'Solana', default_treatment: 'investment', inventory_account_name: 'Inventory - Solana', investment_account_name: 'Long-term Investments:Solana (SOL)', active: true },
];

console.log('=== 1. Parse the real ZIP ===');
const blob = new Blob([fs.readFileSync(ZIP)]);
const stmt = await parseCoinbaseZip(blob);
console.log(`period ${stmt.periodStart}..${stmt.periodEnd}, month ${stmt.month}, detail rows ${stmt.detail.length}, balance rows ${stmt.balances.length}`);
ok('uses detail_ + asset_balances_ only', stmt.detailFilename.startsWith('detail_') && stmt.balancesFilename.startsWith('asset_balances_'));
ok('period derived from filename', stmt.month === '2026-08' && stmt.periodStart === '2026-08-01' && stmt.periodEnd === '2026-08-31');
ok('11 detail rows parsed', stmt.detail.length === 11, `${stmt.detail.length}`);
ok('timestamps parsed to UTC ISO', stmt.detail.every(r => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.dateCompleted)));
ok('leading TABs trimmed', stmt.detail.every(r => !/^\s/.test(r.wallet) && !/^\s/.test(r.portfolio)));
ok('full-precision USD start balance', String(stmt.balances.find(b => b.asset === 'USD')!.startingBalance).startsWith('69692.404'));

console.log('\n=== 2. Coinbase JE vs the oracle ===');
const cb = computeCoinbaseJe({ month: '2026-08', rows: stmt.detail, balances: stmt.balances, overrides: [], assets: ASSETS, accounts: ACCOUNTS });
for (const l of cb.je.lines) console.log(`   ${l.account.padEnd(36)} DR ${l.debit ? fmtAmount(l.debit).padStart(12) : ''.padStart(12)}  CR ${l.credit ? fmtAmount(l.credit).padStart(12) : ''.padStart(12)}  ${l.description}`);
const line = (acct: string) => cb.je.lines.find(l => l.account === acct);
ok('CR Exchange Account - Coinbase 65,814.95', line('Exchange Account - Coinbase')?.credit === 65814.95, fmtAmount(line('Exchange Account - Coinbase')?.credit ?? 0));
ok('DR Inventory - Bitcoin 65,650.84', line('Inventory - Bitcoin')?.debit === 65650.84, fmtAmount(line('Inventory - Bitcoin')?.debit ?? 0));
ok('DR Exchange Fees 164.11', line('Exchange Fees')?.debit === 164.11, fmtAmount(line('Exchange Fees')?.debit ?? 0));
ok('JE balances', cb.je.totalDebits === cb.je.totalCredits, `${fmtAmount(cb.je.totalDebits)} / ${fmtAmount(cb.je.totalCredits)}`);
ok('3 buys, all FILLED BTC', cb.buys.length === 3 && cb.buys.every(b => b.coin === 'BTC' && b.status === 'FILLED'));
ok('impact tie-out difference 0', cb.impactTieOut.difference === 0, `credit ${fmtAmount(cb.impactTieOut.jeCredit)} vs ${fmtAmount(cb.impactTieOut.negatedImpact)}`);
ok('USD tie-out difference 0', Math.abs(cb.usdTieOut.difference) < 0.005, `${cb.usdTieOut.startingBalance} + ${cb.usdTieOut.impactSum} vs ${cb.usdTieOut.actualEnding}`);
ok('JE date is month end', cb.je.date === '2026-08-31' && cb.je.monthText === 'August 2026');
ok('deposit/withdrawals excluded from JE', cb.buys.every(b => b.activityId.length > 0) && cb.je.lines.length === 3);
ok('no blocking checks', !hasBlocker(coinbaseChecks(cb)), coinbaseChecks(cb).map(c => `${c.severity}:${c.message}`).join(' | ') || 'none');
ok('LINK in balances does not block', !coinbaseChecks(cb).some(c => c.message.includes('LINK')));

console.log('\n=== 3. Treatment override flips the account ===');
const btcTrade = cb.buys[0];
const cbOverride = computeCoinbaseJe({ month: '2026-08', rows: stmt.detail, balances: stmt.balances, assets: ASSETS, accounts: ACCOUNTS,
  overrides: [{ activity_id: btcTrade.activityId, asset_symbol: 'BTC', treatment: 'investment' }] });
const inv = cbOverride.je.lines.find(l => l.account === 'Long-term Investments:Bitcoin');
// buys are date-sorted, so buys[0] is the Aug 4 trade (32,130.96)
ok('override moves that buy to investments', inv?.debit === 32130.96, fmtAmount(inv?.debit ?? 0));
ok('inventory line reduced accordingly', cbOverride.je.lines.find(l => l.account === 'Inventory - Bitcoin')?.debit === 33519.88,
   fmtAmount(cbOverride.je.lines.find(l => l.account === 'Inventory - Bitcoin')?.debit ?? 0));
ok('override split still sums to the oracle total', (inv?.debit ?? 0) + (cbOverride.je.lines.find(l => l.account === 'Inventory - Bitcoin')?.debit ?? 0) === 65650.84);
ok('override is flagged as an override', cbOverride.buys.filter(b => b.treatmentIsOverride).length === 1);
ok('credit total unchanged', cbOverride.je.totalCredits === cb.je.totalCredits);

console.log('\n=== 4. Idempotency of the row hash ===');
const again = await parseCoinbaseZip(new Blob([fs.readFileSync(ZIP)]));
const h1 = stmt.detail.map(r => r.rowHash).sort();
const h2 = again.detail.map(r => r.rowHash).sort();
ok('hashes stable across parses', JSON.stringify(h1) === JSON.stringify(h2));
ok('hashes unique per row (shared ID rows differ)', new Set(h1).size === 11, `${new Set(h1).size} distinct`);
ok('one trade ID appears on 2 rows', new Set(stmt.detail.map(r => r.activityId)).size === 8);

console.log('\n=== 5. Loud failures ===');
// Pull the two members straight out of the ZIP, so the harness needs no fixture files.
const zipEntries = await (await import('jszip')).default.loadAsync(fs.readFileSync(ZIP));
const readMember = async (prefix: string) => {
  const name = Object.keys(zipEntries.files).find(n => (n.split('/').pop() || n).startsWith(prefix))!;
  return zipEntries.files[name].async('string');
};
const detailText = await readMember('detail_');
const balText = await readMember('asset_balances_');
const expectThrow = async (label: string, fn: () => Promise<unknown>, needle: string) => {
  try { await fn(); ok(label, false, 'did not throw'); }
  catch (e) { const m = (e as Error).message; ok(label, e instanceof CoinbaseParseError && m.includes(needle), m.slice(0, 110)); }
};
await expectThrow('missing detail_ file', () => parseStatementEntries({ 'asset_balances_2026-08-01_2026-08-31.csv': balText }), 'no detail_');
await expectThrow('missing asset_balances_ file', () => parseStatementEntries({ 'detail_2026-08-01_2026-08-31.csv': detailText }), 'no asset_balances_');
await expectThrow('renamed column', () => parseDetailCsv(detailText.replace('Total Balance Impact', 'Balance Impact'), 'detail_2026-08-01_2026-08-31.csv'), 'does not have the expected');
await expectThrow('unparseable period in filename', () => parseDetailCsv(detailText, 'detail_august.csv'), 'Cannot read the statement period');
await expectThrow('mismatched periods between files', () => parseStatementEntries({ 'detail_2026-08-01_2026-08-31.csv': detailText, 'asset_balances_2026-07-01_2026-07-31.csv': balText }), 'different periods');

console.log('\n=== 6. Out-of-month + SELL rows block ===');
// A row INSIDE August's statement but dated in September — the genuine
// "this upload covers a different period" signal. (Selecting a month whose
// statement was never uploaded is NOT this: it yields no rows at all, and
// hasCoinbaseData suppresses the checks entirely. Asserting the old way —
// month '2026-07' against August's statement — is what let every statement
// block every other one; see section 10.)
const strayAug = stmt.detail.map((r, i) => i === 0 ? { ...r, dateCompleted: '2026-09-02T12:00:00.000Z' } : r);
const cbWrongMonth = computeCoinbaseJe({ month: '2026-08', rows: strayAug, balances: stmt.balances, overrides: [], assets: ASSETS, accounts: ACCOUNTS });
ok('rows outside the month block', coinbaseChecks(cbWrongMonth).some(c => c.severity === 'BLOCK' && c.message.includes('outside the selected month')));
const cbMissingStatement = computeCoinbaseJe({ month: '2026-07', rows: stmt.detail, balances: stmt.balances, overrides: [], assets: ASSETS, accounts: ACCOUNTS });
ok('a month with no statement of its own reports nothing, not a block',
   cbMissingStatement.outOfMonthRows.length === 0 && cbMissingStatement.buys.length === 0,
   `${cbMissingStatement.outOfMonthRows.length} out-of-month, ${cbMissingStatement.buys.length} buys`);
const withSell = stmt.detail.map(r => r.activityDescription.startsWith('BUY') && r.asset === 'USD' ? { ...r, activityDescription: 'SELL BTC/USD - LIMIT' } : r);
ok('SELL rows block', coinbaseChecks(computeCoinbaseJe({ month: '2026-08', rows: withSell, balances: stmt.balances, overrides: [], assets: ASSETS, accounts: ACCOUNTS })).some(c => c.severity === 'BLOCK' && c.message.includes('SELL')));
const noBtc = computeCoinbaseJe({ month: '2026-08', rows: stmt.detail, balances: stmt.balances, overrides: [], accounts: ACCOUNTS, assets: ASSETS.filter(a => a.symbol !== 'BTC') });
ok('unknown asset says "Add BTC in Settings."', coinbaseChecks(noBtc).some(c => c.severity === 'BLOCK' && c.message === 'Add BTC in Settings.'));
const notFilled = stmt.detail.map(r => r.asset === 'USD' && r.status === 'FILLED' ? { ...r, status: 'PENDING' } : r);
const nf = coinbaseChecks(computeCoinbaseJe({ month: '2026-08', rows: notFilled, balances: stmt.balances, overrides: [], assets: ASSETS, accounts: ACCOUNTS }));
ok('non-FILLED is WARN not BLOCK', nf.some(c => c.severity === 'WARN' && c.message.includes('FILLED')) && !nf.some(c => c.severity === 'BLOCK'));

console.log('\n=== 7. Sales JE (synthetic, checks the rules) ===');
const profiles = [
  { id: 'p1', atm_id: '100', platform: 'denet', installed_date: '2022-01-01', removed_date: null },
  { id: 'p2', atm_id: '200', platform: 'bitstop', installed_date: '2022-01-01', removed_date: null },
  { id: 'p3', atm_id: '300', platform: 'denet', installed_date: '2026-08-15', removed_date: null },
];
const tx = (id: string, atm_id: string, date: string, sale: number, fee: number, sent: number, op: number, status = 'completed', ticker = 'BTC') =>
  ({ id, atm_id, date, ticker, status, sale, fee, sent, bitstop_fee: op });
const salesTxs = [
  tx('a', '100', '2026-08-03 10:00:00', 1000, 250, 750, 45),
  tx('b', '100', '2026-08-20 11:00:00', 500, 125, 375, 22.5),
  tx('c', '200', '2026-08-04 09:00:00', 9999, 2000, 7999, 400),          // Bitstop machine → excluded
  tx('d', '100', '2026-08-05 09:00:00', 300, 75, 225, 13.5, 'under_review'), // not completed → excluded
  tx('e', '100', '2026-07-31 23:00:00', 700, 175, 525, 31.5),            // other month → excluded
  tx('f', '300', '2026-08-01 09:00:00', 400, 100, 300, 18),              // before install → unattributed
];
const sales = computeSalesJe({ month: '2026-08', transactions: salesTxs, profiles, assets: ASSETS, accounts: ACCOUNTS });
for (const l of sales.je.lines) console.log(`   ${l.account.padEnd(36)} DR ${l.debit ? fmtAmount(l.debit).padStart(10) : ''.padStart(10)}  CR ${l.credit ? fmtAmount(l.credit).padStart(10) : ''.padStart(10)}  ${l.description}`);
ok('only Denet completed in-month rows included', sales.includedTxCount === 2, `${sales.includedTxCount}`);
ok('DR machine cash = Σ fiat', sales.je.lines[0].debit === 1500);
ok('CR transaction fees = Σ fee', sales.je.lines.find(l => l.account === 'Transaction Fees')?.credit === 375);
ok('CR inventory (sales) = Σ enviando', sales.je.lines.filter(l => l.account === 'Inventory - Bitcoin')[0].credit === 1125);
ok('DR bitstop fees = Σ operator fee', sales.je.lines.find(l => l.account === 'Bitstop Fees')?.debit === 67.5);
ok('CR inventory (operator fee) separate line', sales.je.lines.filter(l => l.account === 'Inventory - Bitcoin')[1].credit === 67.5);
ok('5 lines, two inventory credits kept apart', sales.je.lines.length === 5);
ok('JE balances', sales.je.totalDebits === sales.je.totalCredits, `${fmtAmount(sales.je.totalDebits)} / ${fmtAmount(sales.je.totalCredits)}`);
ok('non-completed counted as INFO', salesChecks(sales).some(c => c.severity === 'INFO' && c.message.startsWith('1 non-completed')));
ok('unattributed row blocks', salesChecks(sales).some(c => c.severity === 'BLOCK' && c.message.includes('matched no ATM profile window')));

const multiCoin = computeSalesJe({ month: '2026-08', profiles, assets: ASSETS, accounts: ACCOUNTS,
  transactions: [tx('a', '100', '2026-08-03 10:00:00', 1000, 250, 750, 45), tx('g', '100', '2026-08-06 10:00:00', 200, 50, 150, 9, 'completed', 'SOL')] });
ok('multi-coin splits inventory lines per coin', multiCoin.je.lines.filter(l => l.account.startsWith('Inventory - ')).length === 4,
   multiCoin.je.lines.filter(l => l.account.startsWith('Inventory - ')).map(l => l.account).join(', '));
const badIdentity = computeSalesJe({ month: '2026-08', profiles, assets: ASSETS, accounts: ACCOUNTS, transactions: [tx('a', '100', '2026-08-03 10:00:00', 1000, 250, 700, 45)] });
ok('fiat ≠ fee + enviando blocks', salesChecks(badIdentity).some(c => c.severity === 'BLOCK' && c.message.includes('fiat ≠ fee + enviando')));
const unknownCoin = computeSalesJe({ month: '2026-08', profiles, accounts: ACCOUNTS, assets: ASSETS.filter(a => a.symbol !== 'BTC'), transactions: [tx('a', '100', '2026-08-03 10:00:00', 1000, 250, 750, 45)] });
ok('unknown sales coin says "Add BTC in Settings."', salesChecks(unknownCoin).some(c => c.message === 'Add BTC in Settings.'));

console.log('\n=== 8. Freshness guard ===');
ok('stale upload blocks', checkSalesFreshness('2026-08', { latestDenetUploadAt: '2026-08-15T00:00:00Z' })?.message === 'Upload a fresh YTD Denet CSV first.');
ok('fresh upload passes', checkSalesFreshness('2026-08', { latestDenetUploadAt: '2026-09-01T00:00:00Z' }) === null);
ok('no upload at all blocks', checkSalesFreshness('2026-08', { latestDenetUploadAt: null })?.severity === 'BLOCK');

console.log('\n=== 9. Drift ===');
const snap = { lines: sales.je.lines, total_debits: sales.je.totalDebits, total_credits: sales.je.totalCredits };
ok('no drift against itself', !detectDrift(snap, sales.je).drifted);
const afterStatusChange = computeSalesJe({ month: '2026-08', profiles, assets: ASSETS, accounts: ACCOUNTS,
  transactions: salesTxs.map(t => t.id === 'd' ? { ...t, status: 'completed' } : t) });
const drift = detectDrift(snap, afterStatusChange.je);
ok('late status change shows as drift', drift.drifted && drift.diffs.length > 0);
for (const d of drift.diffs) console.log(`   ${d.kind.padEnd(8)} ${d.account.padEnd(24)} DR ${fmtAmount(d.snapshotDebit)} → ${fmtAmount(d.currentDebit)}   CR ${fmtAmount(d.snapshotCredit)} → ${fmtAmount(d.currentCredit)}`);
ok('machine cash delta is +300', drift.diffs.find(d => d.account === 'BTC Machine Cash')?.debitDelta === 300);
ok('month status: entered → drifted', monthStatus({ hasData: true, hasBlockers: false, snapshotExists: true, drifted: true }) === 'drifted');
ok('month status: ready / blocked / no data', monthStatus({ hasData: true, hasBlockers: false, snapshotExists: false, drifted: false }) === 'ready'
  && monthStatus({ hasData: true, hasBlockers: true, snapshotExists: false, drifted: false }) === 'blocked'
  && monthStatus({ hasData: false, hasBlockers: false, snapshotExists: false, drifted: false }) === 'no_data');

console.log('\n=== 10. Two statements loaded must not block each other ===');
// Regression: the out-of-month BLOCK counted rows from EVERY uploaded
// statement, not just the selected month's. With Feb and Aug both present,
// February reported August's rows as "dated outside the selected month" and
// August reported February's — each statement internally clean, each blocked
// purely by the other's existence.
//
// A synthetic February statement, shaped like the real one: period_start /
// period_end in Feb, rows dated in Feb.
const febRow = (n: number, asset: string, amount: number, fee: number, desc: string): CoinbaseDetailRow => ({
  rowHash: `feb-${n}`, periodStart: '2026-02-01', periodEnd: '2026-02-28',
  dateCompleted: `2026-02-${String(10 + n).padStart(2, '0')}T12:00:00.000Z`,
  activityId: `feb-act-${n}`, activityType: 'Order',
  activityDescription: desc, asset, status: 'FILLED',
  amount, fee, totalBalanceImpact: -(amount + fee),
  wallet: 'w', walletType: 'trading', walletId: 'wid', portfolio: 'p',
  portfolioId: 'pid', entity: 'e', sourceFilename: 'detail_2026-02-01_2026-02-28.csv',
});
const febRows: CoinbaseDetailRow[] = [
  febRow(1, 'USD', 1000, 5, 'BUY BTC/USD - LIMIT'),
  febRow(2, 'BTC', 0.02, 0, 'BUY BTC/USD - LIMIT'),
];
const febBalances: CoinbaseBalanceRow[] = [{
  periodStart: '2026-02-01', periodEnd: '2026-02-28', asset: 'USD',
  portfolio: 'p', portfolioId: 'pid',
  startingBalance: 5000, endingBalance: 5000 - 1005,
  startingBalanceUsd: null, endingBalanceUsd: null,
  sourceFilename: 'asset_balances_2026-02-01_2026-02-28.csv',
}];

// BOTH statements in one array, exactly as fetchCoinbaseRowsForMonths returns them.
const bothRows = [...stmt.detail, ...febRows];
const bothBalances = [...stmt.balances, ...febBalances];

const augBoth = computeCoinbaseJe({
  month: '2026-08', rows: bothRows,
  balances: bothBalances.filter(b => b.periodStart.slice(0, 7) === '2026-08'),
  overrides: [], assets: ASSETS, accounts: ACCOUNTS,
});
const febBoth = computeCoinbaseJe({
  month: '2026-02', rows: bothRows,
  balances: bothBalances.filter(b => b.periodStart.slice(0, 7) === '2026-02'),
  overrides: [], assets: ASSETS, accounts: ACCOUNTS,
});

ok('August sees no out-of-month rows with Feb also loaded', augBoth.outOfMonthRows.length === 0, `${augBoth.outOfMonthRows.length}`);
ok('February sees no out-of-month rows with Aug also loaded', febBoth.outOfMonthRows.length === 0, `${febBoth.outOfMonthRows.length}`);
ok('neither month is blocked by the other', !hasBlocker(coinbaseChecks(augBoth)) && !hasBlocker(coinbaseChecks(febBoth)),
   `aug=${coinbaseChecks(augBoth).filter(c => c.severity === 'BLOCK').map(c => c.id).join(',') || 'none'} feb=${coinbaseChecks(febBoth).filter(c => c.severity === 'BLOCK').map(c => c.id).join(',') || 'none'}`);

// Each month still computes only its own statement.
ok('August JE unchanged by February being loaded',
   augBoth.je.totalDebits === cb.je.totalDebits && augBoth.je.totalCredits === cb.je.totalCredits,
   `${fmtAmount(augBoth.je.totalCredits)} vs ${fmtAmount(cb.je.totalCredits)}`);
ok('February JE reflects only February', febBoth.buys.length === 1 && febBoth.je.totalCredits === 1005,
   `${febBoth.buys.length} buy(s), credit ${fmtAmount(febBoth.je.totalCredits)}`);
ok("February's USD tie-out is clean", Math.abs(febBoth.usdTieOut.difference) < 0.005, fmtAmount(febBoth.usdTieOut.difference));

// The check must still fire for a genuine offender: a row INSIDE February's
// statement but dated outside February.
const strayRow = { ...febRow(9, 'USD', 50, 0, 'BUY BTC/USD - LIMIT'), dateCompleted: '2026-03-02T12:00:00.000Z' };
const febStray = computeCoinbaseJe({
  month: '2026-02', rows: [...bothRows, strayRow],
  balances: bothBalances.filter(b => b.periodStart.slice(0, 7) === '2026-02'),
  overrides: [], assets: ASSETS, accounts: ACCOUNTS,
});
ok('a row inside the statement but dated outside the month still BLOCKS',
   febStray.outOfMonthRows.length === 1 && hasBlocker(coinbaseChecks(febStray)),
   `${febStray.outOfMonthRows.length} out-of-month`);

console.log(failures ? `\n${failures} FAILURES` : '\nAll harness checks passed.');
process.exit(failures ? 1 : 0);
