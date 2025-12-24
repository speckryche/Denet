-- Rename operator_fee_usd to bitstop_fee
ALTER TABLE transactions RENAME COLUMN operator_fee_usd TO bitstop_fee;

-- Rename created_at_transaction_local to date
ALTER TABLE transactions RENAME COLUMN created_at_transaction_local TO date;

-- Rename fiat to sale
ALTER TABLE transactions RENAME COLUMN fiat TO sale;
