import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { RegisterReaderDeviceDto } from "./register-reader-device.dto.js";

const TOKEN_PREFIX = "mrc";

@Injectable()
export class ReaderDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterReaderDeviceDto) {
    const name = input.name.trim();
    const device = await this.prisma.readerDevice.upsert({
      where: { installationId: input.installationId },
      update: { name },
      create: { installationId: input.installationId, name },
    });
    return { status: device.status };
  }

  async status(installationId: string) {
    const device = await this.prisma.readerDevice.findUnique({ where: { installationId } });
    if (!device) throw new NotFoundException("Laitetta ei ole rekisteröity.");
    if (device.status !== "APPROVED") return { status: device.status };
    return { status: device.status, token: device.pendingToken ?? undefined };
  }

  async listForAdmin() {
    return this.prisma.readerDevice.findMany({
      orderBy: { requestedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        revokedAt: true,
        lastSeenAt: true,
      },
    });
  }

  async approve(id: string) {
    const token = `${TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(token);
    await this.prisma.readerDevice.update({
      where: { id },
      data: { status: "APPROVED", tokenHash, pendingToken: token, approvedAt: new Date(), revokedAt: null },
    });
    return { ok: true };
  }

  async revoke(id: string) {
    await this.prisma.readerDevice.update({
      where: { id },
      data: { status: "REVOKED", tokenHash: null, pendingToken: null, revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Verifies a bearer token, records usage, and clears the plaintext copy
   * now that the device has proven it received it. Returns null when the
   * token is unknown or the device has been revoked. */
  async authenticate(token: string) {
    const tokenHash = hashToken(token);
    const device = await this.prisma.readerDevice.findUnique({ where: { tokenHash } });
    if (!device || device.status !== "APPROVED") return null;
    await this.prisma.readerDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), pendingToken: null },
    });
    return device;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
