-- The idempotency key for a booking. Nullable, because the seed and the
-- simulator book without one, and the unique index treats nulls as distinct so
-- those rows do not collide with each other.
--
-- Adding the column is not rewriting the table: a nullable text column with no
-- default is a catalogue change in Postgres, so this runs in constant time on an
-- existing book. The index build is the part that takes time, and CONCURRENTLY
-- is deliberately not used because it cannot run inside the migration's
-- transaction and this table is small enough not to need it.
-- Renamed from the generated 0002_magenta_korath.

ALTER TABLE "trades" ADD COLUMN "client_trade_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_client_trade_id_key" ON "trades" USING btree ("client_trade_id");
