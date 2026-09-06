import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersonsController } from "./persons.controller.js";
import { PersonsService } from "./persons.service.js";

@Module({ imports: [AuthModule], controllers: [PersonsController], providers: [PersonsService] })
export class PersonsModule {}
