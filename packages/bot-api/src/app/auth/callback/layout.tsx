import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Complete",
  description: "Your Google Calendar has been successfully connected. Get your API credentials and configuration for Nylas MCP integration.",
};

export default function CallbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
} 