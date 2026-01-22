import { NextRequest, NextResponse } from "next/server";

// Site-wide password for development/staging access
const SITE_PASSWORD = process.env.SITE_PASSWORD || "REMOVED";

export async function POST(request: NextRequest) {
  try {
    // Try to parse as form data first, then JSON
    const contentType = request.headers.get("content-type") || "";
    let password: string | null = null;

    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      password = formData.get("password") as string;
    } else {
      const body = await request.json();
      password = body.password;
    }

    if (password === SITE_PASSWORD) {
      const response = NextResponse.json({ success: true });

      // Set auth cookie (7 days expiry)
      // Note: secure:false for HTTP access, enable when using HTTPS
      response.cookies.set("schichtmeister-auth", "authenticated", {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });

      return response;
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Invalid request", details: String(error) },
      { status: 400 }
    );
  }
}
