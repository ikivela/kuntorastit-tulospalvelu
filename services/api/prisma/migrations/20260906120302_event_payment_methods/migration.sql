-- AlterTable
ALTER TABLE "event" ADD COLUMN     "payment_methods" TEXT[] DEFAULT ARRAY[]::TEXT[];
