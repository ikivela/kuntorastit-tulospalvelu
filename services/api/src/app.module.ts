import { Module } from "@nestjs/common";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health.controller.js";
import { PersonsModule } from "./persons/persons.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PublicModule } from "./public/public.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ReaderDevicesModule } from "./reader-devices/reader-devices.module.js";
import { SeasonsModule } from "./seasons/seasons.module.js";

@Module({ imports: [PrismaModule, AuthModule, EventsModule, PersonsModule, ReaderDevicesModule, SeasonsModule, PublicModule], controllers: [HealthController] })
export class AppModule {}
