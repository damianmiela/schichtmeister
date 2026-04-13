import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import ThemeRegistry from "@/components/ThemeRegistry";
import AuthSessionProvider from "@/components/AuthSessionProvider";

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
      <body>
        <AppRouterCacheProvider>
          <AuthSessionProvider>
            <ThemeRegistry>{children}</ThemeRegistry>
          </AuthSessionProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
