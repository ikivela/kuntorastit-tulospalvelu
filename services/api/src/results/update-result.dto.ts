import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from "class-validator";

export const RESULT_STATUSES = ["ACCEPTED", "NO_TIME", "DISQUALIFIED", "DID_NOT_FINISH"] as const;
export const DISQUALIFICATION_REASONS = ["MISSING_CONTROL", "WRONG_CONTROL"] as const;

export class UpdateResultDto {
  @ApiPropertyOptional({ format: "uuid", description: "Rata, jolle tulos kirjataan" })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ enum: RESULT_STATUSES })
  @IsOptional()
  @IsIn(RESULT_STATUSES)
  status?: (typeof RESULT_STATUSES)[number];

  @ApiPropertyOptional({ enum: DISQUALIFICATION_REASONS, description: "Hylkäyksen syy (vain tilalle DISQUALIFIED)" })
  @IsOptional()
  @IsIn(DISQUALIFICATION_REASONS)
  disqualificationReason?: (typeof DISQUALIFICATION_REASONS)[number];

  @ApiPropertyOptional({ description: "Aika sekunteina, null = ei aikaa", nullable: true, example: 1598 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(24 * 60 * 60)
  durationSeconds?: number | null;
}
