import { NextResponse } from "next/server";
import type { SwapApproveFailure } from "@/lib/api/swapMutations";

export function swapApproveFailureResponse(f: SwapApproveFailure): NextResponse {
  if (f.kind === "http") {
    return NextResponse.json({ error: f.error }, { status: f.status });
  }
  return NextResponse.json(
    { errors: f.errors, warnings: f.warnings },
    { status: 422 },
  );
}
