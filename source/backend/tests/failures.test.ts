import { Hono } from "hono"
import { testClient } from "hono/testing"
import { expect, test, vi } from "vitest"
import { z } from "zod"
import {
    answerNotFound,
    answerUnexpected,
    failure,
    validated
} from "@/backend/failures"
import { testApi } from "@/backend/tests/support/api"
import { api_failure } from "@/utilities/schemas/failures"

// Each way a route fails, answered in the one shape every failure takes
// (utilities/schemas/failures.ts), on an app of the test's own with the
// API's handlers, and on the API itself for what index.ts wires

const app = new Hono()
    .basePath("/api")
    .notFound(answerNotFound)
    .onError(answerUnexpected)
    .post(
        "/things",
        validated("json", z.object({ name: z.string().min(1) })),
        (context) => context.json({ named: context.req.valid("json").name })
    )
    .get("/things/:id", (context) =>
        failure(context, 404, "not-found", "No such thing")
    )
    .get("/broken", () => {
        throw new Error("A bug")
    })

test("input that fits reaches the route, checked", async () => {
    const response = await testClient(app).api.things.$post({
        json: { name: "First" }
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ named: "First" })
})

test("input that doesn't fit is answered 400, with what didn't fit", async () => {
    const response = await testClient(app).api.things.$post({
        json: { name: "" }
    })
    expect(response.status).toBe(400)
    const { error } = api_failure.parse(await response.json())
    expect(error.reason).toBe("invalid")
    expect(error.issues?.map((issue) => issue.path)).toEqual(["name"])
})

test("a route that throws is answered 500, and logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await app.request("/api/broken")
    expect(response.status).toBe(500)
    const { error } = api_failure.parse(await response.json())
    expect(error.reason).toBe("unexpected")
    expect(logged).toHaveBeenCalledWith(
        "A route threw",
        expect.objectContaining({ path: "/api/broken" })
    )
})

test("the API answers a path no route answers 404, uncached, and logs it", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { api } = await testApi()
    const response = await api.request("/api/nowhere")
    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const { error } = api_failure.parse(await response.json())
    expect(error.reason).toBe("not-found")
    expect(warned).toHaveBeenCalledWith(
        "A request missed that looks meant for the app",
        expect.stringContaining('"path":"/api/nowhere"')
    )
})

test("a route's own 404, for what isn't there, isn't a miss", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    const response = await app.request("/api/things/missing")
    expect(response.status).toBe(404)
    expect(warned).not.toHaveBeenCalled()
})

test("a body that isn't JSON is answered 400 invalid, not as a bug", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await app.request("/api/things", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
    })
    expect(response.status).toBe(400)
    expect(api_failure.parse(await response.json()).error.reason).toBe(
        "invalid"
    )
    expect(warned).toHaveBeenCalled()
    expect(logged).not.toHaveBeenCalled()
})

test("the API refuses another site's form, and takes this site's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { api } = await testApi()
    const form = {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }

    const cross_site = await api.request("http://app.test/api/auth/sign-out", {
        ...form,
        headers: { ...form.headers, Origin: "https://elsewhere.test" }
    })
    expect(cross_site.status).toBe(403)
    expect(api_failure.parse(await cross_site.json()).error.reason).toBe(
        "forbidden"
    )

    // Behind Railway's proxy the request says http and the browser https:
    // the host is what counts
    const same_site = await api.request("http://app.test/api/auth/sign-out", {
        ...form,
        headers: { ...form.headers, Origin: "https://app.test" }
    })
    expect(same_site.status).toBe(200)

    // A browser that says the request came from this site
    const same_origin = await api.request("http://app.test/api/auth/sign-out", {
        ...form,
        headers: { ...form.headers, "Sec-Fetch-Site": "same-origin" }
    })
    expect(same_origin.status).toBe(200)
})
