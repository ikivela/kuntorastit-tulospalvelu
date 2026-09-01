import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./login.dto.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() input: LoginDto) { return this.auth.login(input); }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  me(@Req() request: { admin: unknown }) { return request.admin; }
}
