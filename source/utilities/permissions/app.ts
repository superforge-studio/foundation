/**
 * This app's own areas, after the template's (./index.ts): each by its
 * name, which its routes give `permitted`, with what it covers, as the
 * dashboard says it. An area is what a person would grant, roughly a
 * screen of the dashboard, like:
 *
 *   export const APP_AREAS = {
 *       orders: "Orders, their payments and refunds"
 *   } as const satisfies Record<string, string>
 *
 * A new area is the owner's alone until a role is given a level in it
 * (`roles`, backend/auth/access.ts).
 */
export const APP_AREAS = {} as const satisfies Record<string, string>
