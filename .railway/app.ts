import type { AppRailway } from "./railway.ts"

// This app's own Railway: its names, where it runs, its domains and its
// own variables. The template's ./railway.ts reads it, so an update from
// the template never meets what's here. workbench/setup/3-ship.md makes
// these the business's: as the template ships, they're the template's own
// deployment's.

export const APP = {
    // The Railway project, named for the business, like `acme-plumbing`
    project: "superforge-foundation",
    // This repository on GitHub, as `git remote get-url origin` shows it
    repository: "superforge-studio/foundation",
    // Railway's address for the app, `<name>.up.railway.app`, which has to
    // be free across all of Railway. The first apply makes it, and needs
    // it. Once the app has a domain of its own, an address that's gone
    // from Railway is left out (workbench/commit-and-deploy.md, "Domains")
    address: "superforge-foundation.up.railway.app",
    // Where the app, its database and its buckets all run: the region
    // nearest the business's customers (`REGIONS`, ./railway.ts). Choose it
    // once, before the first apply: a bucket can't move after it's made
    region: "us-east",
    // The business's own domains, like `www.acme-plumbing.com`, each added
    // first with `railway domain` (workbench/commit-and-deploy.md, "Domains")
    domains: [],
    // Variables of the app's own, beside the template's. A secret is
    // `preserve()`, from "railway/iac", which keeps the value set in
    // Railway's dashboard: `STRIPE_SECRET_KEY: preserve()`
    env: {}
} satisfies AppRailway
