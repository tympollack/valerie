export interface NavItem {
  title: string
  href: string
  external?: boolean
  badge?: string
}

export interface SiteConfig {
  name: string
  shortName: string
  title: string
  tagline: string
  description: string
  url: string
  ogImage: string
  links: {
    github: string
  }
  telemetry: {
    system: string
    kernel: string
    protocol: string
  }
  navItems: NavItem[]
}

export const siteConfig: SiteConfig = {
  name: "The Votary",
  shortName: "Votary",
  title: "The Votary | Civic Consensus Engine",
  tagline: "The Civic Consensus Engine",
  description:
    "Deliberative civic consensus engine featuring sealed bivariate commit protocols, anti-Sybil human attestation, and anti-bandwagoning truth discovery.",
  url: process.env.NEXT_PUBLIC_APP_URL || "https://valerie.sunshade.icu",
  ogImage: "/og.png",
  links: {
    github: "https://github.com/tympollack/valerie",
  },
  telemetry: {
    system: "SunShade",
    kernel: "Project Valerie",
    protocol: "Anti-Sybil Bivariate Sealed Commit",
  },
  navItems: [
    {
      title: "Deliberation",
      href: "/",
    },
    {
      title: "Settings",
      href: "/settings",
    },
  ],
}
