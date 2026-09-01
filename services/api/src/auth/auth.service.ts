import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { LoginDto } from "./login.dto.js";

type AdminToken = { sub: string; username: string; role: "ADMIN"; exp: number };

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: LoginDto) {
    const user = await this.prisma.adminUser.findUnique({ where: { username: input.username } });
    if (!user || !this.verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException("Virheellinen käyttäjätunnus tai salasana");
    }
    const payload: AdminToken = {
      sub: user.id,
      username: user.username,
      role: "ADMIN",
      exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
    };
    return { accessToken: this.sign(payload), user: { username: user.username, role: user.role } };
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

  private sign(payload: AdminToken) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${this.signature(encoded)}`;
  }

  private signature(encoded: string) {
    const secret = process.env.ADMIN_TOKEN_SECRET ?? "maanantairastit-local-development-secret";
    return createHmac("sha256", secret).update(encoded).digest("base64url");
  }
}
