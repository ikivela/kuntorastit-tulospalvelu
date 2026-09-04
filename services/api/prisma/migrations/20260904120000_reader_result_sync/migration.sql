ALTER TABLE "card_read" ADD COLUMN "client_reference" TEXT;
CREATE UNIQUE INDEX "card_read_client_reference_key" ON "card_read"("client_reference");
