const Context = require('effect/Context');
const Effect = require('effect/Effect');
console.log("Context keys:", Object.keys(Context));
console.log("Effect.async exists:", !!Effect.async);
