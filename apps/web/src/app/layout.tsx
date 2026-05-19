import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/query-provider";
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
          {children}
          <Toaster position="top-right" richColors closeButton duration={5000} />
        </QueryProvider>
      </body>
    </html>
  );
}
