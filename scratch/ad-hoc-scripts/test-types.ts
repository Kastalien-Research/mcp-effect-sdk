import { RpcSerialization } from '@effect/rpc/RpcSerialization';
import * as RpcClient from '@effect/rpc/RpcClient';
import { Effect, Queue } from 'effect';

console.log('RpcSerialization typeof:', typeof RpcSerialization);
console.log('RpcClient.Protocol typeof:', typeof RpcClient.Protocol);
console.log('Effect.async exists:', !!Effect.async);
