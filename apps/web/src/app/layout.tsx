import { PwaRegister } from "@/components/pwa/PwaRegister";
import { fetchPublishedAppearance } from "@/lib/appearance/data";
import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const mobokoDisplay = Cormorant_Garamond({
  variable: "--font-moboko-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const appearance = await fetchPublishedAppearance();
  const appName = appearance.brand.siteName || "Moboko";
  const icon = appearance.brand.faviconUrl || appearance.brand.logoUrl || "/icons/moboko-icon.svg";

  return {
    metadataBase: new URL("https://moboko-production.up.railway.app"),
    applicationName: appName,
    title: {
      default: appName,
      template: `%s - ${appName}`,
    },
    description:
      "Application spirituelle avec assistant IA, enseignements et projection en temps reel.",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: appName,
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon,
      apple: icon,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#080b12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${mobokoDisplay.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
