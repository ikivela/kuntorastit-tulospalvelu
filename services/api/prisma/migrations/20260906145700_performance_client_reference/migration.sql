ALTER TABLE "performance" ADD COLUMN "client_reference" TEXT;
CREATE UNIQUE INDEX "performance_client_reference_key" ON "performance"("client_reference");
