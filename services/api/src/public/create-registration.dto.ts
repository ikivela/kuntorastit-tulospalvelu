import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from "class-validator";
import { PunchingSystem } from "../generated/prisma/enums.js";

export class CreateRegistrationDto {
  @ApiProperty({ example: "Maija" })
  @IsString()
  @Length(1, 80)
  firstName!: string;

  @ApiProperty({ example: "Meikäläinen" })
  @IsString()
  @Length(1, 80)
  lastName!: string;

  @ApiPropertyOptional({ example: "Esimerkkiseura" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clubName?: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ enum: PunchingSystem })
  @IsOptional()
  @IsEnum(PunchingSystem)
  punchingSystem?: PunchingSystem;

  @ApiPropertyOptional({ example: "123456" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,20}$/, { message: "cardNumber must contain only digits" })
  cardNumber?: string;

  @ApiProperty({ description: "Yksi tapahtuman sallituista maksutavoista (ks. GET /public/calendar)." })
  @IsString()
  @Length(1, 200)
  paymentMethod!: string;

  @ApiPropertyOptional({ description: "Lisätiedot, esim. ilmaiseen karttaan oikeuttava syntymävuosi" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
