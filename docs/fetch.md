# Fetch requests

A Fetch node sends an HTTP request and returns `{ "status": number, "headers": object, "body": value }`. It runs automatically, including inside List groups. Connect an Agent, Script, or Condition to its output to process the response.

## Configure a request

Add a **Fetch** node and enter an absolute HTTP or HTTPS URL. Choose the method, query parameters, headers, and optional JSON body. The default method is GET, the default timeout is 30 seconds, and HTTP statuses outside 200–299 fail the step by default.

URLs can interpolate input fields in their path or query:

```text
https://api.example.com/customers/{{input.customerId}}
```

The host stays fixed. Inserted values are URL-encoded. Use the query parameter editor to add parameters without assembling separators yourself.

Each query parameter, header, or body field has a name and one value source:

- **Fixed value** uses the value entered in the editor. Strings are literal, even when they contain `{{input.field}}`.
- **From input** reads a dot-separated path such as `customerId`, `customer.id`, or `items.0.id`. Enter the path without the `input.` prefix.

Missing fields fail the step with the missing path in the error. Bindings cannot contain expressions, functions, or conditions. Use a preceding Script for transformations or field names containing dots.

Query parameters and headers accept scalar values and convert them to text. Body fields preserve JSON types, including numbers, arrays, objects, and null. Body fields form one object; bind an object or use fixed JSON to supply nested structures. Body configuration also supports **Use entire input**, **Fixed JSON**, and **No body**. GET and HEAD cannot have a body. Requests with a body default to `Content-Type: application/json` unless a header overrides it.

Expand **Request preview** and enter sample input to see the resolved request. Preview uses the same resolver as execution, sends no request, and does not save sample data.

## Inspect a response

Run inspection shows the resolved HTTP request, elapsed time for the completed step, and the response output. Headers and bodies are persisted with the run, so stored values remain inspectable.

Response headers use lowercase names. JSON and `+json` content types are parsed as JSON; other bodies return UTF-8 text. Empty bodies return null. Invalid declared JSON fails the step. The decoded response body is limited to 5 MiB. The timeout covers both the request and reading its body, and can be configured from 100 milliseconds to 120 seconds. Fetch follows HTTP redirects.

HTTP errors retain their parsed response in the failed node execution. To branch on a status instead of failing the step, clear **Fail on HTTP errors** and connect a Condition that reads `status`.

## Cancellation and retries

Fetch has no automatic workflow retries. Cancelling a run aborts its unfinished requests. A service interruption marks an in-flight Fetch as failed rather than resending it on restart. Explicit retry sends the request again. Cancellation and timeout cannot undo a request that the remote server has already processed.

Fetch runs from the local engine with its network access. It does not use browser cookies or browser CORS restrictions. Authentication can be supplied through headers; there is no separate credential manager, OAuth flow, binary download, or multipart form editor.
