import { z } from "zod"
import { APP_EVENTS } from "./app-events"

// What happens in the app that a workflow can start on: each event by its
// name, `<record>-<verb>`, with the shape of what it carries. A write
// queues one with `queueEvent` (queue.ts), in its own transaction, and
// every workflow whose `on` names it gets a run (README.md, "Events").
//
// An event carries the IDs a workflow needs, and little else: its run may
// start seconds later, try again, or finish after a later one, so it reads
// the record as it is then rather than trusting a copy. Each is declared
// when the first workflow needs it, in the same change: the template's
// here, and this app's own in ./app-events.ts (`APP_EVENTS`), never here.

export const EVENTS = {
    // Someone new is on the team: the server's start, or their first
    // login, made their user, as auth/app.ts lists them
    // (backend/users/sync.ts). With their address, for the run's title.
    "user-added": z.object({ user_id: z.uuid(), email: z.string() }),
    ...APP_EVENTS
} satisfies Record<string, z.ZodType>

/** An event's name. */
export type EventName = keyof typeof EVENTS

/** What an event carries. */
export type EventData<Name extends EventName> = z.output<(typeof EVENTS)[Name]>

/**
 * The events a workflow that takes `Input` can start on: those whose data
 * fits its input, so `on` names only those.
 */
export type EventsFor<Input> = {
    [Name in EventName]: EventData<Name> extends Input ? Name : never
}[EventName]
