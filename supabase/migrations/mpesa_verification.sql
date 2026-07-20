-- Run this in Supabase SQL editor before deploying the edge functions.
alter table orders
  add column if not exists payment_status text default 'unpaid', -- unpaid | pending | paid | failed
  add column if not exists lipana_transaction_id text,
  add column if not exists mpesa_receipt text; -- REAL Safaricom receipt, filled by the webhook only

create index if not exists idx_orders_lipana_txn on orders(lipana_transaction_id);
