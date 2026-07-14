export type AppearanceBlockId = "intro" | "hero";

export type AppearancePayload = {
  brand: {
    logoUrl: string | null;
    faviconUrl: string | null;
    siteName: string;
  };
  images: {
    heroImageUrl: string | null;
    backgroundImageUrl: string | null;
    objectPosition: string;
    focalX: number;
    focalY: number;
    zoom: number;
    overlayOpacity: number;
  };
  colors: {
    accent: string;
    primary: string;
  };
  pages: {
    home: {
      eyebrow: string;
      title: string;
      highlight: string;
      lead: string;
      primaryButton: string;
      primaryHref: string;
      secondaryButton: string;
      secondaryHref: string;
      heroKicker: string;
      heroTitle: string;
    };
    download: {
      title: string;
      lead: string;
      primaryButton: string;
      secondaryButton: string;
    };
  };
  blocks: Array<{
    id: AppearanceBlockId;
    label: string;
    enabled: boolean;
    order: number;
  }>;
};

export type AppearanceRevision = {
  id: string;
  status: "draft" | "published" | "archived";
  title: string;
  payload: AppearancePayload;
  restored_from: string | null;
  published_at: string | null;
  updated_at: string;
};

export const defaultAppearancePayload: AppearancePayload = {
  brand: {
    logoUrl: null,
    faviconUrl: null,
    siteName: "Moboko",
  },
  images: {
    heroImageUrl: null,
    backgroundImageUrl: null,
    objectPosition: "center center",
    focalX: 50,
    focalY: 50,
    zoom: 1,
    overlayOpacity: 0.55,
  },
  colors: {
    accent: "#c9a962",
    primary: "#5b7fc8",
  },
  pages: {
    home: {
      eyebrow: "Moboko",
      title: "Votre compagnon spirituel, clair et respectueux",
      highlight: "clair et respectueux",
      lead: "Posez vos questions, explorez les enseignements, et vivez les temps forts en direct grace a l'assistant, avec une interface pensee pour la serenite et la lisibilite.",
      primaryButton: "Commencer",
      primaryHref: "/auth",
      secondaryButton: "Assistant",
      secondaryHref: "/chat",
      heroKicker: "Chemin interieur",
      heroTitle: "Une presence calme pour avancer avec clarte",
    },
    download: {
      title: "Installer Moboko",
      lead: "Accedez rapidement a l'Assistant, aux sermons, a la Bible, aux cantiques et a la projection depuis votre ecran d'accueil.",
      primaryButton: "Installer Moboko",
      secondaryButton: "Ouvrir Moboko",
    },
  },
  blocks: [
    { id: "intro", label: "Introduction", enabled: true, order: 1 },
    { id: "hero", label: "Image principale", enabled: true, order: 2 },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function nullableUrl(value: unknown, fallback: string | null = null) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.length > 0 ? raw : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeAppearancePayload(raw: unknown): AppearancePayload {
  const root = isRecord(raw) ? raw : {};
  const brand = isRecord(root.brand) ? root.brand : {};
  const images = isRecord(root.images) ? root.images : {};
  const colors = isRecord(root.colors) ? root.colors : {};
  const pages = isRecord(root.pages) ? root.pages : {};
  const home = isRecord(pages.home) ? pages.home : {};
  const download = isRecord(pages.download) ? pages.download : {};
  const base = defaultAppearancePayload;
  const blocksRaw = Array.isArray(root.blocks) ? root.blocks : base.blocks;
  const blocks: AppearancePayload["blocks"] = blocksRaw
    .filter(isRecord)
    .map((block, index) => {
      const id: AppearanceBlockId = block.id === "hero" ? "hero" : "intro";
      const fallback = base.blocks.find((b) => b.id === id) ?? base.blocks[index] ?? base.blocks[0]!;
      return {
        id,
        label: str(block.label, fallback.label),
        enabled: bool(block.enabled, fallback.enabled),
        order: num(block.order, fallback.order, 1, 20),
      };
    });
  for (const required of base.blocks) {
    if (!blocks.some((block) => block.id === required.id)) blocks.push(required);
  }

  return {
    brand: {
      logoUrl: nullableUrl(brand.logoUrl, base.brand.logoUrl),
      faviconUrl: nullableUrl(brand.faviconUrl, base.brand.faviconUrl),
      siteName: str(brand.siteName, base.brand.siteName),
    },
    images: {
      heroImageUrl: nullableUrl(images.heroImageUrl, base.images.heroImageUrl),
      backgroundImageUrl: nullableUrl(images.backgroundImageUrl, base.images.backgroundImageUrl),
      objectPosition: str(images.objectPosition, base.images.objectPosition),
      focalX: num(images.focalX, base.images.focalX, 0, 100),
      focalY: num(images.focalY, base.images.focalY, 0, 100),
      zoom: num(images.zoom, base.images.zoom, 1, 2.5),
      overlayOpacity: num(images.overlayOpacity, base.images.overlayOpacity, 0, 0.9),
    },
    colors: {
      accent: str(colors.accent, base.colors.accent),
      primary: str(colors.primary, base.colors.primary),
    },
    pages: {
      home: {
        eyebrow: str(home.eyebrow, base.pages.home.eyebrow),
        title: str(home.title, base.pages.home.title),
        highlight: str(home.highlight, base.pages.home.highlight),
        lead: str(home.lead, base.pages.home.lead),
        primaryButton: str(home.primaryButton, base.pages.home.primaryButton),
        primaryHref: str(home.primaryHref, base.pages.home.primaryHref),
        secondaryButton: str(home.secondaryButton, base.pages.home.secondaryButton),
        secondaryHref: str(home.secondaryHref, base.pages.home.secondaryHref),
        heroKicker: str(home.heroKicker, base.pages.home.heroKicker),
        heroTitle: str(home.heroTitle, base.pages.home.heroTitle),
      },
      download: {
        title: str(download.title, base.pages.download.title),
        lead: str(download.lead, base.pages.download.lead),
        primaryButton: str(download.primaryButton, base.pages.download.primaryButton),
        secondaryButton: str(download.secondaryButton, base.pages.download.secondaryButton),
      },
    },
    blocks: blocks.sort((a, b) => a.order - b.order),
  };
}
