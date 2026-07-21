const Context = require('effect/Context');
const Effect = require('effect/Effect');
console.log("Context.Tag:", typeof Context.Tag);
console.log("Effect.async exists:", !!Effect.async);
if (!Effect.async) {
  console.log("Async-related keys in Effect:", Object.keys(Effect).filter(k => k.toLowerCase().includes('async') || k.toLowerCase().includes('promise')));
}
