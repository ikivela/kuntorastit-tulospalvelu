import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret auth for the maanantairastit-client's operational endpoints
 * (submitting results, listing registrations, searching people). The
 * public calendar/results/registration endpoints stay open for spectators
 * and runners and must never use this guard.
 */
@Injectable()
export class ReaderApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token || !this.matches(token)) throw new UnauthorizedException();
    return true;
  }

  private matches(token: string) {
    const expected = process.env.READER_API_KEY ?? "maanantairastit-reader-dev-key";
    const actualBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
