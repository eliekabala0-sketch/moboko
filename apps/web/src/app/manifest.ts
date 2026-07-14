import { fetchPublishedAppearance } from "@/lib/appearance/data";
import type { MetadataRoute } from "next";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const appearance = await fetchPublishedAppearance();
  const icon = appearance.brand.logoUrl || appearance.brand.faviconUrl || "/icons/moboko-icon.svg";
  const iconType = icon.endsWith(".svg") ? "image/svg+xml" : "image/png";

  return {
    name: appearance.brand.siteName || "Moboko",
    short_name: appearance.brand.siteName || "Moboko",
    description: "Assistant, sermons, Bible, cantiques et projection Moboko.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    background_color: "#080b12",
    theme_color: "#080b12",
    orientation: "portrait",
    categories: ["books", "education", "productivity"],
    icons: [
      {
        src: icon,
        sizes: "any",
        type: iconType,
        purpose: "any",
      },
      {
        src: icon,
        sizes: "any",
        type: iconType,
        purpose: "maskable",
      },
    ],
  };
}
