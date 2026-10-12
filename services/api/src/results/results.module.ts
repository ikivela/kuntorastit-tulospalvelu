import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ResultsController } from "./results.controller.js";
import { ResultsService } from "./results.service.js";

@Module({ imports: [AuthModule], controllers: [ResultsController], providers: [ResultsService] })
export class ResultsModule {}
