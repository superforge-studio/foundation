import { expect, test } from "vitest"
import { whatWentWrong } from "../login-form"

// What the login page tells someone, by the reason the API gave

// What the API answers an address not on the team (backend/auth/others.ts)
const NOT_LISTED =
    "This address can't log in here. Ask whoever runs this app to add you to the team."

test("someone not on the team is told so, in the API's words, not that login is down", () => {
    expect(whatWentWrong({ reason: "not-listed", message: NOT_LISTED })).toBe(
        NOT_LISTED
    )
})

test("too many logins from one network says when to try again", () => {
    expect(
        whatWentWrong({ reason: "too-many", message: "", retry_after: 600 })
    ).toBe("Too many logins from here for now. Try again in 10 minutes.")
})
