---
'@type_of/interlock': patch
---

Add startup settings for the engine's listen address and advertised HTTP URL. Diagnostics shows both values and their sources. A non-loopback listener or public hostname requires the API token. A wildcard listener refuses to start when another process holds the same port on the loopback address.
