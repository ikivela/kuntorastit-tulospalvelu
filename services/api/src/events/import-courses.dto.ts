import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class ImportCoursesDto {
  @ApiProperty({ description: "IOF XML 3.0 CourseData document" })
  @IsString()
  @MinLength(1)
  @MaxLength(9_000_000)
  xml!: string;
}
