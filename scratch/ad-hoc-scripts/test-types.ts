import { Context, Effect, Queue, Schema } from 'effect';

console.log('Context.Tag typeof:', typeof Context.Tag);
console.log('Schema.Struct typeof:', typeof Schema.Struct);
console.log('Effect.async exists:', !!Effect.async);
