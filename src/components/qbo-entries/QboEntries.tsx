// QBO Entries — Stage 1.
//
// Computes the two monthly journal entries (Denet machine sales, Coinbase
// purchases), runs the validation checks, and records what was entered in QBO
// so a later change shows up as drift.
//
// Admin-only, matching UserManagement's hard block: the page both reveals
// bookkeeping figures and writes the "entered" snapshots.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  BookOpen,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';

import { computeSalesJe } from '@/lib/qbo/sales-je';
import { computeCoinbaseJe } from '@/lib/qbo/coinbase-je';
import {
  checkSalesFreshness,
  coinbaseChecks,
  hasBlocker,
  salesChecks,
} from '@/lib/qbo/checks';
import {
  detectDrift,
  monthStatus,
  MONTH_STATUS_LABEL,
  monthStatusLabel,
  type MonthStatus,
} from '@/lib/qbo/snapshot';
import {
  currentMonth,
  isValidMonth,
  monthEndDate,
  monthStartDate,
  monthText,
  monthsBetween,
} from '@/lib/qbo/period';
import {
  countNonCompletedInRange,
  deleteSnapshot,
  fetchAccountRows,
  fetchBuyTreatments,
  fetchCoinbaseRowsForMonths,
  fetchCryptoAssets,
  fetchLatestDenetUploadAt,
  fetchProfiles,
  fetchSnapshots,
  fetchTransactionsForRange,
  saveBuyTreatment,
  saveSnapshot,
  toAccountMap,
  type SnapshotRow,
} from '@/lib/qbo/data';
import type {
  BuyTreatmentOverride,
  Check,
  CoinbaseBalanceRow,
  CoinbaseBuy,
  CoinbaseDetailRow,
  CryptoAsset,
  Je,
  JeType,
  SalesProfileLike,
  SalesTxLike,
  Treatment,
} from '@/lib/qbo/types';

import { JeTable } from './JeTable';
import { ChecksPanel } from './ChecksPanel';
import { DriftBanner } from './DriftBanner';
import { CoinbaseUpload } from './CoinbaseUpload';
import { CoinbaseBuysTable } from './CoinbaseBuysTable';

// The backlog starts here; earlier months were entered before this module.
const FIRST_MONTH = '2026-01';

