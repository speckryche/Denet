import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';

export interface PlatformComparisonPDFPayload {
  fromDate: string;
  toDate: string;
  commissionRate: number;
  spreadRate: number;
  machineCount: number;
  denetTxCount: number;
  denetSalesTotal: number;
  actuals: {
    total_fees: number;
    bitstop_fees: number;
    rent: number;
    mgmt_rps: number;
    mgmt_rep: number;
    commissions: number;
    net_profit: number;
  };
  projectedCommission: number;
  projectedProfit: number;
  revenueDelta: number;
  profitDelta: number;
  feePctActual: number | null;
  feePctProjected: number | null;
  feePctDelta: number | null;
}

const COLORS = {
  text: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  rule: '#E5E7EB',
  panel: '#F9FAFB',
  primary: '#0066FF',
  primarySoft: '#EFF6FF',
  positive: '#16A34A',
  positiveSoft: '#ECFDF5',
  negative: '#DC2626',
  negativeSoft: '#FEF2F2',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 30,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.text,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  logo: { width: 75, height: 75, objectFit: 'contain' },
  headerMetaCol: { alignItems: 'flex-end' },
  periodLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  periodValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    color: COLORS.text,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: COLORS.rule, marginBottom: 14 },

  title: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
    marginBottom: 8,
  },
  intro: {
    fontSize: 9.5,
    lineHeight: 1.4,
    color: COLORS.text,
    marginBottom: 10,
  },

  scopeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  scopeCard: {
    flex: 1,
    backgroundColor: COLORS.panel,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  scopeLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  scopeValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
  },
  scopeValueSub: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 1,
  },

  headline: {
    borderRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'column',
  },
  headlineLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  headlineValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 26,
  },
  headlineCaption: {
    fontSize: 9,
    marginTop: 3,
  },

  tableHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    marginBottom: 6,
  },
  table: {
    borderTopWidth: 1,
    borderTopColor: COLORS.rule,
    marginBottom: 10,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.panel,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  tableRowFooter: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: COLORS.text,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  colLabel: { flex: 2.2, fontSize: 10 },
  colSublabel: { fontSize: 8.5, color: COLORS.muted, marginTop: 1 },
  colNum: { flex: 1.3, fontSize: 10, textAlign: 'right' },
  // Dedicated header-column style: same flex width as colNum, but centered
  // and bold. Defined as one style (not merged with colNum) so textAlign
  // is unambiguous regardless of array-merge order.
  colNumHeader: {
    flex: 1.3,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: COLORS.text,
    textAlign: 'right',
  },
  colLabelHeader: {
    flex: 2.2,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: COLORS.text,
    textAlign: 'left',
  },
  footerLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10.5 },
  footerNum: { fontFamily: 'Helvetica-Bold', fontSize: 11, textAlign: 'right' },

  methodology: {
    borderWidth: 1,
    borderColor: COLORS.rule,
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  methodologyTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.5,
    marginBottom: 2,
  },
  methodologyText: {
    fontSize: 9.5,
    color: COLORS.muted,
    lineHeight: 1.35,
  },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 40,
    right: 40,
    fontSize: 8,
    color: COLORS.faint,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

