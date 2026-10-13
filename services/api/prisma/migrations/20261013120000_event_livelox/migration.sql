CREATE TABLE "event_livelox" (
    "event_id" UUID NOT NULL,
    "livelox_event_id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "last_uploaded_at" TIMESTAMP(3),
    "last_operation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_livelox_pkey" PRIMARY KEY ("event_id")
);

ALTER TABLE "event_livelox" ADD CONSTRAINT "event_livelox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
