import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin" }) @IsString() username!: string;
  @ApiProperty({ example: "mara2026" }) @IsString() @MinLength(8) password!: string;
}
