ALTER TABLE "event" ADD COLUMN "skipped_control_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
