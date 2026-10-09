import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SeasonsController, SeriesController } from "./seasons.controller.js";
import { SeasonsService } from "./seasons.service.js";

@Module({ imports: [AuthModule], controllers: [SeriesController, SeasonsController], providers: [SeasonsService] })
export class SeasonsModule {}
