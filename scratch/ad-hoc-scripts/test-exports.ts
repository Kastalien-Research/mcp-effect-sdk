import * as effect from "effect";
console.log("Exports Context:", Object.keys(effect).filter(k => k.toLowerCase().includes("context")).join(", "));
console.log("Exports Tag:", Object.keys(effect).filter(k => k.toLowerCase().includes("tag")).join(", "));
