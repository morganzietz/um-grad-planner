import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.wolverineplan.com"),
  title: "WolverinePlan",
  description:
    "Pick a major, map out your semesters, and see what's left. The unofficial graduation planner for University of Michigan students.",
  openGraph: {
    title: "WolverinePlan",
    description:
      "Pick a major, map out your semesters, and see what's left. The unofficial graduation planner for University of Michigan students.",
    url: "https://www.wolverineplan.com",
    siteName: "WolverinePlan",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "WolverinePlan",
    description:
      "Pick a major, map out your semesters, and see what's left. The unofficial graduation planner for University of Michigan students.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
