import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Wallet Analytics — Transaction Flow Dashboard",
  description:
    "Analyze Solana wallet transactions: 1-hour, 24-hour, and 15-day flow analytics with counterparty tracking and recurrence patterns.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
