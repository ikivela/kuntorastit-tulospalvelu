import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service.js";
import { ReaderDevicesService } from "./reader-devices.service.js";

/** Guards the pc-client's operational endpoints (submitting
 * results, listing registrations, searching people). Requires a bearer
 * token issued to an admin-approved ReaderDevice, or an admin session token
 * (the admin UI's browser-based Web Serial reader). The public
 * calendar/results/registration endpoints stay open and must never use
 * this guard. */
@Injectable()
export class ReaderDeviceAuthGuard implements CanActivate {
  constructor(private readonly devices: ReaderDevicesService, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    if (this.isAdminToken(token)) return true;
    const device = await this.devices.authenticate(token);
    if (!device) throw new UnauthorizedException();
    return true;
  }

  private isAdminToken(token: string) {
    try { this.auth.verify(token); return true; } catch { return false; }
  }
}
