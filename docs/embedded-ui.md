# Configure the embedded UI

Set `window.__INTERLOCK_CONFIG__` in the UI document before the application module loads:

```html
<script>
  window.__INTERLOCK_CONFIG__ = {
    ui: {
      features: {
        localFileImport: false,
        connectAgent: false,
      },
    },
  };
</script>
```

For a host that frames the served UI, put startup settings in the iframe URL:

```html
<iframe
  src="http://127.0.0.1:4310/?interlock.localFileImport=false&interlock.connectAgent=false"
  title="Interlock"
></iframe>
```

The UI reads settings once before routing starts. Client-side navigation, later changes to the global object, and browser storage do not change them. Reload the document to apply new settings. Setting the global on the parent window does not configure a framed child document. Use the iframe URL or set the global inside that document.

Both features default to `true`. For each feature, a boolean in the host configuration takes precedence over its URL parameter. URL values accept the exact strings `true` and `false`; the first occurrence wins if a parameter is repeated. Unknown keys, malformed containers, non-boolean host values, and other URL values are ignored. An invalid host value falls back to the URL setting, then the enabled default.

| Feature           | When `false`                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `localFileImport` | Removes the **Local file** import source and its hidden file input.                                                              |
| `connectAgent`    | Removes **Connect with MCP**, **Connect an agent**, and the connection dialog. Guidance no longer suggests opening a connection. |

**GitHub folder** remains the initial import source. **Paste JSON** is always available and accepts the same legacy workflow documents and portable bundles as local files. Import requires clicking **Import JSON**. It saves definitions and dependencies without starting a run. Legacy imports create a new workflow each time. Portable imports preserve identity, ownership, saved prompts, and published versions, and reject conflicts using the existing server defaults. The UI does not force draft replacement.

**Copy instructions for agent** remains available for waiting runs. Handoff behavior, manual submission, and execution rules stay the same. These settings control UI capabilities only; they do not restrict server APIs or MCP access. API transport, fetch, and EventSource injection are outside this configuration contract.
