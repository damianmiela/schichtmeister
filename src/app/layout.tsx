import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import ThemeRegistry from "@/components/ThemeRegistry";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "SchichtMeister DienstPlanner",
  description: "Care Facility Shift Planning Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body style={{ minHeight: "100vh", display: "flex", flexDirection: "column", margin: 0 }}>
        <AppRouterCacheProvider>
          <AuthSessionProvider>
            <ThemeRegistry>
              {/* Page content takes all the vertical space it needs… */}
              <div style={{ flex: "1 0 auto" }}>{children}</div>
              {/* …and the Footer is glued to the bottom of the viewport when
                  content is short, and pushed below the fold when content
                  is long. */}
              <Footer />
            </ThemeRegistry>
          </AuthSessionProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
