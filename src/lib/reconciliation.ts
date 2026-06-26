// Platform-attribution reconciliation: a read-only safety net run after
// conversions. For each transaction we find the atm_profile whose date window
// contains the tx (via the SAME findProfileForTx used everywhere else — not a
// reinvented matcher) and flag any tx whose own `platform` column disagrees
// with that profile's platform. Transactions matching no window are flagged as
// orphans, sub-classified so the benign "history predates install date" case
// is distinguishable from a conversion-created gap.

import { findProfileForTx } from './atm-profile';

export interface ReconTransaction {
  id: string;
  atm_id: string | null;
  date: string | null;
  platform: string | null;
  sale: number | string | null;
}

export interface ReconProfile {
  id: string;
  atm_id: string | null;
  installed_date: string | null;
  removed_date: string | null;
  platform: string | null;
  location_name: string | null;
}

export type OrphanReason =
  | 'before_first_install' // tx predates the earliest profile install — benign legacy data
  | 'gap_or_after_window' // tx falls in a gap / after the last window — the conversion-risk case
  | 'no_profile_for_atm' // atm_id has no profile rows at all
  | 'profiles_have_null_install'; // atm has only placeholder profiles (no window)

export interface ReconFlag {
  id: string;
  atm_id: string;
  location: string | null;
  date: string; // YYYY-MM-DD
  txPlatform: string;
  profilePlatform: string | null; // null when orphan
  amount: number;
  kind: 'mismatch' | 'orphan';
  orphanReason?: OrphanReason;
}

export interface ReconResult {
  totalScanned: number; // tx with usable atm_id + date
  skipped: number; // tx missing atm_id or date
  flags: ReconFlag[];
  counts: {
    mismatch: number;
    orphan_gap_or_after: number; // actionable
    orphan_no_profile: number; // actionable (no_profile_for_atm + profiles_have_null_install)
    orphan_before_install: number; // benign legacy
  };
}

const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const norm = (p: string | null | undefined): string => (p || '').trim().toLowerCase();

export function reconcile(
  transactions: ReconTransaction[],
  profiles: ReconProfile[],
): ReconResult {
  // Group profiles by atm_id for orphan-reason classification + location lookup.
  const byAtm = new Map<string, ReconProfile[]>();
  for (const p of profiles) {
    if (!p.atm_id) continue;
    const arr = byAtm.get(p.atm_id);
    if (arr) arr.push(p);
    else byAtm.set(p.atm_id, [p]);
  }

  const locationFor = (atmId: string): string | null => {
    const ps = byAtm.get(atmId);
    if (!ps || ps.length === 0) return null;
    const dated = ps
      .filter((p) => p.installed_date)
      .sort((a, b) => (a.installed_date! < b.installed_date! ? -1 : 1));
    return (dated[0] || ps[0]).location_name ?? null;
  };

  const flags: ReconFlag[] = [];
  const counts = {
    mismatch: 0,
    orphan_gap_or_after: 0,
    orphan_no_profile: 0,
    orphan_before_install: 0,
  };
  let scanned = 0;
  let skipped = 0;

  for (const t of transactions) {
    if (!t.atm_id || !t.date) {
      skipped++;
      continue;
    }
    const dateOnly = String(t.date).split('T')[0];
    const [y, m, d] = dateOnly.split('-').map(Number);
    if (!y || !m || !d) {
      skipped++;
      continue;
    }
    scanned++;

    const txDate = new Date(y, m - 1, d);
    const txPlatform = norm(t.platform);
    const amount = Number(t.sale ?? 0) || 0;

    // Reuse the canonical matcher — same logic the reports/CTR rely on.
    const profile = findProfileForTx(profiles, t.atm_id, txDate);

    if (profile) {
      const profPlatform = norm(profile.platform);
      if (txPlatform !== profPlatform) {
        counts.mismatch++;
        flags.push({
          id: t.id,
          atm_id: t.atm_id,
          location: profile.location_name ?? locationFor(t.atm_id),
          date: dateOnly,
          txPlatform,
          profilePlatform: profPlatform,
          amount,
          kind: 'mismatch',
        });
      }
      continue;
    }

    // No window matched — classify the orphan.
    const ps = byAtm.get(t.atm_id) || [];
    const dated = ps.filter((p) => p.installed_date);
    let reason: OrphanReason;
    if (ps.length === 0) {
      reason = 'no_profile_for_atm';
      counts.orphan_no_profile++;
    } else if (dated.length === 0) {
      reason = 'profiles_have_null_install';
      counts.orphan_no_profile++;
    } else {
      const minInstall = dated.reduce(
        (min, p) => (p.installed_date! < min ? p.installed_date! : min),
        dated[0].installed_date!,
      );
      if (parseLocalDate(dateOnly) < parseLocalDate(minInstall)) {
        reason = 'before_first_install';
        counts.orphan_before_install++;
      } else {
        reason = 'gap_or_after_window';
        counts.orphan_gap_or_after++;
      }
    }

    flags.push({
      id: t.id,
      atm_id: t.atm_id,
      location: locationFor(t.atm_id),
      date: dateOnly,
      txPlatform,
      profilePlatform: null,
      amount,
      kind: 'orphan',
      orphanReason: reason,
    });
  }

  return { totalScanned: scanned, skipped, flags, counts };
}
