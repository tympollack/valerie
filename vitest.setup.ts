import "@testing-library/jest-dom";

// Polyfill Web Crypto for jsdom if needed
if (!globalThis.crypto) {
  const cryptoNode = require("crypto");
  // @ts-ignore
  globalThis.crypto = cryptoNode.webcrypto;
}
