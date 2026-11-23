import { register } from "node:module"
import { inspect } from "node:util"
import {
    context,
    DiagConsoleLogger,
    DiagLogLevel,
    diag,
    propagation,
    trace
} from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { W3CTraceContextPropagator } from "@opentelemetry/core"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg"
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici"
import {
    defaultResource,
    resourceFromAttributes
} from "@opentelemetry/resources"
import {
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SimpleSpanProcessor,
    type SpanProcessor,
    TracerProvider
} from "@opentelemetry/sdk-trace"
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION
} from "@opentelemetry/semantic-conventions"
import { createAddHookMessageChannel } from "import-in-the-middle"
import { z } from "zod"

/**
 * The server's traces, for Railway's Traces page: OpenTelemetry, set up
 * before anything it instruments is imported, which is why `pnpm start`
 * loads this with `--import` ahead of source/node.ts. Traces only: Railway
 * keeps every service's logs and metrics itself, and its collector takes
 * nothing else.
 *
 * It's on only where something takes the spans: on Railway, once tracing
 * is on for the service (`tracing` in .railway/railway.ts), whose next
 * deploy sets the `OTEL_EXPORTER_OTLP_*` variables that say where its
 * collector is; or with `OTEL_TRACES_EXPORTER=console`, which prints each
 * span, for trying it out on `pnpm preview`. Anywhere else, a dev server,
 * the tests and the smoke test without a collector among them, this does
 * nothing at all.
 *
 * What it traces on its own: every request the server answers (Node's
 * `http`), every query (`pg`, the app's and DBOS's) and every call out
 * (`fetch`, and `http` and `https`), each inside whatever span is running.
 * The app names what those can't know, each request's route and each
 * workflow's run and steps (utilities/tracing.ts), and anything it logs
 * while a span runs is kept on that span too (below). Like node.ts, Node
 * runs this from source, so it imports only packages.
 */

// The query parameters whose values never reach a span, on the requests
// the server answers and the ones it makes: the instrumentation's own list,
// of signed URLs' signatures, and the app's, OAuth's `code` and `state`,
// which Claude's login passes through (backend/agents/oauth.ts), and any
// `token` or `email`. A copy whose links carry a credential or a person's
// details in their query adds its parameter here.
const REDACTED_QUERY = [
    "sig",
    "Signature",
    "AWSAccessKeyId",
    "X-Goog-Signature",
    "X-Amz-Signature",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
    "code",
    "state",
    "token",
    "email"
]

// The scope of the span DBOS starts and ends as it launches, to check that
// spans nest (its `isTraceContextWorking`), which belongs to nothing
const DBOS_PROBE = "otel-bootstrap-check"

// How much of what's logged beside a message a span keeps: Railway cuts an
// attribute at 16 KiB
const LOGGED_DETAILS = 8 * 1024

// A variable that's set but empty, which OpenTelemetry counts as unset
function unsetWhenEmpty<Schema extends z.ZodType>(schema: Schema) {
    return z.preprocess(
        (value) => (value === "" ? undefined : value),
        schema.optional()
    )
}

// The variables that turn tracing on, and say where its spans go, as
// OpenTelemetry names them and Railway sets them
const tracing_environment = z.object({
    OTEL_SDK_DISABLED: unsetWhenEmpty(z.string()),
    OTEL_TRACES_EXPORTER: unsetWhenEmpty(z.enum(["otlp", "console", "none"])),
    OTEL_EXPORTER_OTLP_ENDPOINT: unsetWhenEmpty(z.string()),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: unsetWhenEmpty(z.string()),
    // The service's name on Railway, and its deployment's commit
    OTEL_SERVICE_NAME: unsetWhenEmpty(z.string()),
    OTEL_SERVICE_VERSION: unsetWhenEmpty(z.string())
})
type TracingEnvironment = z.infer<typeof tracing_environment>

// Where this process's spans go, if anywhere
function exporterFor(environment: TracingEnvironment) {
    const {
        OTEL_SDK_DISABLED,
        OTEL_TRACES_EXPORTER,
        OTEL_EXPORTER_OTLP_ENDPOINT,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    } = environment
    if (OTEL_SDK_DISABLED === "true" || OTEL_TRACES_EXPORTER === "none") {
        return null
    } else if (OTEL_TRACES_EXPORTER === "console") {
        return "console"
    } else if (
        OTEL_EXPORTER_OTLP_ENDPOINT !== undefined ||
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT !== undefined
    ) {
        return "otlp"
    } else {
        return null
    }
}

