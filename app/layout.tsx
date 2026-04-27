import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlgoRank",
  description: "Super Smash Bros. Melee tournament data browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <h1><Link href="/">AlgoRank</Link></h1>
          <nav>
            <Link href="/">Tournaments</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
