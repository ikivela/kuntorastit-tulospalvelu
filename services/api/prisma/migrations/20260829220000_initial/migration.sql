-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'OPEN', 'FINISHED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PunchingSystem" AS ENUM ('EMIT', 'SPORT_IDENT');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PerformanceSource" AS ENUM ('ONSITE', 'SELF_SERVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PerformanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISQUALIFIED', 'NO_TIME', 'DID_NOT_FINISH');

-- CreateEnum
CREATE TYPE "CardReadStatus" AS ENUM ('NEW', 'PROCESSED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PunchStatus" AS ENUM ('VALID', 'EXTRA', 'MISSING');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('START', 'NORMAL', 'FINISH');

-- CreateTable
CREATE TABLE "event_series" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season" (
    "id" UUID NOT NULL,
    "event_series_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "starts_at" DATE NOT NULL,
    "ends_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location_name" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "registration_open" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "length_meters" INTEGER NOT NULL,
    "climb_meters" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ControlType" NOT NULL DEFAULT 'NORMAL',

    CONSTRAINT "control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_control" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "sequence_number" INTEGER NOT NULL,

    CONSTRAINT "course_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_alias" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "club_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "club_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch_card" (
    "id" UUID NOT NULL,
    "system" "PunchingSystem" NOT NULL,
    "card_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "punch_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_punch_card" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "punch_card_id" UUID NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),

    CONSTRAINT "person_punch_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "course_id" UUID,
    "punch_card_id" UUID,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "punch_card_id" UUID,
    "source" "PerformanceSource" NOT NULL DEFAULT 'ONSITE',
    "status" "PerformanceStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_ms" BIGINT,
    "read_at" TIMESTAMP(3),
    "disqualification_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_read" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "punch_card_id" UUID NOT NULL,
    "reader_type" TEXT NOT NULL,
    "reader_serial" TEXT,
    "read_at" TIMESTAMP(3) NOT NULL,
    "raw_data" JSONB NOT NULL,
    "processing_status" "CardReadStatus" NOT NULL DEFAULT 'NEW',
    "performance_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_read_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch" (
    "id" UUID NOT NULL,
    "performance_id" UUID NOT NULL,
    "control_code" TEXT NOT NULL,
    "punched_at" TIMESTAMP(3),
    "elapsed_ms" BIGINT,
    "sequence_number" INTEGER NOT NULL,
    "status" "PunchStatus" NOT NULL DEFAULT 'VALID',

    CONSTRAINT "punch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_threshold" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "required_attendances" INTEGER NOT NULL,
    "reward_description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reward_threshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_event_series_id_year_key" ON "season"("event_series_id", "year");

-- CreateIndex
CREATE INDEX "event_season_id_starts_at_idx" ON "event"("season_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_event_id_name_key" ON "course"("event_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "control_event_id_code_key" ON "control"("event_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "course_control_course_id_sequence_number_key" ON "course_control"("course_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "club_name_key" ON "club"("name");

-- CreateIndex
CREATE UNIQUE INDEX "club_alias_alias_key" ON "club_alias"("alias");

-- CreateIndex
CREATE INDEX "person_last_name_first_name_idx" ON "person"("last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "punch_card_system_card_number_key" ON "punch_card"("system", "card_number");

-- CreateIndex
CREATE INDEX "person_punch_card_punch_card_id_valid_until_idx" ON "person_punch_card"("punch_card_id", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "registration_event_id_person_id_key" ON "registration"("event_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_event_id_person_id_key" ON "attendance"("event_id", "person_id");

-- CreateIndex
CREATE INDEX "performance_attendance_id_idx" ON "performance"("attendance_id");

-- CreateIndex
CREATE INDEX "card_read_event_id_read_at_idx" ON "card_read"("event_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "punch_performance_id_sequence_number_key" ON "punch"("performance_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "reward_threshold_season_id_required_attendances_key" ON "reward_threshold"("season_id", "required_attendances");

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_event_series_id_fkey" FOREIGN KEY ("event_series_id") REFERENCES "event_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control" ADD CONSTRAINT "control_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_control" ADD CONSTRAINT "course_control_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_control" ADD CONSTRAINT "course_control_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_alias" ADD CONSTRAINT "club_alias_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_punch_card" ADD CONSTRAINT "person_punch_card_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_punch_card" ADD CONSTRAINT "person_punch_card_punch_card_id_fkey" FOREIGN KEY ("punch_card_id") REFERENCES "punch_card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_punch_card_id_fkey" FOREIGN KEY ("punch_card_id") REFERENCES "punch_card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance" ADD CONSTRAINT "performance_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance" ADD CONSTRAINT "performance_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance" ADD CONSTRAINT "performance_punch_card_id_fkey" FOREIGN KEY ("punch_card_id") REFERENCES "punch_card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_read" ADD CONSTRAINT "card_read_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_read" ADD CONSTRAINT "card_read_punch_card_id_fkey" FOREIGN KEY ("punch_card_id") REFERENCES "punch_card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_read" ADD CONSTRAINT "card_read_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "performance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch" ADD CONSTRAINT "punch_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "performance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_threshold" ADD CONSTRAINT "reward_threshold_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;