const STATUS_STYLES: Record<MonthStatus, string> = {
  no_data: 'bg-white/5 text-muted-foreground border-white/10',
  ready: 'bg-green-500/15 text-green-400 border-green-500/30',
  blocked: 'bg-red-500/15 text-red-400 border-red-500/30',
  partial: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  entered: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  drifted: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

export default function QboEntries() {
  const { role, user } = useAuth();
  const isAdmin = role === 'admin';

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [transactions, setTransactions] = useState<SalesTxLike[]>([]);
  const [profiles, setProfiles] = useState<SalesProfileLike[]>([]);
  const [assets, setAssets] = useState<CryptoAsset[]>([]);
  const [accounts, setAccounts] = useState(toAccountMap([]));
  const [coinbaseRows, setCoinbaseRows] = useState<CoinbaseDetailRow[]>([]);
  const [balances, setBalances] = useState<CoinbaseBalanceRow[]>([]);
  const [overrides, setOverrides] = useState<BuyTreatmentOverride[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [latestDenetUploadAt, setLatestDenetUploadAt] = useState<string | null>(null);
  const [nonCompletedByMonth, setNonCompletedByMonth] = useState<Record<string, number>>({});

  const months = useMemo(
    () => monthsBetween(FIRST_MONTH, currentMonth()).reverse(),
    [],
  );

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const oldest = months[months.length - 1];
      const newest = months[0];
      const [
        txRows,
        profileRows,
        assetRows,
        accountRows,
        coinbase,
        treatmentRows,
        snapshotRows,
        uploadAt,
      ] = await Promise.all([
        fetchTransactionsForRange(monthStartDate(oldest), monthEndDate(newest)),
        fetchProfiles(),
        fetchCryptoAssets(),
        fetchAccountRows(),
        fetchCoinbaseRowsForMonths(months),
        fetchBuyTreatments(),
        fetchSnapshots(),
        fetchLatestDenetUploadAt(),
      ]);

      setTransactions(txRows);
      setProfiles(profileRows);
      setAssets(assetRows);
      setAccounts(toAccountMap(accountRows));
      setCoinbaseRows(coinbase.detail);
      setBalances(coinbase.balances);
      setOverrides(treatmentRows);
      setSnapshots(snapshotRows);
      setLatestDenetUploadAt(uploadAt);
    } catch (err) {
      console.error('QBO Entries: failed to load data', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [months]);

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin, loadAll]);

  // The INFO check counts excluded rows, which the completed-only fetch above
  // cannot see, so it is counted per month on demand.
  useEffect(() => {
    if (!isAdmin || !isValidMonth(selectedMonth)) return;
    let cancelled = false;
    countNonCompletedInRange(monthStartDate(selectedMonth), monthEndDate(selectedMonth))
      .then((count) => {
        if (!cancelled) setNonCompletedByMonth((prev) => ({ ...prev, [selectedMonth]: count }));
      })
      .catch((err) => console.error('QBO Entries: non-completed count failed', err));
    return () => {
      cancelled = true;
    };
  }, [isAdmin, selectedMonth]);

  const snapshotFor = useCallback(
    (month: string, jeType: JeType) =>
      snapshots.find((s) => s.month === month && s.je_type === jeType) || null,
    [snapshots],
  );

  // Both entries plus their checks, for any month.
  const computeMonth = useCallback(
    (month: string) => {
      const sales = computeSalesJe({ month, transactions, profiles, assets, accounts });
      const coinbase = computeCoinbaseJe({
        month,
        rows: coinbaseRows,
        balances: balances.filter((b) => b.periodStart.slice(0, 7) === month),
        overrides,
        assets,
        accounts,
      });

      // Scoped by statement period, matching computeCoinbaseJe. Keyed on
      // dateCompleted this would report "has data" for a month whose statement
      // was never uploaded, purely because a neighbouring statement happened to
      // contain a row dated in it — and then render checks for an empty JE.
      const hasCoinbaseData = coinbaseRows.some((r) => r.periodStart.slice(0, 7) === month);
      const salesCheckList: Check[] = salesChecks({
        ...sales,
        excludedNonCompletedCount: nonCompletedByMonth[month] ?? sales.excludedNonCompletedCount,
      });
      const freshness = checkSalesFreshness(month, { latestDenetUploadAt });
      if (freshness) salesCheckList.unshift(freshness);
      const coinbaseCheckList = hasCoinbaseData ? coinbaseChecks(coinbase) : [];

      return {
        sales,
        coinbase,
        hasCoinbaseData,
        hasSalesData: sales.includedTxCount > 0,
        salesCheckList,
        coinbaseCheckList,
      };
    },
    [
      transactions,
      profiles,
      assets,
      accounts,
      coinbaseRows,
      balances,
      overrides,
      latestDenetUploadAt,
      nonCompletedByMonth,
    ],
  );

  const statusFor = useCallback(
    (month: string) => {
      const { sales, coinbase, hasCoinbaseData, hasSalesData, salesCheckList, coinbaseCheckList } =
        computeMonth(month);
      const salesSnap = snapshotFor(month, 'sales');
      const coinbaseSnap = snapshotFor(month, 'coinbase');
      const drifted =
        (salesSnap ? detectDrift(salesSnap, sales.je).drifted : false) ||
        (coinbaseSnap ? detectDrift(coinbaseSnap, coinbase.je).drifted : false);

      // The Sales JE is always required once the month has any data. The
      // Coinbase JE is required only when the month actually has buys — a month
      // with no Coinbase activity is complete with Sales alone.
      const requiredJes: JeType[] = [];
      if (hasSalesData || hasCoinbaseData) requiredJes.push('sales');
      if (coinbase.buys.length > 0) requiredJes.push('coinbase');

      const markedJes: JeType[] = [];
      if (salesSnap) markedJes.push('sales');
      if (coinbaseSnap) markedJes.push('coinbase');

      const status = monthStatus({
        hasData: hasSalesData || hasCoinbaseData,
        hasBlockers: hasBlocker([...salesCheckList, ...coinbaseCheckList]),
        drifted,
        requiredJes,
        markedJes,
      });

      return {
        status,
        marked: markedJes.filter((j) => requiredJes.includes(j)).length,
        required: requiredJes.length,
      };
    },
    [computeMonth, snapshotFor],
  );

  const current = useMemo(
    () => (isValidMonth(selectedMonth) ? computeMonth(selectedMonth) : null),
    [computeMonth, selectedMonth],
  );

  const salesSnapshot = snapshotFor(selectedMonth, 'sales');
  const coinbaseSnapshot = snapshotFor(selectedMonth, 'coinbase');
  const salesDrift = current && salesSnapshot ? detectDrift(salesSnapshot, current.sales.je) : null;
  const coinbaseDrift =
    current && coinbaseSnapshot ? detectDrift(coinbaseSnapshot, current.coinbase.je) : null;

  const handleTreatmentChange = async (buy: CoinbaseBuy, treatment: Treatment) => {
    try {
      await saveBuyTreatment(buy.activityId, buy.coin, treatment, user?.email ?? null);
      setOverrides((prev) => {
        const rest = prev.filter(
          (o) => !(o.activity_id === buy.activityId && o.asset_symbol === buy.coin),
        );
        return [...rest, { activity_id: buy.activityId, asset_symbol: buy.coin, treatment }];
      });
    } catch (err) {
      console.error('Failed to save treatment', err);
      setError(err instanceof Error ? err.message : 'Failed to save the treatment');
    }
  };

  const markEntered = async (je: Je, label: string) => {
    setIsSaving(true);
    setError(null);
    try {
      await saveSnapshot(je, user?.email ?? null);
      setSnapshots(await fetchSnapshots());
      setNotice(`${label} recorded as entered in QBO.`);
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      console.error('Failed to save snapshot', err);
      setError(err instanceof Error ? err.message : 'Failed to record the entry');
    } finally {
      setIsSaving(false);
    }
  };

  const unmark = async (jeType: JeType, label: string) => {
    setIsSaving(true);
    try {
      await deleteSnapshot(selectedMonth, jeType);
      setSnapshots(await fetchSnapshots());
      setNotice(`${label} is no longer marked as entered.`);
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      console.error('Failed to delete snapshot', err);
      setError(err instanceof Error ? err.message : 'Failed to clear the entry');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        <PageHeader title="QBO Entries" />
        <main className="max-w-[95%] mx-auto px-6 py-8">
          <Card className="bg-card/30 border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Admin access required
              </CardTitle>
              <CardDescription>
                QBO Entries is limited to admin users.
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  const renderJeSection = (
    jeType: JeType,
    title: string,
    je: Je,
    checks: Check[],
    snapshot: SnapshotRow | null,
    drift: ReturnType<typeof detectDrift> | null,
    extra?: React.ReactNode,
  ) => {
    const blocked = hasBlocker(checks);
    const entered = Boolean(snapshot);
    const drifted = Boolean(drift?.drifted);

    return (
      <Card className="bg-card/30 border-white/10">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {entered && !drifted
                  ? `Entered in QBO${snapshot?.entered_by ? ` by ${snapshot.entered_by}` : ''} on ${snapshot?.entered_at.slice(0, 10)}.`
                  : `Dated ${je.date} · ${je.monthText}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Once an entry is marked, "Mark as entered" is a lie — the work is
                  done. The two things still meaningful are undoing it and
                  re-snapshotting the current numbers, so show exactly those. */}
              {entered ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unmark(jeType, title)}
                    disabled={isSaving}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Un-mark
                  </Button>
                  <Button
                    size="sm"
                    variant={drifted ? 'default' : 'outline'}
                    onClick={() => markEntered(je, title)}
                    disabled={blocked || isSaving || je.lines.length === 0}
                    title={
                      blocked
                        ? 'Resolve the blocking checks first'
                        : drifted
                          ? 'Re-snapshot the current numbers, clearing the drift'
                          : 'Re-snapshot the current numbers'
                    }
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Re-mark
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => markEntered(je, title)}
                  disabled={blocked || isSaving || je.lines.length === 0}
                  title={
                    blocked
                      ? 'Resolve the blocking checks first'
                      : je.lines.length === 0
                        ? 'Nothing to enter for this month'
                        : undefined
                  }
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  Mark as entered in QBO
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {drift && <DriftBanner drift={drift} jeLabel={title} enteredAt={snapshot?.entered_at} />}
          {extra}
          <ChecksPanel checks={checks} />
          <JeTable je={je} title={`${title} — ${je.monthText}`} />
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <PageHeader title="QBO Entries" />

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Month</Label>
            <Input
              type="month"
              value={selectedMonth}
              min={FIRST_MONTH}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-[160px] h-9"
            />
          </div>
          <Button variant="outline" onClick={loadAll} disabled={isLoading} className="h-9">
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <Alert className="bg-red-500/10 border-red-500/20 text-red-500">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert className="bg-green-500/10 border-green-500/20 text-green-500">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <Card className="bg-card/30 border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              Months
            </CardTitle>
            <CardDescription>
              From {monthText(FIRST_MONTH)} onward. Pick a month to work on it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {months.map((month) => {
                  const { status, marked, required } = statusFor(month);
                  const active = month === selectedMonth;
                  return (
                    <button
                      key={month}
                      type="button"
                      onClick={() => setSelectedMonth(month)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${STATUS_STYLES[status]} ${
                        active ? 'ring-2 ring-primary' : 'hover:brightness-125'
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground">{monthText(month)}</div>
                      <div className="text-xs">{monthStatusLabel(status, { marked, required })}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {isLoading || !current ? (
          <Card className="bg-card/30 border-white/10">
            <CardHeader>
              <CardDescription>
                {isLoading ? 'Loading...' : 'Pick a valid month.'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            {renderJeSection(
              'sales',
              'Sales JE — Denet machines',
              current.sales.je,
              current.salesCheckList,
              salesSnapshot,
              salesDrift,
              <p className="text-xs text-muted-foreground">
                {current.sales.includedTxCount} completed Denet transactions
                {current.sales.groups.length > 0 &&
                  ` · ${current.sales.groups.map((g) => g.coin || 'unknown').join(', ')}`}
              </p>,
            )}

            {renderJeSection(
              'coinbase',
              'Coinbase JE — crypto purchases',
              current.coinbase.je,
              current.coinbaseCheckList,
              coinbaseSnapshot,
              coinbaseDrift,
              <div className="space-y-4">
                <CoinbaseUpload selectedMonth={selectedMonth} onImported={loadAll} />
                {current.hasCoinbaseData ? (
                  <CoinbaseBuysTable
                    buys={current.coinbase.buys}
                    readOnly={isSaving}
                    onChangeTreatment={handleTreatmentChange}
                  />
                ) : (
                  <Alert className="bg-white/5 border-white/10">
                    <AlertDescription className="text-muted-foreground">
                      No Coinbase statement imported for {monthText(selectedMonth)} yet.
                    </AlertDescription>
                  </Alert>
                )}
              </div>,
            )}
          </>
        )}
      </main>
    </div>
  );
}
