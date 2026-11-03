import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, Matches } from "class-validator";

export class UpdateSkippedControlsDto {
  @ApiProperty({ type: [String], example: ["45"], description: "Rastikoodit, joita ei vaadita kortilta (esim. sammunut leimasin). Tyhjä lista palauttaa kaikki rastit tarkastukseen." })
  @IsArray() @ArrayMaxSize(200) @Matches(/^\d+$/, { each: true })
  controlCodes!: string[];
}
