import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module.js";
import { ReaderDevicesModule } from "../reader-devices/reader-devices.module.js";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";

@Module({ imports: [ReaderDevicesModule, EventsModule], controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
