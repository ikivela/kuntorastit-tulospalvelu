CREATE TYPE "RegistrationSource" AS ENUM ('WEB', 'EVENT');

ALTER TABLE "registration" ADD COLUMN "source" "RegistrationSource" NOT NULL DEFAULT 'WEB';
