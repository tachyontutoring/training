import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

// Display + body are Helvetica Neue (system stack, set in globals.css).
// Technical labels are monospaced.
const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "School of Athens — SAT Practice",
  description:
    "Adaptive SAT practice from School of Athens. Take full tests or drill reading and math.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={mono.variable}>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
