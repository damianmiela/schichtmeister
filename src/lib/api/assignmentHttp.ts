import { NextResponse } from "next/server";
import type { AssignmentOpFailure } from "@/lib/api/assignmentMutations";

export class AssignmentOpRejected extends Error {
  constructor(public readonly failure: AssignmentOpFailure) {
    super("AssignmentOpRejected");
    this.name = "AssignmentOpRejected";
  }
}

export function assignmentFailureResponse(f: AssignmentOpFailure): NextResponse {
  if (f.kind === "http") {
    return NextResponse.json({ error: f.error }, { status: f.status });
  }
  return NextResponse.json(
    { errors: f.result.errors, warnings: f.result.warnings },
    { status: 422 },
  );
}
