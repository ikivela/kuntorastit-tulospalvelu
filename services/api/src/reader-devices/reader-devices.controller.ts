import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { ReaderDevicesService } from "./reader-devices.service.js";

@ApiTags("reader-devices")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("reader-devices")
export class ReaderDevicesController {
  constructor(private readonly devices: ReaderDevicesService) {}

  @Get() list() { return this.devices.listForAdmin(); }
  @Post(":id/approve") approve(@Param("id") id: string) { return this.devices.approve(id); }
  @Post(":id/revoke") revoke(@Param("id") id: string) { return this.devices.revoke(id); }
}
