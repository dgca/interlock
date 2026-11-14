---
'@type_of/interlock': patch
---

Add opt-in OpenTelemetry trace export. Set `INTERLOCK_OTEL_TRACES=1` and the standard `OTEL_EXPORTER_OTLP_*` variables to send one trace per run tree over OTLP/HTTP JSON, with spans for runs, steps and Agent attempts and GenAI model, token and cost attributes. Inputs, outputs, prompts, errors and secrets are never exported. Export is off by default and never blocks a run.
