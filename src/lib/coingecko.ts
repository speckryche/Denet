// Live USD spot prices from CoinGecko's simple/price endpoint — the same call
// CryptoInvestments and AddSnapshotDialog make inline. New code should use this.

/** CoinGecko ids → USD price. Ids CoinGecko has no price for are left out. Throws on network/HTTP failure. */
export async function fetchSpotPrices(coinIds: string[]): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {};
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd`,
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const prices: Record<string, number> = {};
  for (const id of coinIds) {
    if (data?.[id]?.usd) prices[id] = data[id].usd;
  }
  return prices;
}
