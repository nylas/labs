import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from '@/lib/theme';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s | Nylas MCP Access",
    default: "Connect Your Calendar | Nylas MCP Access"
  },
  description: "Connect your Google Calendar to get API credentials for Nylas MCP servers. Secure OAuth 2.0 authentication for Claude Desktop and Cursor integration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <ThemeProvider>
          <main role="main">
            {children}
          </main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
