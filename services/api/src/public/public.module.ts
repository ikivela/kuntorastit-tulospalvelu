import { Module } from "@nestjs/common";
import { ReaderDevicesModule } from "../reader-devices/reader-devices.module.js";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";

@Module({ imports: [ReaderDevicesModule], controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
