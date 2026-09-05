"use client"

import { Effect, Schedule } from "effect"
import { useMemo } from "react"
import { EffectExample } from "@/components/display"
import { EmojiResult, StringResult } from "@/components/renderers"
import { useVisualEffect } from "@/hooks/useVisualEffects"
import type { ExampleComponentProps } from "@/lib/example-types"
import { visualEffect } from "@/VisualEffect"
import { createCounter } from "./helpers"

const hotdogCount = createCounter(0)

/**
 * Simulates eating a hotdog in a competitive eating contest
 */
function eatHotdog(): Effect.Effect<EmojiResult, never, never> {
  return Effect.gen(function* () {
    hotdogCount.increment()
    yield* Effect.sleep(400 + Math.random() * 500) // Variable eating speed
    return new EmojiResult(`${"🌭".repeat(hotdogCount.current)}`)
  })
}

export function EffectRepeatWhileOutputExample({
  exampleId,
  index,
  metadata,
}: ExampleComponentProps) {
  const baseTask = useVisualEffect("hotdog", eatHotdog)

  const repeatedTask = useMemo(
    () =>
      visualEffect(
        "contest",
        baseTask.effect.pipe(
          Effect.repeat(
            Schedule.spaced("400 millis").pipe(
              Schedule.while(({ elapsed }) => Effect.succeed(elapsed < 10_000)),
            ),
          ),
          Effect.ensuring(hotdogCount.reset),
          Effect.map(result => new StringResult(`🤢 ${result.toString()} Hotdogs!`)),
        ),
      ),
    [baseTask],
  )

  const codeSnippet = `const hotdog = eatHotdog()
const contest = Effect.repeat(hotdog,
  Schedule.spaced("400 millis").pipe(
    Schedule.while(({ elapsed }) => Effect.succeed(elapsed < 10_000))
  )
)`

  const taskHighlightMap = useMemo(
    () => ({
      hotdog: { text: "eatHotdog()" },
      contest: {
        text: 'Effect.repeat(hotdog, Schedule.spaced("400 millis").pipe(Schedule.while(({ elapsed }) => Effect.succeed(elapsed < 10_000))))',
      },
    }),
    [],
  )

  return (
    <EffectExample
      name={metadata.name}
      {...(metadata.variant && { variant: metadata.variant })}
      description={metadata.description}
      code={codeSnippet}
      effects={useMemo(() => [baseTask], [baseTask])}
      resultEffect={repeatedTask}
      effectHighlightMap={taskHighlightMap}
      showScheduleTimeline={true}
      {...(index !== undefined && { index })}
      exampleId={exampleId}
    />
  )
}

export default EffectRepeatWhileOutputExample
