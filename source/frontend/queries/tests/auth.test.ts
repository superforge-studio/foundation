import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { expect, test } from "vitest"
import { every } from "@/utilities/permissions"
import { type SessionAnswer, sessionQuery, useSession } from "../auth"

// What useSession() tells a page drawn over the HTML the server drew for a
// visitor. React hydrates a page with each store's server snapshot, as it
// draws the server's own HTML, so a render on the server stands in for one
// that hydrates here: the tests run in Node, with no page to hydrate.

// Someone on the team, as GET /api/auth/session answers them
const LOGGED_IN: SessionAnswer = {
    user: {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "ada",
        email: "ada@example.com",
        name: "Ada Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
        role: "owner",
        created_at: "2026-11-24T09:00:00.000Z"
    },
    permissions: every("write"),
    scopes: null
}

function Status() {
    return useSession().status
}

// What a page says of who's logged in, drawn with the session's answer
// already in the cache, as the toolbar may have it before the page's own
// part hydrates
function drawnWith(answer: SessionAnswer) {
    const client = new QueryClient()
    client.setQueryData(sessionQuery.queryKey, answer)
    return renderToString(
        createElement(QueryClientProvider, { client }, createElement(Status))
    )
}

test("a page that hydrates is drawn for a visitor, though the browser already knows who's logged in", () => {
    expect(drawnWith(LOGGED_IN)).toBe("loading")
})
