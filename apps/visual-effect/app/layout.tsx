/* eslint-disable react-refresh/only-export-components */
import "./globals.css"
import ClientAppContent from "./ClientAppContent"

export const metadata = {
  title: "Effect MCP IDE — Protocol Workbench",
  description:
    "Build, run, and inspect MCP applications through an Effect-native visual workbench.",
  openGraph: {
    title: "Effect MCP IDE — Protocol Workbench",
    description: "A visual authoring and execution environment for Effect-native MCP applications",
    siteName: "Effect MCP IDE",
    locale: "en_US",
    type: "website",
  },
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* `vsc-initialized` is injected by some VS Code extensions after SSR; suppress hydration mismatch warnings */}
      <body className="mcp-ide-body">
        <ClientAppContent />
        {children}
      </body>
    </html>
  )
}
