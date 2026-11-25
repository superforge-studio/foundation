import { expect, test } from "vitest"
import { APP_SAMPLES } from "./support/app"
import { testDatabase } from "./support/database"
import { fill } from "./support/fill"

// The upgrade test's sample rows on checks a copy's tables may have, like
// an appointment's or a note's: one column after another, and at
// least one of several set, on tables of the test's own, named so they
// never meet a copy's. A row that broke either would fail its insert, and
// fill() with it.

test("fill() meets a check for one column after another, and one for at least one of several", async () => {
    const database = await testDatabase()
    const client = await database.$client.connect()
    try {
        await client.query(`
            create table sample_people (
                id uuid primary key default gen_random_uuid(),
                name text not null
            );
            create table sample_visits (
                id uuid primary key default gen_random_uuid(),
                starts_at timestamptz not null,
                ends_at timestamptz not null,
                check (ends_at > starts_at)
            );
            create table sample_notes (
                id uuid primary key default gen_random_uuid(),
                person_id uuid references sample_people (id),
                visit_id uuid references sample_visits (id),
                body text not null,
                check (num_nonnulls(person_id, visit_id) >= 1)
            )
        `)

        const filled = await fill(client)
        expect(filled.sample_visits).toBe(3)
        expect(filled.sample_notes).toBe(3)
    } finally {
        client.release()
    }
})

test("fill() takes the app's own sample for a type or a check it can't read", async () => {
    const database = await testDatabase()
    const client = await database.$client.connect()
    APP_SAMPLES["sample_codes.code"] = (variant) => `AB-${100 + variant}`
    APP_SAMPLES.interval = (variant) => `${variant} days`
    try {
        await client.query(`
            create table sample_codes (
                id uuid primary key default gen_random_uuid(),
                code text not null unique check (code ~ '^[A-Z]{2}-[0-9]{3}$'),
                lasts interval not null
            )
        `)
        const filled = await fill(client)
        expect(filled.sample_codes).toBe(3)
    } finally {
        delete APP_SAMPLES["sample_codes.code"]
        delete APP_SAMPLES.interval
        client.release()
    }
})
