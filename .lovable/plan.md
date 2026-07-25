## Active client accounts (5 total, all have auth users)

| Full name | Email | First login | Practitioner |
|---|---|---|---|
| Saxon Fowler | saxfow.7@gmail.com | — (not yet) | 0d3a2bc0… |
| Peter Parker | hello@peakmovement.co.za | 2026-07-22 | 0d3a2bc0… |
| Keenan Alcock | keenan.alcock@gmail.com | 2026-07-22 | 0d3a2bc0… |
| Asad test client | asadpythondeveloper@gmail.com | 2026-07-10 | f8970d4f… |
| Demo Client | client@demo.com | — (not yet) | 0d3a2bc0… |

All 5 rows in `clients` have `auth_user_id` set (accounts exist in auth). 3 have logged in at least once; Saxon Fowler and Demo Client have never signed in.

## Build fix

`src/lib/alert-actions.server.ts` imports from `"crypto"`, which Vite's client-scan resolves to the browser-external stub, breaking the build (`"createHmac" is not exported by "__vite-browser-external"`). Change the import to the Node-prefixed specifier so the Worker/Node resolver picks it up and the browser stub is not consulted:

```ts
import { createHmac, timingSafeEqual, randomBytes, createHash } from "node:crypto";
```

No other code changes.
