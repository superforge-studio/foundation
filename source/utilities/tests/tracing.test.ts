import { context, SpanStatusCode, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
    TracerProvider
} from "@opentelemetry/sdk-trace"
import { Hono } from "hono"
import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import {
    nameRequest,
    recordError,
    traced,
    traceRoutes,
    tracer,
    tracingOn
} from "../tracing"

// What the app tells its traces (utilities/tracing.ts), on spans kept in
// memory, as source/tracing.ts would export them on Railway. Each test
// file runs in a process of its own, so the provider set here is this
// file's alone.

const exported = new InMemorySpanExporter()

// A request's span, as Node's `http` instrumentation starts one, with the
// method alone for its name, around `answer`
async function asRequest(answer: () => unknown) {
    await tracer.startActiveSpan("GET", async (span) => {
        try {
            await answer()
        } finally {
            span.end()
        }
    })
}

function spanNamed(name: string) {
    const span = exported.getFinishedSpans().find((each) => each.name === name)
    if (span === undefined) {
        throw new Error(`No span named ${name}`)
    } else {
        return span
    }
}

const things = new Hono()
    .use(traceRoutes)
    .get("/things/:id", (hono) => hono.text("a thing"))
    .get("*", (hono) => {
        nameRequest(hono.req.method, "/elsewhere/:key")
        return hono.text("somewhere")
    })

describe("before tracing starts", () => {
    test("says it's off, and answers requests without spans", async () => {
        expect(tracingOn()).toBe(false)
        const response = await things.request("/things/1")
        expect(await response.text()).toBe("a thing")
        expect(trace.getActiveSpan()).toBeUndefined()
    })
})

describe("once tracing starts", () => {
    beforeAll(() => {
        context.setGlobalContextManager(
            new AsyncLocalStorageContextManager().enable()
        )
        trace.setGlobalTracerProvider(
            new TracerProvider({
                spanProcessors: [
                    new SimpleSpanProcessor({ exporter: exported })
                ]
            })
        )
    })

    beforeEach(() => {
        exported.reset()
    })

    test("says it's on", () => {
        expect(tracingOn()).toBe(true)
    })

    test("names a request's span for the route it matched", async () => {
        await asRequest(() => things.request("/things/42"))
        const [span] = exported.getFinishedSpans()
        expect(span?.name).toBe("GET /things/:id")
        expect(span?.attributes["http.route"]).toBe("/things/:id")
    })

    test("lets a route that answers many addresses name its own", async () => {
        await asRequest(() => things.request("/link/abc"))
        expect(exported.getFinishedSpans()[0]?.name).toBe("GET /elsewhere/:key")
    })

    test("gives a request made in-process a span of its own inside the one it's in", async () => {
        const outer = new Hono()
            .use(traceRoutes)
            .get("/tools/:name", async (hono) => {
                await things.request("/things/7")
                return hono.text("called")
            })
        await asRequest(() => outer.request("/tools/call_api"))
        const request = spanNamed("GET /tools/:name")
        const call = spanNamed("GET /things/:id")
        expect(call.parentSpanContext?.spanId).toBe(
            request.spanContext().spanId
        )
        expect(call.attributes["http.route"]).toBe("/things/:id")
    })

    test("marks the running span failed with what was thrown", async () => {
        await asRequest(async () => {
            recordError(new Error("The thing broke"))
        })
        const [span] = exported.getFinishedSpans()
        expect(span?.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "The thing broke"
        })
        expect(span?.events[0]?.name).toBe("exception")
    })

    test("runs work in a span of its own, a trace of its own outside any", async () => {
        const answered = await traced("runner touches", async () => 3)
        expect(answered).toBe(3)
        const [span] = exported.getFinishedSpans()
        expect(span?.name).toBe("runner touches")
        expect(span?.parentSpanContext).toBeUndefined()
    })

    test("marks work that throws failed, and throws on", async () => {
        await expect(
            traced("runner prune", async () => {
                throw new Error("No database")
            })
        ).rejects.toThrow("No database")
        expect(exported.getFinishedSpans()[0]?.status.code).toBe(
            SpanStatusCode.ERROR
        )
    })
})
