// Shared helpers for the multi-row atm_profiles model. Each atm_id can have
// multiple profile rows; the correct row for any (atm_id, date) is the one
// whose [installed_date, removed_date] window contains the date.
//
// The DB invariants (migration 20240522000034) guarantee:
//   - At most one active=true row per atm_id.
//   - Non-overlapping windows for the same atm_id (when installed_date is set).
// Helpers in this module assume those invariants hold.

const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export type ProfileLike = {
  id: string;
  atm_id: string | null;
  installed_date: string | null;
  removed_date: string | null;
};

export type TransactionLike = {
  atm_id: string | null;
  date: string | null;
};

// Find the profile whose date window contains txDate for the given atm_id.
// Returns null when no window matches — caller decides how to handle (skip,
// log, error). No heuristic fallback by design: a non-match indicates either
// a data gap or a tx outside any profile's tenure, and silently picking
// "some profile" would corrupt downstream attribution.
export function findProfileForTx<P extends ProfileLike>(
  profiles: P[],
  atmId: string,
  txDate: Date,
): P | null {
  const candidates = profiles.filter((p) => p.atm_id === atmId);
  if (candidates.length === 0) return null;

  for (const p of candidates) {
    if (!p.installed_date) continue;
    const installed = parseLocalDate(p.installed_date);
    if (txDate < installed) continue;
    if (p.removed_date) {
      const removed = parseLocalDate(p.removed_date);
      if (txDate > removed) continue;
    }
    return p;
  }
  return null;
}

// Group transactions by the profile they belong to via the date-window match.
// Transactions that don't match any profile window are silently dropped from
// the result; callers can detect this by counting txs in vs. txs out.
export function txsByProfile<P extends ProfileLike, T extends TransactionLike>(
  txs: T[],
  profiles: P[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const tx of txs) {
    if (!tx.atm_id || !tx.date) continue;
    const dateOnly = tx.date.split('T')[0];
    const [y, m, d] = dateOnly.split('-').map(Number);
    if (!y || !m || !d) continue;
    const txDate = new Date(y, m - 1, d);
    const profile = findProfileForTx(profiles, tx.atm_id, txDate);
    if (!profile) continue;
    const arr = out.get(profile.id);
    if (arr) arr.push(tx);
    else out.set(profile.id, [tx]);
  }
  return out;
}

// Profiles whose [installed_date, removed_date] window overlaps the given
// report range. Simplified predicate: just window overlap, no active-flag
// dance and no sibling-aware logic — both made unnecessary by the DB
// invariants in migration 20240522000034.
//
// Profiles with NULL installed_date (placeholders for future installs) are
// excluded since they have no defined window.
export function profilesForWindow<P extends ProfileLike>(
  profiles: P[],
  fromDate: Date,
  toDate: Date,
): P[] {
  return profiles.filter((p) => {
    if (!p.installed_date) return false;
    const installed = parseLocalDate(p.installed_date);
    if (installed > toDate) return false;
    if (p.removed_date) {
      const removed = parseLocalDate(p.removed_date);
      if (removed < fromDate) return false;
    }
    return true;
  });
}

// Count the number of "expense months" for a profile within a report range.
// A profile contributes its first full month starting the month AFTER its
// installed_date, and its last full month is the month of its removed_date.
// The report range is clamped to whole months on both ends.
export function calculateExpenseMonths<P extends ProfileLike>(
  profile: P,
  reportStartDate: Date,
  reportEndDate: Date,
): number {
  if (!profile.installed_date) return 0;
  const installDate = parseLocalDate(profile.installed_date);
  const removalDate = profile.removed_date ? parseLocalDate(profile.removed_date) : null;

  const monthAfterInstall = new Date(
    installDate.getFullYear(),
    installDate.getMonth() + 1,
    1,
  );
  const reportStartMonth = new Date(
    reportStartDate.getFullYear(),
    reportStartDate.getMonth(),
    1,
  );
  const effectiveStart =
    monthAfterInstall > reportStartMonth ? monthAfterInstall : reportStartMonth;

  const reportEndMonth = new Date(
    reportEndDate.getFullYear(),
    reportEndDate.getMonth(),
    1,
  );
  let effectiveEnd = reportEndMonth;
  if (removalDate) {
    const removalMonth = new Date(
      removalDate.getFullYear(),
      removalDate.getMonth(),
      1,
    );
    if (removalMonth < effectiveEnd) effectiveEnd = removalMonth;
  }

  if (effectiveStart > effectiveEnd) return 0;
  const monthCount =
    (effectiveEnd.getFullYear() - effectiveStart.getFullYear()) * 12 +
    (effectiveEnd.getMonth() - effectiveStart.getMonth()) +
    1;
  return Math.max(0, monthCount);
}
