import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SOTO AI",
  description: "Sign in to your SOTO AI workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
