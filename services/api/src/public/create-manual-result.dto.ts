import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";

export class CreateManualResultDto {
  @ApiProperty({ description: "Clientin pysyvä, idempotentti lukutunniste" })
  @IsString()
  @Length(1, 200)
  clientReference!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ format: "uuid", description: "Olemassa olevan henkilön id, jos valittu hausta" })
  @IsOptional()
  @IsUUID()
  personId?: string;

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

  @ApiPropertyOptional({ description: "Käsin syötetty aika sekunteina. Jätä pois merkitäksesi tuloksen ilman aikaa.", example: 2322 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 60 * 60)
  durationSeconds?: number;
}
