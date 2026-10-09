import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";

// Year ranges, date formats and uniqueness are checked in seasons-validation.ts
// and the service so the admin gets Finnish messages.
export class CreateEventSeriesDto {
  @ApiProperty({ example: "Kuntorastit" }) @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class UpdateEventSeriesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class RewardThresholdDto {
  @ApiPropertyOptional({ format: "uuid", description: "Olemassa olevan palkintorajan id (säilyttää palkinnon kuvauksen)." }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ example: "Tavoitepalkinto" }) @IsString() @MaxLength(200) name!: string;
  @ApiProperty({ example: 10 }) @IsInt() requiredAttendances!: number;
}

export class CreateSeasonDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() eventSeriesId!: string;
  @ApiProperty({ example: "Kausi 2027" }) @IsString() @MaxLength(200) name!: string;
  @ApiProperty({ example: 2027 }) @IsInt() year!: number;
  @ApiProperty({ format: "date", example: "2027-04-01" }) @IsString() startsAt!: string;
  @ApiProperty({ format: "date", example: "2027-10-31" }) @IsString() endsAt!: string;
  @ApiPropertyOptional({ type: [RewardThresholdDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RewardThresholdDto)
  rewards?: RewardThresholdDto[];
}

export class UpdateSeasonDto {
  @ApiPropertyOptional({ example: "Kausi 2027" }) @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ example: 2027 }) @IsOptional() @IsInt() year?: number;
  @ApiPropertyOptional({ format: "date", example: "2027-04-01" }) @IsOptional() @IsString() startsAt?: string;
  @ApiPropertyOptional({ format: "date", example: "2027-10-31" }) @IsOptional() @IsString() endsAt?: string;
  @ApiPropertyOptional({ type: [RewardThresholdDto], description: "Annettuna korvaa kauden kaikki palkintorajat." })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RewardThresholdDto)
  rewards?: RewardThresholdDto[];
}
