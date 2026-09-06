import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ReaderDeviceAuthGuard } from "./reader-device-auth.guard.js";
import { ReaderDevicesController } from "./reader-devices.controller.js";
import { ReaderDevicesService } from "./reader-devices.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ReaderDevicesController],
  providers: [ReaderDevicesService, ReaderDeviceAuthGuard],
  exports: [ReaderDevicesService, ReaderDeviceAuthGuard],
})
export class ReaderDevicesModule {}
