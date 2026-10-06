import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) currentPassword!: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12, { message: "Uuden salasanan pitää olla vähintään 12 merkkiä." }) @MaxLength(200) newPassword!: string;
}
