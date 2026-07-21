# Third-party notices

Frozen upstream source inputs are retained for reproducible protocol generation, reconciliation, and interoperability checks. Their exact revisions, file paths, hashes, roles, and refresh commands are recorded in `sources/manifest.json`.

| Input | Vendored license/notice |
| --- | --- |
| MCP core | `sources/vendor/mcp-core/LICENSE` |
| Official conformance harness | `sources/vendor/mcp-conformance/LICENSE` |
| Tasks extension | `sources/vendor/tasks/LICENSE` |
| Apps stable profile | `sources/vendor/apps-stable/LICENSE` |
| Apps preview profile | `sources/vendor/apps-preview/LICENSE` |
| TypeScript SDK v2 oracle | `sources/vendor/typescript-sdk-v2/LICENSE` |

These files preserve upstream notices. Their inclusion does not change this package's own license and does not imply that an upstream implementation is linked into the published runtime.

## ajv-formats URI assertion

The bounded RFC 3986 URI assertion in `src/McpClient.ts` is derived from the
`fullFormats.uri` implementation in
[`ajv-formats` 3.0.1 `src/formats.ts`](https://github.com/ajv-validator/ajv-formats/blob/v3.0.1/src/formats.ts#L228-L234).
The package remains a development-only validation oracle and is not imported
by the published runtime.

MIT License

Copyright (c) 2020 Evgeny Poberezkin

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
