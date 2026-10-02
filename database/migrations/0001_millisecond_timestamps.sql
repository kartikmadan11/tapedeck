-- Timestamps are narrowed to millisecond precision to match the wire
-- contract, which is UTC ISO-8601 at millisecond precision. Storing
-- microseconds meant the database could order two trades by a difference the
-- client could not see, so a refetch could reorder rows the stream had placed.
-- Renamed from the generated 0001_narrow_hercules.

ALTER TABLE "trade_events" ALTER COLUMN "at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "trade_events" ALTER COLUMN "at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "trade_timestamp" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "updated_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "updated_at" SET DEFAULT now();
