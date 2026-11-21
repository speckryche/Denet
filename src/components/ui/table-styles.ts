// Shared table visual language (Option B headers in light; dark chrome unchanged).
// Import these rather than restating header/footer/money classes on each page.

/** Option B <thead> (shadcn TableHeader or a raw thead). Light: no fill, 2px rule. Dark: slate strip. */
export const TABLE_THEAD =
  'bg-transparent text-[#4B5563] dark:bg-table-header-bg dark:text-table-header-fg [&_tr]:border-b-2 [&_tr]:border-foreground dark:[&_tr]:border-b dark:[&_tr]:border-table-header-bg [&_tr:hover]:bg-transparent [&_th]:text-[#4B5563] dark:[&_th]:text-table-header-fg';

/** Raw <tr> inside a thead when the parent does not use TABLE_THEAD's [&_tr] rules. */
export const TABLE_THEAD_TR =
  'border-b-2 border-foreground bg-transparent text-[#4B5563] dark:border-table-header-bg dark:bg-table-header-bg dark:text-table-header-fg';

/** Column label typography: 11px uppercase, muted in light, dim in dark. */
export const TABLE_TH =
  'h-10 px-2 py-1.5 text-left align-middle font-semibold text-[11px] uppercase tracking-[0.06em] leading-tight text-[#4B5563] dark:text-table-header-fg whitespace-normal [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] [&_[role=checkbox]]:border-current';

/** Totals footer: 2px top rule, no fill in light; muted strip in dark. */
export const TABLE_TFOOT =
  'border-t-2 border-foreground bg-transparent font-semibold dark:border-t dark:border-border dark:bg-muted/50 [&>tr]:last:border-b-0';

/** Comfortable body cell (~48px). Height is a CSS minimum on table cells. */
export const TABLE_TD =
  'px-2 py-2 h-12 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]';

/** Slightly tighter cell for wide month matrices (~36px). */
export const TABLE_TD_DENSE = 'px-1.5 py-1 h-9 align-middle';

/** Money / numeric cells. */
export const TABLE_MONEY = 'text-right font-mono tabular-nums';

/** In-table section divider (e.g. Liquidity "Cash assets"). */
export const TABLE_SECTION =
  'border-b-2 border-foreground bg-transparent py-2 px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground dark:border-b dark:border-border dark:bg-table-header-bg dark:text-table-header-fg';
