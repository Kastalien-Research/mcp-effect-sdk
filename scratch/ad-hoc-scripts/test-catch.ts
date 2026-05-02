import { Effect, Option } from "effect";

const e1 = Effect.succeed(1) as Effect.Effect<number, string>;
// test different catches
export const test1 = Effect.catchAll(e1, (e) => Effect.succeed({ tag: "err", e }));
export const test2 = e1.pipe(Effect.catchAll((e) => Effect.succeed({ tag: "err", e })));
export const test3 = Effect.catchCause(e1, (cause) => Effect.succeed({ tag: "err", cause }));
export const test4 = Effect.fork(e1);
export const test5 = Option.fromNullable(null);
