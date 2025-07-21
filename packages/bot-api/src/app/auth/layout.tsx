import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | Authentication | Nylas MCP Access",
    default: "Authentication | Nylas MCP Access"
  },
  description: "Secure authentication flow for connecting your Google Calendar to Nylas MCP servers.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
} 