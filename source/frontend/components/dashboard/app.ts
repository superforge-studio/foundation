import type { SettingsPart } from "./settings/screen"
import type { Navigation } from "./shell"

// This app's own part of the admin, beside the template's: its sections,
// in the sidebar after the Overview (./navigation.ts), and its parts of
// Settings, after the team (./settings/screen.tsx). They're here so an
// update from the template never meets them. README.md, beside this file,
// has the steps that build a section.

/**
 * This app's own sections, in groups, each under its name in the sidebar,
 * after the template's Overview. Each names the area its routes name
 * (utilities/permissions/), so a role that can't read it doesn't see it,
 * and is drawn `NotPermitted` if they open it anyway:
 *
 *   export const APP_NAVIGATION: Navigation = [
 *       {
 *           group: "Customers",
 *           sections: [
 *               {
 *                   to: "/admin/customers",
 *                   name: "Customers",
 *                   icon: ContactRound,
 *                   area: "customers"
 *               }
 *           ]
 *       }
 *   ]
 *
 * None, as the template ships: the dashboard is the business's to build.
 */
export const APP_NAVIGATION: Navigation = []

/**
 * This app's own parts of Settings, after the template's team, each shown
 * to a role that may read its area, and the gear to anyone who may read
 * one of them:
 *
 *   export const APP_SETTINGS: readonly SettingsPart[] = [
 *       { key: "payments", area: "payments", Part: Payments }
 *   ]
 *
 * A part is a component of its own, which asks the API for what it shows.
 */
export const APP_SETTINGS: readonly SettingsPart[] = []
