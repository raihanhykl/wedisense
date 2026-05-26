import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/query-provider";
import TourProvider from "@/components/tour/tour-provider";
import NavigationProgress from "@/components/shared/navigation-progress";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Wedisense — Asset Management System",
  description: "Comprehensive asset management system for Wedison",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* QueryProvider sits at the very top so every page benefits from
            shared caching. Toaster lives inside the provider tree so toasts
            triggered by mutation success handlers find their <Toaster /> mount. */}
        <QueryProvider>
          {/* Suspense boundary required because NavigationProgress reads
              useSearchParams, which Next.js asks consumers to wrap. */}
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          <TourProvider>
            {children}
          </TourProvider>
          <Toaster position="top-right" richColors closeButton duration={5000} />
        </QueryProvider>
      </body>
    </html>
  );
}
