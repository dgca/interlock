# Export traces with OpenTelemetry

Interlock can send run traces to an OpenTelemetry collector or any backend that accepts OTLP over HTTP, such as Langfuse, Jaeger or Grafana Tempo. Export is off by default. When it is off, Interlock loads no exporter code and makes no network requests.

## Turn it on

Set `INTERLOCK_OTEL_TRACES=1` and point the standard OpenTelemetry variables at your collector, then start Interlock:

```sh
INTERLOCK_OTEL_TRACES=1 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
interlock
```

`OTEL_*` variables on their own never turn export on. Interlock reads these:

| Variable                                                            | Default                 | Use                                                                                       |
| ------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                       | `http://localhost:4318` | Base URL. Interlock appends `/v1/traces`.                                                 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`                                |                         | Full traces URL, used as given. Overrides the base URL.                                   |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS`   |                         | `key=value` pairs separated by commas, values URL-encoded. Use for authentication.        |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`   | `10000`                 | Request timeout in milliseconds.                                                          |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`                     | `interlock`             | Resource attributes on every span.                                                        |
| `OTEL_BSP_SCHEDULE_DELAY`                                           | `5000`                  | Milliseconds between batched sends.                                                       |
| `OTEL_BSP_MAX_QUEUE_SIZE`, `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`         | `2048`, `512`           | Spans held in memory, and spans per request.                                              |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | `http/json`             | Interlock sends OTLP/HTTP JSON only. Another value logs a warning and JSON is still sent. |

gRPC is not supported. Collectors accept OTLP/HTTP JSON on port 4318.

### Langfuse

Langfuse accepts OTLP/HTTP JSON at `/api/public/otel`. Authenticate with HTTP Basic auth built from your project's public and secret keys:

```sh
INTERLOCK_OTEL_TRACES=1 \
OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20$(printf 'pk-lf-...:sk-lf-...' | base64),x-langfuse-ingestion-version=4" \
interlock
```

Use your region's host, or `http://localhost:3000/api/public/otel` for a self-hosted Langfuse (v3.22.0 or later). The `x-langfuse-ingestion-version=4` header makes traces appear without Langfuse's ingestion delay.

## What a trace contains

Each run tree is one trace. A run that starts a detached workflow ends its own trace there: the detached run starts a new trace with a link back to the step that started it.

Spans nest like the run tree:

- **Run** (`invoke_workflow <workflow name>`): every run, including Batch items, Parallel branches and invoked child workflows. A child run's parent is the step that started it.
- **Node execution** (`<kind> <label>`): one span per step visit, under its run.
- **Agent attempt** (`invoke_agent <label>`): one span per claim attempt, under its Agent step, with model, token and cost attributes.

Spans are sent as steps finish, and a run's own span when the run finishes. Work that is still running when Interlock stops is sent when it finishes after the restart. Trace and span IDs are derived from run, execution and attempt IDs, so a restart continues the same trace and does not resend finished spans. Steps that finished while export was off, or before the current server started, are not sent.

Model, token and cost attributes follow the OpenTelemetry [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) (status: development) as published with semantic conventions v1.45.0:

| Attribute                                                                                                                      | Source                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gen_ai.operation.name`, `gen_ai.agent.name`                                                                                   | `invoke_workflow` with the workflow name on runs, `invoke_agent` with the step label on attempts.                                                                                                                  |
| `gen_ai.request.model`                                                                                                         | The model Interlock asked the executor to use, when one was set.                                                                                                                                                   |
| `gen_ai.provider.name`, `gen_ai.response.model`                                                                                | The reported model, when the attempt reported exactly one. Several models are listed in `interlock.usage.models`.                                                                                                  |
| `gen_ai.usage.input_tokens`, `output_tokens`, `cache_read.input_tokens`, `cache_write.input_tokens`, `reasoning.output_tokens` | The attempt's [reported usage](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md), summed across models.                                                                                         |
| `gen_ai.usage.cost`                                                                                                            | Reported or [derived](https://github.com/dgca/interlock/blob/main/docs/usage-reporting.md#derived-cost) cost in currency units, with `interlock.usage.cost.currency`. Not a standard attribute; Langfuse reads it. |

Interlock attributes (`interlock.*`) add run, execution, node, workflow and work IDs, node kind and label, workflow version, status, attempt number and outcome, Batch item index, Parallel branch key and executor name. Failed runs, steps and attempts have error status and `error.type` `failed`.

## What is never exported

- Run inputs, step inputs and outputs, results and Agent prompts.
- Error messages, which can contain any of the above.
- Variable and Secret values, request headers and bodies.
- File paths and working directories.
- The API token, claim tokens and the export headers themselves.

## When the collector is down

Export never blocks or fails a run. Spans wait in a bounded in-memory queue and are sent in batches, one request at a time, each with a timeout. When the queue is full or a request fails, Interlock drops those spans and logs how many, at most once a minute. On shutdown it gives the last batch two seconds.
