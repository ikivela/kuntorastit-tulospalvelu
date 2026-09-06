import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ReaderDevicesService } from "./reader-devices.service.js";

/** Guards the maanantairastit-client's operational endpoints (submitting
 * results, listing registrations, searching people). Requires a bearer
 * token issued to an admin-approved ReaderDevice. The public
 * calendar/results/registration endpoints stay open and must never use
 * this guard. */
@Injectable()
export class ReaderDeviceAuthGuard implements CanActivate {
  constructor(private readonly devices: ReaderDevicesService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    const device = await this.devices.authenticate(token);
    if (!device) throw new UnauthorizedException();
    return true;
  }
}
