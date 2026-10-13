import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateLiveloxDto {
  @ApiProperty({ description: "Liveloxin tapahtumatunniste (importableEventId), johon tulokset lähetetään." })
  @IsString() @IsNotEmpty() @MaxLength(200)
  liveloxEventId!: string;
  @ApiPropertyOptional({ description: "Liveloxin API-avain. Jätä pois säilyttääksesi aiemmin tallennetun avaimen." })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  apiKey?: string;
}
