# Conformance Scenario Map

Generated manually from `../conformance/src/scenarios/server/**` for Phase 6.

| Scenario | SDK feature | Status | Evidence |
| --- | --- | --- | --- |
| completion-complete | Completion request handling | mapped | `src/examples/everything-server.ts` handles `completion/complete`. |
| dns-rebinding-protection | HTTP host binding | mapped | Server rejects non-localhost Host/Origin headers. |
| elicitation-sep1034-defaults | Elicitation-compatible tool behavior | mapped | Server initiates elicitation with primitive defaults. |
| elicitation-sep1330-enums | Elicitation enum-compatible behavior | mapped | Server initiates elicitation with enum schema variants. |
| logging-set-level | Logging level request | mapped | Server handles `logging/setLevel`. |
| ping | Ping request | mapped | Server handles `ping`. |
| prompts-get-embedded-resource | Embedded resource prompt | mapped | `test_prompt_with_embedded_resource`. |
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
| tools-call-elicitation | Elicitation tool response | mapped | Server initiates `elicitation/create`. |
| tools-call-embedded-resource | Embedded resource tool response | mapped | `test_embedded_resource`. |
| tools-call-error | Tool error response | mapped | `test_error_response`. |
| tools-call-image | Image tool response | mapped | `test_image_content`. |
| tools-call-mixed-content | Mixed content tool response | mapped | `test_multiple_content_types`. |
| tools-call-sampling | Sampling tool response | mapped | Server initiates `sampling/createMessage`. |
| tools-call-simple-text | Simple text tool response | mapped | `test_simple_text`. |
| tools-call-with-logging | Logging tool response | mapped | `test_tool_with_logging` streams log notifications. |
| tools-call-with-progress | Progress-compatible tool response | mapped | `test_tool_with_progress` streams progress notifications. |
| tools-list | Tool listing | mapped | Server handles `tools/list`. |

Pending conformance scenarios excluded from the active suite:

| Scenario | Reason |
| --- | --- |
| json-schema-2020-12 | Pending in `../conformance/src/scenarios/index.ts`. |
