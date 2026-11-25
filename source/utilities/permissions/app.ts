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
 * (`roles`, backend/auth/app.ts).
 */
export const APP_AREAS = {} as const satisfies Record<string, string>

/**
 * This app's own roles, after the template's `owner` and `member`
 * (./index.ts): each by its name in the code, with what the dashboard calls
 * it, like:
 *
 *   export const APP_ROLES = {
 *       technician: "Technician"
 *   } as const satisfies Record<string, string>
 *
 * Then give it its areas in `roles`, and list someone with it, in
 * backend/auth/app.ts.
 */
export const APP_ROLES = {} as const satisfies Record<string, string>
