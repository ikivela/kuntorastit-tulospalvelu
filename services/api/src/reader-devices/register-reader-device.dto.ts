import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Length } from "class-validator";

export class RegisterReaderDeviceDto {
  @ApiProperty({ format: "uuid", description: "Clientin pysyvä, itse generoima laitetunniste" })
  @IsUUID()
  installationId!: string;

  @ApiProperty({ example: "Maalin lukija #1" })
  @IsString()
  @Length(1, 120)
  name!: string;
}
