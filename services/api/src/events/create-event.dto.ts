import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { EventStatus } from "../generated/prisma/enums.js";

export class CreateEventDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() seasonId!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiProperty({ format: "date-time" }) @IsDateString() startsAt!: string;
  @ApiProperty({ format: "date-time" }) @IsDateString() endsAt!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() registrationOpen?: boolean;
  @ApiPropertyOptional({ enum: EventStatus, default: EventStatus.DRAFT }) @IsOptional() @IsEnum(EventStatus) status?: EventStatus;
  @ApiPropertyOptional({ type: [String], description: "Tapahtumakohtaiset maksutavat, joista ilmoittautuja valitsee yhden." })
  @IsOptional() @IsArray() @IsString({ each: true })
  paymentMethods?: string[];
}
