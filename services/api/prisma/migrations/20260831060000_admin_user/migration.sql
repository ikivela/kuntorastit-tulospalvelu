CREATE TYPE "AdminRole" AS ENUM ('ADMIN');

CREATE TABLE "admin_user" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_user_username_key" ON "admin_user"("username");
