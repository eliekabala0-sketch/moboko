import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Moboko",
    short_name: "Moboko",
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
        src: "/icons/moboko-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/moboko-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