// What exports each span as it ends: to the collector in batches, every
// few seconds, or printed one by one. A span DBOS's launch ends to check
// that spans nest never goes.
function spanProcessor(exporter: "otlp" | "console"): SpanProcessor {
    const processor =
        exporter === "otlp"
            ? new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })
            : new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })
    return {
        onStart: (span, parent) => processor.onStart(span, parent),
        onEnd: (span) => {
            if (span.instrumentationScope.name !== DBOS_PROBE) {
                processor.onEnd(span)
            }
        },
        forceFlush: () => processor.forceFlush(),
        shutdown: () => processor.shutdown()
    }
}

/**
 * What's logged while a span runs is kept on it too, as an event named
 * for its message (always a static string, workbench/writing-code.md,
 * "Logging and tracing"), with the rest beside it, so a trace has its own
 * logs. The line itself ends with the trace's ID, to go from Railway's
 * logs to the trace. An error logged marks its span `app.error_logged`,
 * which Railway's Traces page searches by.
 */
function keepLogsOnSpans() {
    for (const level of ["debug", "info", "log", "warn", "error"] as const) {
        const log = console[level].bind(console)
        console[level] = (...logged: unknown[]) => {
            const span = trace.getActiveSpan()
            if (span === undefined || !span.isRecording()) {
                log(...logged)
                return
            }
            const [message, ...details] = logged
            span.addEvent(typeof message === "string" ? message : "log", {
                "log.severity": level,
                "log.details": inspect(
                    typeof message === "string" ? details : logged,
                    { depth: 6, breakLength: Number.POSITIVE_INFINITY }
                ).slice(0, LOGGED_DETAILS)
            })
            if (level === "error") {
                span.setAttribute("app.error_logged", true)
            }
            log(...logged, { trace_id: span.spanContext().traceId })
        }
    }
}

// Starts tracing this process, before the server's modules are imported:
// the hook that lets the instrumentations patch an `import` of what they
// instrument (Node's ESM loader, which import-in-the-middle hooks for the
// modules they name alone), the provider every span is made by, the
// context that carries the running span through each `await`, Railway's
// edge's `traceparent` read from each request and sent on with each call
// out, and then the instrumentations, which it waits for the hook to have
// taken before the server's modules are imported
async function startTracing(
    exporter: "otlp" | "console",
    environment: TracingEnvironment
) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)

    const { registerOptions, waitForAllMessagesAcknowledged } =
        createAddHookMessageChannel()
    register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions)

    // The service, as Railway names it, and its deployment's commit, which
    // a local run has none of
    const service = {
        [ATTR_SERVICE_NAME]: environment.OTEL_SERVICE_NAME ?? "app"
    }
    const version = environment.OTEL_SERVICE_VERSION
    const provider = new TracerProvider({
        resource: defaultResource().merge(
            resourceFromAttributes(
                version === undefined
                    ? service
                    : { ...service, [ATTR_SERVICE_VERSION]: version }
            )
        ),
        spanProcessors: [spanProcessor(exporter)]
    })
    trace.setGlobalTracerProvider(provider)
    context.setGlobalContextManager(
        new AsyncLocalStorageContextManager().enable()
    )
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())

    registerInstrumentations({
        tracerProvider: provider,
        instrumentations: [
            // A call out only inside a request, a run or a traced runner's
            // turn: one on its own isn't anything's
            new HttpInstrumentation({
                redactedQueryParams: REDACTED_QUERY,
                redactedQueryParamsServer: REDACTED_QUERY,
                requireParentforOutgoingSpans: true
            }),
            new UndiciInstrumentation({ requireParentforSpans: true }),
            // Likewise a query, so DBOS's polling of its queues, every
            // second, isn't a trace of its own each time
            new PgInstrumentation({ requireParentSpan: true })
        ]
    })
    await waitForAllMessagesAcknowledged()

    keepLogsOnSpans()
    console.info("Tracing", {
        exporter,
        service: environment.OTEL_SERVICE_NAME
    })
    return provider
}

// The variables, read once. Ones that don't fit leave tracing off rather
// than stop the server starting.
const read = tracing_environment.safeParse(process.env)
if (!read.success) {
    console.error("The tracing variables don't fit, so tracing is off", {
        issues: read.error.issues
    })
}
const exporter = read.success ? exporterFor(read.data) : null
const provider =
    read.success && exporter !== null
        ? await startTracing(exporter, read.data)
        : null

/**
 * Sends the spans not yet exported and stops tracing, as the server stops
 * (source/node.ts): Railway sends SIGTERM to the deployment it replaces,
 * and a span still in the batch would be lost.
 */
export async function stopTracing() {
    try {
        await provider?.shutdown()
    } catch (error) {
        console.error("The last spans couldn't be sent", { error })
    }
}
