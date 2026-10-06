-- The fill lifecycle. Status stops being ACTIVE or CANCELLED and becomes the
-- four FIX OrdStatus values this blotter can produce, with the three live ones
-- derived from a new cumulative filled quantity.
--
-- Hand-written over the generated version, which could not run on a book that
-- already holds trades: it recreated the enum and cast straight across, and no
-- existing row's 'ACTIVE' is a value of the new type. The steps below add the
-- column, backfill it, map the old status, and only then assert the constraint
-- that ties the two together.
--
-- Every trade booked before this migration was recorded as an execution rather
-- than as a working order, so each one is fully filled: ACTIVE becomes FILLED
-- and filled_quantity becomes quantity. A cancelled trade keeps the same
-- backfill, which is the record of what was struck.

ALTER TYPE "public"."trade_event_type" ADD VALUE 'FILLED' BEFORE 'CANCELLED';--> statement-breakpoint

ALTER TABLE "trades" ADD COLUMN "filled_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "trades" SET "filled_quantity" = "quantity";--> statement-breakpoint

-- Through text, because an enum cannot have a value removed and ACTIVE has to
-- be rewritten before the new type will accept the column.
ALTER TABLE "trades" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "trades" SET "status" = 'FILLED' WHERE "status" = 'ACTIVE';--> statement-breakpoint
DROP TYPE "public"."trade_status";--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "status" SET DATA TYPE "public"."trade_status" USING "status"::"public"."trade_status";--> statement-breakpoint
-- A booking is an order, so it opens with nothing filled.
ALTER TABLE "trades" ALTER COLUMN "status" SET DEFAULT 'NEW'::"public"."trade_status";--> statement-breakpoint

-- The audit trail holds whole trades as jsonb, so the same rewrite has to reach
-- the snapshots or every history already written stops parsing against the
-- contract. An append-only log is not edited lightly; this is the stored shape
-- of a trade changing, not a trade's history changing.
UPDATE "trade_events" SET
  "after" = jsonb_set(
    jsonb_set("after", '{status}', to_jsonb(
      case when "after"->>'status' = 'ACTIVE' then 'FILLED' else "after"->>'status' end
    )),
    '{filledQuantity}', to_jsonb(("after"->>'quantity')::int)
  ),
  "before" = case when "before" is null then null else
    jsonb_set(
      jsonb_set("before", '{status}', to_jsonb(
        case when "before"->>'status' = 'ACTIVE' then 'FILLED' else "before"->>'status' end
      )),
      '{filledQuantity}', to_jsonb(("before"->>'quantity')::int)
    )
  end;--> statement-breakpoint

-- Asserted last, once the backfill above has made every row satisfy it.
ALTER TABLE "trades" ADD CONSTRAINT "trades_status_matches_fill" CHECK (
        filled_quantity between 0 and quantity
        and case status
          when 'NEW' then filled_quantity = 0
          when 'PARTIALLY_FILLED' then filled_quantity > 0 and filled_quantity < quantity
          when 'FILLED' then filled_quantity = quantity
          else true
        end
      );
