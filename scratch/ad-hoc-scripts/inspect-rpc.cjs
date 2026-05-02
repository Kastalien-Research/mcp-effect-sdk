const RpcClient = require('@effect/rpc/RpcClient');
const Effect = require('effect/Effect');
console.log("RpcClient.Protocol:", typeof RpcClient.Protocol);
console.log("Protocol keys:", RpcClient.Protocol ? Object.keys(RpcClient.Protocol) : 'null');
console.log("Effect.async exists:", !!Effect.async);
if (!Effect.async) {
  console.log("Async-related keys in Effect:", Object.keys(Effect).filter(k => k.toLowerCase().includes('async') || k.toLowerCase().includes('promise')));
}
