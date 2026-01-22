import { NextRequest, NextResponse } from "next/server";

// Site-wide password for development/staging access
const SITE_PASSWORD = process.env.SITE_PASSWORD || "REMOVED";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (password === SITE_PASSWORD) {
      const response = NextResponse.json({ success: true });

      // Set auth cookie (7 days expiry)
      response.cookies.set("schichtmeister-auth", "authenticated", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });

      return response;
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
