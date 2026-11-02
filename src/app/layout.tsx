import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropForge — Make a myth of the mundane",
  description: "Turn a real object into a one-of-a-kind fantasy artifact with Meta Muse Image.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
