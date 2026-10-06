import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional } from "class-validator";

export class ImportEventsDto {
  @ApiPropertyOptional({ default: false, description: "true = vain tarkistus, mitään ei tallenneta." })
  @IsOptional() @IsBoolean()
  dryRun?: boolean;

  // Rows are validated one by one in planEventImport so errors can be
  // reported per Excel row in Finnish instead of class-validator paths.
  @ApiProperty({
    type: "array",
    items: { type: "object" },
    description: "Excelin rivit: row, id, seasonYear, name, locationName, address, locationDescription, latitude, longitude, startsAt, endsAt, status, registrationOpen, paymentMethods.",
  })
  @IsArray() @ArrayMaxSize(2000) @IsObject({ each: true })
  rows!: Record<string, unknown>[];
}
