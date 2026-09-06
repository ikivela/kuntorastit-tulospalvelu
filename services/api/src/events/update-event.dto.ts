import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { EventStatus } from "../generated/prisma/enums.js";

export class UpdateEventDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() seasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ format: "date-time" }) @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional({ format: "date-time" }) @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() registrationOpen?: boolean;
  @ApiPropertyOptional({ enum: EventStatus }) @IsOptional() @IsEnum(EventStatus) status?: EventStatus;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) paymentMethods?: string[];
}
