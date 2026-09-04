import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class ReaderPunchDto {
  @ApiProperty({ example: 31 })
  @IsInt()
  @Min(0)
  @Max(255)
  controlCode!: number;

  @ApiProperty({ description: "Aika edelliseltä rastilta sekunteina", example: 95 })
  @IsInt()
  @Min(0)
  @Max(65535)
  timeSeconds!: number;
}

export class CreateReaderResultDto {
  @ApiProperty({ description: "Clientin pysyvä, idempotentti lukutunniste" })
  @IsString()
  @Length(1, 200)
  clientReference!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  courseId!: string;

  @ApiProperty({ enum: ["OK", "DISQUALIFIED", "MISSING_CONTROL", "NO_TIME"] })
  @IsIn(["OK", "DISQUALIFIED", "MISSING_CONTROL", "NO_TIME"])
  resultStatus!: "OK" | "DISQUALIFIED" | "MISSING_CONTROL" | "NO_TIME";

  @ApiProperty({ example: "123456" })
  @IsString()
  @Length(1, 20)
  cardNumber!: string;

  @ApiProperty({ example: "Maija" })
  @IsString()
  @Length(1, 80)
  firstName!: string;

  @ApiProperty({ example: "Meikäläinen" })
  @IsString()
  @Length(1, 80)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clubName?: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  readAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readerSerial?: string;

  @ApiProperty({ type: [ReaderPunchDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReaderPunchDto)
  punches!: ReaderPunchDto[];
}
