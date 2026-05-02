const RpcClient = require('@effect/rpc/RpcClient');
const Effect = require('effect/Effect');
console.log("RpcClient keys:", Object.keys(RpcClient));
console.log("Effect.async exists:", !!Effect.async);
