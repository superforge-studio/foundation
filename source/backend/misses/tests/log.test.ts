import { afterEach, expect, type MockInstance, test, vi } from "vitest"
import { logFailure, logMiss } from "@/backend/misses/log"

// Each request nothing answers, and each one that fails, logged on one
// line, with what tells who sent it and never what could carry a secret

afterEach(() => {
    vi.restoreAllMocks()
})

// The one line a spy on the console was given: its message, and its facts
// as JSON beside it
function logged(spy: MockInstance<(...data: unknown[]) => void>) {
    expect(spy).toHaveBeenCalledOnce()
    const [message, line] = spy.mock.calls[0] ?? []
    expect(typeof line).toBe("string")
    return { message, line: String(line), facts: JSON.parse(String(line)) }
}

test("a webhook sent to the wrong address is a warning, with why", () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    logMiss(
        new Request("https://example.com/webhooks/stripe?key=secret", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": "2",
                "Stripe-Signature": "t=1,v1=secret",
                "User-Agent": "Stripe/1.0"
            },
            body: "{}"
        }),
        404
    )
    const { message, line, facts } = logged(warned)
    expect(message).toBe("A request missed that looks meant for the app")
    expect(line).not.toContain("secret")
    expect(facts).toEqual({
        method: "POST",
        host: "example.com",
        path: "/webhooks/stripe",
        user_agent: "Stripe/1.0",
        content_type: "application/json",
        size: 2,
        signatures: ["stripe-signature"],
        status: 404,
        because: ["signed", "json"]
    })
})

test("a miss that's neither a probe nor meant for the app is information", () => {
    const informed = vi.spyOn(console, "info").mockImplementation(() => {})
    logMiss(
        new Request("https://example.com/old-page", {
            headers: { Referer: "https://elsewhere.com/post?token=secret" }
        }),
        404
    )
    const { message, facts } = logged(informed)
    expect(message).toBe("A request missed")
    expect(facts).toEqual({
        method: "GET",
        host: "example.com",
        path: "/old-page",
        referrer: "https://elsewhere.com/post",
        status: 404
    })
})

test("a scanner's probe isn't logged", () => {
    const informed = vi.spyOn(console, "info").mockImplementation(() => {})
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    logMiss(new Request("https://example.com/wp-login.php"), 404)
    expect(informed).not.toHaveBeenCalled()
    expect(warned).not.toHaveBeenCalled()
})

test("a request that failed is an error, whatever it was", () => {
    const errored = vi.spyOn(console, "error").mockImplementation(() => {})
    logFailure(new Request("https://example.com/wp-login.php"), 502)
    const { message, facts } = logged(errored)
    expect(message).toBe("A request failed")
    expect(facts).toEqual({
        method: "GET",
        host: "example.com",
        path: "/wp-login.php",
        status: 502
    })
})