// ── Formatters ──────────────────────────────────────────────
const fmtCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const fmtSignedCurrency = (value: number) => {
  const abs = fmtCurrency(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
};

const fmtPct = (value: number | null) =>
  value === null || !isFinite(value) ? '—' : `${value.toFixed(2)}%`;

const fmtSignedPct = (value: number | null) => {
  if (value === null || !isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const fmtToday = () =>
  new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

// ── Component ───────────────────────────────────────────────
function deltaColor(value: number) {
  if (value > 0) return COLORS.positive;
  if (value < 0) return COLORS.negative;
  return COLORS.text;
}

export function PlatformComparisonPDF(props: PlatformComparisonPDFPayload) {
  const {
    fromDate,
    toDate,
    commissionRate,
    spreadRate,
    machineCount,
    denetTxCount,
    denetSalesTotal,
    actuals,
    projectedCommission,
    projectedProfit,
    revenueDelta,
    profitDelta,
    feePctActual,
    feePctProjected,
    feePctDelta,
  } = props;

  const blendedRate = (spreadRate * commissionRate) / 100;

  const headlinePositive = profitDelta >= 0;
  const headlineBg = headlinePositive ? COLORS.positiveSoft : COLORS.negativeSoft;
  const headlineFg = headlinePositive ? COLORS.positive : COLORS.negative;

  const profitDeltaPct =
    actuals.net_profit !== 0
      ? (profitDelta / Math.abs(actuals.net_profit)) * 100
      : 0;

  const rows: Array<{
    label: string;
    sublabel?: string;
    actual: number | null;
    projected: number | null;
    delta: number | null;
    isPercent?: boolean;
  }> = [
    { label: 'Total Sales', actual: denetSalesTotal, projected: denetSalesTotal, delta: 0 },
    { label: 'Revenue (total fees)', actual: actuals.total_fees, projected: projectedCommission, delta: revenueDelta },
    { label: 'Fee % of Sales', actual: feePctActual, projected: feePctProjected, delta: feePctDelta, isPercent: true },
    { label: 'Bitstop Fees', actual: actuals.bitstop_fees, projected: 0, delta: 0 },
    // Rent follows the machine regardless of platform — Denet still pays
    // it under the projected Bitstop affiliate model.
    { label: 'Rent', actual: actuals.rent, projected: actuals.rent, delta: 0 },
    { label: 'Mgmt RPS', actual: actuals.mgmt_rps, projected: actuals.mgmt_rps, delta: 0 },
    { label: 'Mgmt Rep', actual: actuals.mgmt_rep, projected: actuals.mgmt_rep, delta: 0 },
    { label: 'Commissions', actual: actuals.commissions, projected: 0, delta: 0 },
  ];

  return (
    <Document
      title="Platform Profitability Comparison"
      author="Dynamic Network Exchange, LLC"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Image src="/images/DNET Logo (black).png" style={styles.logo} />
          <View style={styles.headerMetaCol}>
            <Text style={styles.periodLabel}>Reporting period</Text>
            <Text style={styles.periodValue}>
              {fmtDate(fromDate)} – {fmtDate(toDate)}
            </Text>
          </View>
        </View>
        <View style={styles.divider} />

        {/* Title + Intro */}
        <Text style={styles.title}>Platform Profitability Comparison</Text>
        <Text style={styles.intro}>
          This report compares the actual profitability of Denet Platform
          machines against a calculated projection of what those same machines
          would have earned under Bitstop&apos;s affiliate model during the
          selected date range. The Actuals column reflects current operations,
          where Denet operates end-to-end and earns the full transaction fee.
          The Projected column applies Bitstop&apos;s contractual 56% commission
          rate to the actual transaction spread (Inserted − Sent) on each
          transaction, minus the costs that would still be Denet&apos;s
          responsibility (rents, management). The Delta column shows the
          financial impact of conversion.
        </Text>

        {/* Scope metadata */}
        <View style={styles.scopeRow}>
          <View style={styles.scopeCard}>
            <Text style={styles.scopeLabel}>Machines</Text>
            <Text style={styles.scopeValue}>{machineCount.toLocaleString('en-US')}</Text>
          </View>
          <View style={styles.scopeCard}>
            <Text style={styles.scopeLabel}>Transactions</Text>
            <Text style={styles.scopeValue}>{denetTxCount.toLocaleString('en-US')}</Text>
          </View>
          <View style={styles.scopeCard}>
            <Text style={styles.scopeLabel}>Rate applied</Text>
            <Text style={styles.scopeValue}>
              {spreadRate.toFixed(2)}% × {commissionRate.toFixed(2)}%
            </Text>
            <Text style={styles.scopeValueSub}>= {blendedRate.toFixed(2)}%</Text>
          </View>
        </View>

        {/* Headline callout */}
        <View style={[styles.headline, { backgroundColor: headlineBg }]}>
          <Text style={[styles.headlineLabel, { color: headlineFg }]}>
            Projected net impact of conversion
          </Text>
          <Text style={[styles.headlineValue, { color: headlineFg }]}>
            {fmtSignedCurrency(profitDelta)}
          </Text>
          <Text style={[styles.headlineCaption, { color: headlineFg }]}>
            over the selected period
          </Text>
        </View>

        {/* Comparison table */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colLabelHeader}>&nbsp;</Text>
            <Text style={styles.colNumHeader}>Actuals (Denet)</Text>
            <Text style={styles.colNumHeader}>Projected (Bitstop)</Text>
            <Text style={styles.colNumHeader}>Delta</Text>
          </View>

          {rows.map((row) => {
            const fmt = row.isPercent ? fmtPct : (v: number | null) =>
              v === null ? '—' : fmtCurrency(v);
            const dFmt = row.isPercent
              ? fmtSignedPct(row.delta)
              : row.delta === null
                ? '—'
                : fmtSignedCurrency(row.delta);
            const dColor = row.delta === null ? COLORS.faint : deltaColor(row.delta);
            return (
              <View style={styles.tableRow} key={row.label}>
                <View style={{ flex: 2.2 }}>
                  <Text style={{ fontSize: 10 }}>{row.label}</Text>
                  {row.sublabel && (
                    <Text style={styles.colSublabel}>{row.sublabel}</Text>
                  )}
                </View>
                <Text style={styles.colNum}>{fmt(row.actual)}</Text>
                <Text style={styles.colNum}>{fmt(row.projected)}</Text>
                <Text style={[styles.colNum, { color: dColor }]}>{dFmt}</Text>
              </View>
            );
          })}

          {/* Profit / Loss footer */}
          <View style={styles.tableRowFooter}>
            <Text style={[styles.colLabel, styles.footerLabel]}>Profit / Loss</Text>
            <Text style={[styles.colNum, styles.footerNum, { color: deltaColor(actuals.net_profit) }]}>
              {fmtCurrency(actuals.net_profit)}
            </Text>
            <Text style={[styles.colNum, styles.footerNum, { color: deltaColor(projectedProfit) }]}>
              {fmtCurrency(projectedProfit)}
            </Text>
            <View style={{ flex: 1.3 }}>
              <Text style={[styles.footerNum, { color: deltaColor(profitDelta) }]}>
                {fmtSignedCurrency(profitDelta)}
              </Text>
              <Text
                style={{
                  fontSize: 9,
                  color: deltaColor(profitDelta),
                  textAlign: 'right',
                  marginTop: 1,
                }}
              >
                {fmtSignedPct(profitDeltaPct)}
              </Text>
            </View>
          </View>
        </View>

        {/* Methodology */}
        <View style={styles.methodology}>
          <Text style={styles.methodologyTitle}>Methodology</Text>
          <Text style={styles.methodologyText}>
            Projection uses a flat benchmark approach: Bitstop&apos;s average
            spread of {spreadRate.toFixed(2)}% of sales (observed from Bitstop
            affiliate platform operations) multiplied by Bitstop&apos;s
            contractual {commissionRate.toFixed(0)}% commission rate to Denet.
            Real-world realized commissions may vary slightly month-to-month
            due to capped-rate situations on unusually high-spread months.
            Rents and management costs are assumed identical between the two
            models because those expenses follow the machine regardless of
            platform. Bitstop Fees do not apply under the affiliate model.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Generated {fmtToday()}</Text>
          <Text>Dynamic Network Exchange, LLC</Text>
        </View>
      </Page>
    </Document>
  );
}

// Public helper: render to blob and trigger browser download.
export async function exportPlatformComparisonPDF(
  payload: PlatformComparisonPDFPayload,
): Promise<void> {
  const blob = await pdf(<PlatformComparisonPDF {...payload} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Platform-Comparison_${payload.fromDate}_to_${payload.toDate}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
