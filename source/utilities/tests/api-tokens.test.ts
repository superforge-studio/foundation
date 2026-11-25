import { expect, test } from "vitest"
import { AGENT_SCOPES } from "@/utilities/schemas/agents"
import { API_TOKEN_SCOPES } from "@/utilities/schemas/api-tokens"

test("an API token may have every scope Claude's tokens may", () => {
    for (const scope of AGENT_SCOPES) {
        expect(API_TOKEN_SCOPES).toContain(scope)
    }
})
