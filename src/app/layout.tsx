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
      {/* paddingBottom = footer height (40px, see FOOTER_HEIGHT_PX in Footer.tsx) so fixed footer doesn't cover
          the last row of page content. Tune in Footer.tsx if you change the
          footer height. */}
      <body style={{ margin: 0, paddingBottom: "40px" }}>
        <AppRouterCacheProvider>
          <AuthSessionProvider>
            <ThemeRegistry>
              {children}
              {/* Footer is position:fixed — always visible above the sidebar
                  (z-index 1250). Mounted last so its DOM order matches
                  visual order, but layout-wise it doesn't push children. */}
              <Footer />
            </ThemeRegistry>
          </AuthSessionProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
