-- CreateEnum
CREATE TYPE "ReaderDeviceStatus" AS ENUM ('PENDING', 'APPROVED', 'REVOKED');

-- CreateTable
CREATE TABLE "reader_device" (
    "id" UUID NOT NULL,
    "installation_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ReaderDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "token_hash" TEXT,
    "pending_token" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "reader_device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reader_device_installation_id_key" ON "reader_device"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "reader_device_token_hash_key" ON "reader_device"("token_hash");
