import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateEventDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() seasonId!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiProperty({ format: "date-time" }) @IsDateString() startsAt!: string;
  @ApiProperty({ format: "date-time" }) @IsDateString() endsAt!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() registrationOpen?: boolean;
}
