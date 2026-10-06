import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { ChangePasswordDto } from "./change-password.dto.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { LoginDto } from "./login.dto.js";

type AdminToken = { sub: string; username: string; role: "ADMIN"; exp: number };

export const DEVELOPMENT_TOKEN_SECRET = "kuntorastit-local-development-secret";

/** Fails start-up in production unless ADMIN_TOKEN_SECRET is set to a real
 * secret: with the public development default anyone could forge admin
 * tokens. */
export function assertTokenSecretConfigured() {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.ADMIN_TOKEN_SECRET ?? "";
  if (secret.length < 32 || secret === DEVELOPMENT_TOKEN_SECRET) {
    throw new Error("ADMIN_TOKEN_SECRET must be set to a random value of at least 32 characters in production (e.g. `openssl rand -hex 32`).");
  }
}

@Injectable()
export class AuthService {
  private readonly limiter = new LoginRateLimiter();

  constructor(private readonly prisma: PrismaService) {}

  async login(input: LoginDto, clientIp: string) {
    this.assertNotRateLimited(clientIp);
    const user = await this.prisma.adminUser.findUnique({ where: { username: input.username } });
    if (!user || !this.verifyPassword(input.password, user.passwordHash)) {
      this.limiter.recordFailure(clientIp);
      throw new UnauthorizedException("Virheellinen käyttäjätunnus tai salasana");
    }
    this.limiter.recordSuccess(clientIp);
    const payload: AdminToken = {
      sub: user.id,
      username: user.username,
      role: "ADMIN",
      exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
    };
    return { accessToken: this.sign(payload), user: { username: user.username, role: user.role } };
  }

  async changePassword(adminId: string, input: ChangePasswordDto, clientIp: string) {
    this.assertNotRateLimited(clientIp);
    const user = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!user) throw new UnauthorizedException();
    // 400, not 401: a wrong current password must not log the admin out.
    if (!this.verifyPassword(input.currentPassword, user.passwordHash)) {
      this.limiter.recordFailure(clientIp);
      throw new BadRequestException("Nykyinen salasana on väärä.");
    }
    if (input.newPassword === input.currentPassword) throw new BadRequestException("Uuden salasanan pitää erota nykyisestä.");
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: hashPassword(input.newPassword) } });
    return { changed: true };
  }

  verify(token: string): AdminToken {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) throw new UnauthorizedException();
    const expected = this.signature(encoded);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new UnauthorizedException();
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AdminToken;
    if (payload.role !== "ADMIN" || payload.exp <= Math.floor(Date.now() / 1000)) throw new UnauthorizedException();
    return payload;
  }

  private verifyPassword(password: string, stored: string) {
    const [algorithm, salt, expected] = stored.split(":");
    if (algorithm !== "scrypt" || !salt || !expected) return false;
    const actual = scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "hex");
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  }

  private assertNotRateLimited(clientIp: string) {
    const retryAfterMs = this.limiter.retryAfterMs(clientIp);
    if (retryAfterMs > 0) {
      const minutes = Math.ceil(retryAfterMs / 60_000);
      throw new HttpException(`Liian monta epäonnistunutta yritystä. Yritä uudelleen ${minutes} minuutin kuluttua.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private sign(payload: AdminToken) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${this.signature(encoded)}`;
  }

  private signature(encoded: string) {
    const secret = process.env.ADMIN_TOKEN_SECRET || DEVELOPMENT_TOKEN_SECRET;
    return createHmac("sha256", secret).update(encoded).digest("base64url");
  }
}

// Same format as prisma/seed.ts: scrypt:<salt>:<hash>.
function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
