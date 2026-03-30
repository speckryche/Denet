-- Rename liquidity categories
UPDATE liquidity_categories SET name = 'BTC - Coinbase' WHERE name = 'BTC / Crypto - Coinbase';
UPDATE liquidity_categories SET name = 'BTC - Investment' WHERE name = 'BTC - Ledger';
UPDATE liquidity_categories SET name = 'SOL - Investment' WHERE name = 'SOL - Ledger';
