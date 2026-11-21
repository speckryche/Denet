## UI standards

- Light-mode tables: no header fill, uppercase 11px #4B5563 semibold labels, 2px bottom line. Use the shared table components in src/components/ui/table.tsx and table-group.tsx, never custom black headers.
- Rows 48px (36px for dense tables like Sales by ATM, ATM P&L, Fleet, Liquidity).
- Money right-aligned in JetBrains Mono with $. Dates MM/DD/YYYY. Totals rows get a 2px top line. Empty tables use TableEmpty. Action icons stay on one line.
- Numbers use normal text color with only subtle red/green. Light mode needs strong text and field contrast.
- Tables must fit a 1280px laptop screen with no sideways scrolling.
- Investments Holdings shows coin logos using CoinIdentity (logos in src/assets/crypto/).
