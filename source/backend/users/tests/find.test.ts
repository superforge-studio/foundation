import { expect, test } from "vitest"
import { users } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { findUser, internalEmails } from "../find"

// What the sign-up notices' steps read (users/workflows.ts): whom one is
// about, and whom it goes to

test("the team is everyone active, but the one a notice is about", async () => {
    const database = await testDatabase()
    const [ada] = await database
        .insert(users)
        .values([
            { slug: "ada", email: "ada@example.com" },
            { slug: "grace", email: "grace@example.com" },
            {
                slug: "linus",
                email: "linus@example.com",
                deactivated_at: new Date()
            }
        ])
        .returning({ id: users.id })
    if (ada === undefined) {
        throw new Error("The users weren't made")
    }

    expect(await internalEmails(database)).toEqual([
        "ada@example.com",
        "grace@example.com"
    ])
    expect(await internalEmails(database, ada.id)).toEqual([
        "grace@example.com"
    ])
})

test("someone removed is found as no one", async () => {
    const database = await testDatabase()
    expect(
        await findUser(database, "00000000-0000-4000-8000-000000000000")
    ).toBeNull()
})
