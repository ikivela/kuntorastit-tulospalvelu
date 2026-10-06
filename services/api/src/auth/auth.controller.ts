import { Body, Controller, Get, Ip, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AuthService } from "./auth.service.js";
import { ChangePasswordDto } from "./change-password.dto.js";
import { LoginDto } from "./login.dto.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() input: LoginDto, @Ip() ip: string) { return this.auth.login(input, ip); }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  me(@Req() request: { admin: unknown }) { return request.admin; }

  @Post("change-password")
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  changePassword(@Req() request: { admin: { sub: string } }, @Body() input: ChangePasswordDto, @Ip() ip: string) {
    return this.auth.changePassword(request.admin.sub, input, ip);
  }
}
