# Third-party notices

Foundation is under its own license ([LICENSE](LICENSE)), apart from
what came from others, listed here. Each stays under its own license,
whose terms go with it wherever it's copied.

## In this repository

### shadcn/ui's components

`source/frontend/components/primitives/` holds components that shadcn's
CLI wrote into the codebase (`components.json`), some changed since, and
any a copy adds the same way (`pnpm dlx shadcn@4 add <name>`) joins them.

- **Original work:** <https://github.com/shadcn-ui/ui>
- **License:** MIT, below.

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Impeccable's design rules

Several of the rules in `workbench/designing.md` are adapted, in our own
words, from Impeccable by Paul Bakaus.

- **Original work:** <https://github.com/pbakaus/impeccable>
- **License:** Apache License 2.0,
  <https://www.apache.org/licenses/LICENSE-2.0>

## Used, and not in this repository

- **Packages** (`package.json`), which `pnpm install` brings, each under
  the license in its own folder of `node_modules/`.
- **DB-IP's IP-to-country database**, which the server downloads where
  `LOCATION_DATABASE` names one (`source/backend/visits/location.ts`).
  It's under CC BY 4.0, so a screen that shows where visitors were
  credits DB-IP (`LOCATION_CREDIT`, `source/utilities/visitors.ts`).
