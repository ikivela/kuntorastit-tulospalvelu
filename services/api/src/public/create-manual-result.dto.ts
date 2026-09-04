import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";

export class CreateManualResultDto {
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
}
