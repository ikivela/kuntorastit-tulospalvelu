import { Module } from "@nestjs/common";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({ imports: [PrismaModule, EventsModule], controllers: [HealthController] })
export class AppModule {}
