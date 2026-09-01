import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateCourseDto {
  @ApiProperty({ example: "A-rata" }) @IsString() name!: string;
  @ApiProperty({ example: 5300 }) @IsInt() @Min(1) lengthMeters!: number;
  @ApiPropertyOptional({ example: 85 }) @IsOptional() @IsInt() @Min(0) climbMeters?: number;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateCourseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) lengthMeters?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) climbMeters?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
