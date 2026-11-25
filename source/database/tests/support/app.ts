// The upgrade test's samples of this app's own (./fill.ts): none, as the
// template ships. `fill()` knows the column types and the checks the
// template's tables use; a column of the app's of another type
// (`varchar`, `bytea`, `interval`), or one whose check `fill()` can't read
// (a pattern, a range), gets its sample here, so the app never edits
// fill.ts. Each is keyed by `table.column`, the table as `fill()` names it
// (bare in `public`, else `schema.table`), or by a Postgres type's name
// for every column of that type, and makes the `variant`th sample, which
// differs from the others where the column is unique:
//
//   export const APP_SAMPLES: AppSamples = {
//       "quotes.reference": (variant) => `Q-${1000 + variant}`,
//       interval: (variant) => `${variant} days`
//   }

/** A sample for a column, by its `variant`. */
export type AppSamples = Record<string, (variant: number) => unknown>

export const APP_SAMPLES: AppSamples = {}
