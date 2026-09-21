# QBO Entries harness

Exercises the pure modules in `src/lib/qbo/` against a **real** Coinbase Prime
monthly ZIP plus synthetic sales fixtures. No database and no browser: the
compute modules are pure, so this runs the same code the page does.

```bash
COINBASE_ZIP="~/Downloads/Coinbase Monthly Files.zip" npm run qbo:harness
```

`COINBASE_ZIP` defaults to `~/Downloads/Coinbase Monthly Files.zip`. The ZIP is
never committed — it holds account data — and nothing is written back to it.

What it covers:

1. Parsing the real ZIP (period from filenames, the trailing ` UTC` timestamps,
   leading TABs inside quoted fields, full-precision balances).
2. The **August 2026 oracle**: CR Exchange Account 65,814.95, DR Inventory -
   Bitcoin 65,650.84, DR Exchange Fees 164.11, plus both tie-outs at 0.
3. Per-buy treatment overrides moving one trade to the investment account.
4. Row-hash idempotency — re-parsing yields identical hashes, and the two rows
   of one trade (which share an `ID`) hash differently.
5. Loud failures: missing member, renamed column, unreadable filename period,
   mismatched periods between the two files.
6. Blocking checks: out-of-month rows, SELL rows, unknown asset, non-FILLED as
   WARN only.
7. Sales JE rules: Denet-only via profile windows, completed-only, month
   bucketing, per-coin inventory splits, the `fiat = fee + enviando` identity.
8. The freshness guard.
9. Drift detection after a late status change, and month-status mapping.

Exits non-zero if any check fails.
