# MCP `2026-07-28` Release-Candidate History

The repository implemented the release-candidate architecture before the final
specification release:

| Commit                                     | Time       | Evidence                             |
| ------------------------------------------ | ---------- | ------------------------------------ |
| `11d1afa72bb497f3ccc9bab49d00453e5fd32b1b` | 2026-06-23 | Added modern protocol support        |
| `d0d29860949b5321e8a1f7bd54c7aa972c501a66` | 2026-06-23 | Added client MRTR                    |
| `7acc9dc8be285c440ddc4b5c23f6d85ccbd9c442` | 2026-06-24 | Added the Everything client/server   |
| `7f19e5e32ec024689b589fbf5ee1276d5832c185` | 2026-06-27 | Added OAuth client hardening         |
| `76a16fecc1945600798106967455bc2d9f793c00` | 2026-07-21 | Merged the Tier 1 integration work   |
| `00dbf7e55169e48cfb32be0906d6b87b29cb0fbe` | 2026-07-27 | Last recorded pre-release SDK commit |

This history establishes that the substantive release-candidate features were
implemented before the final `2026-07-28` release. It does **not** establish:

- that the final dated schema was pinned at those commits;
- a stable package publication;
- an SDK Working Group release-timeline agreement; or
- an MCP SDK Tier designation.

Finalization is classified separately: pin the released source, regenerate,
produce same-commit conformance evidence, publish a stable package, and submit
the official self-assessment.
