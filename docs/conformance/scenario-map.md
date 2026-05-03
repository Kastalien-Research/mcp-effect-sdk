# Conformance Scenario Map

Generated manually from `../conformance/src/scenarios/server/**` for Phase 6.

| Scenario | SDK feature | Status | Evidence |
| --- | --- | --- | --- |
| completion-complete | Completion request handling | mapped | `src/examples/everything-server.ts` handles `completion/complete`. |
| dns-rebinding-protection | HTTP host binding | expected-failure | Local sandbox blocks this diagnostic path; baseline records the current failure. |
| elicitation-sep1034-defaults | Elicitation-compatible tool behavior | expected-failure | Requires server-to-client elicitation request support. |
| elicitation-sep1330-enums | Elicitation enum-compatible behavior | expected-failure | Requires server-to-client elicitation request support. |
| logging-set-level | Logging level request | mapped | Server handles `logging/setLevel`. |
| ping | Ping request | mapped | Server handles `ping`. |
| prompts-get-embedded-resource | Embedded resource prompt | expected-failure | Prompt name/shape is tracked in the baseline for follow-up. |
| prompts-get-simple | Simple prompt | mapped | `test_simple_prompt`. |
| prompts-get-with-args | Prompt arguments | mapped | `test_prompt_with_arguments`. |
| prompts-get-with-image | Image prompt | mapped | `test_prompt_with_image`. |
| prompts-list | Prompt listing | mapped | Server handles `prompts/list`. |
| resources-list | Resource listing | mapped | Server handles `resources/list`. |
| resources-read-binary | Binary resource read | mapped | `test://static-binary`. |
| resources-templates-read | Template resource read | mapped | `test://template/{id}`. |
| resources-read-text | Text resource read | mapped | `test://static-text`. |
| resources-subscribe | Resource subscription request | mapped | Server accepts `resources/subscribe`. |
| resources-unsubscribe | Resource unsubscription request | mapped | Server accepts `resources/unsubscribe`. |
| server-initialize | MCP initialization | mapped | Server handles `initialize` and session headers. |
| server-sse-multiple-streams | SSE multi-stream behavior | unsupported | This SDK example uses request/response HTTP only. |
| server-sse-polling | SSE polling behavior | unsupported | This SDK example uses request/response HTTP only. |
| tools-call-audio | Audio tool response | mapped | `test_audio_content`. |
| tools-call-elicitation | Elicitation tool response | expected-failure | Requires server-to-client elicitation request support. |
| tools-call-embedded-resource | Embedded resource tool response | mapped | `test_embedded_resource`. |
| tools-call-error | Tool error response | mapped | `test_error_response`. |
| tools-call-image | Image tool response | mapped | `test_image_content`. |
| tools-call-mixed-content | Mixed content tool response | mapped | `test_multiple_content_types`. |
| tools-call-sampling | Sampling tool response | expected-failure | Requires server-to-client sampling request support. |
| tools-call-simple-text | Simple text tool response | mapped | `test_simple_text`. |
| tools-call-with-logging | Logging tool response | expected-failure | Requires streamed logging notifications during tool execution. |
| tools-call-with-progress | Progress-compatible tool response | expected-failure | Requires streamed progress notifications during tool execution. |
| tools-list | Tool listing | mapped | Server handles `tools/list`. |

Pending conformance scenarios excluded from the active suite:

| Scenario | Reason |
| --- | --- |
| json-schema-2020-12 | Pending in `../conformance/src/scenarios/index.ts`. |
