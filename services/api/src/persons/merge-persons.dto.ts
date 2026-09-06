import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsUUID } from "class-validator";

export class MergePersonsDto {
  @ApiProperty({ format: "uuid", description: "Henkilö, joka säilyy ja johon muut yhdistetään." })
  @IsUUID()
  keepPersonId!: string;

  @ApiProperty({ type: [String], description: "Yhdistettävät (ja poistettavat) henkilö-id:t." })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  mergePersonIds!: string[];
}
