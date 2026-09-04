import { Module } from "@nestjs/common";
import { ReaderApiKeyGuard } from "../auth/reader-api-key.guard.js";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";

@Module({ controllers: [PublicController], providers: [PublicService, ReaderApiKeyGuard] })
export class PublicModule {}
