import assert from "node:assert/strict";
import test from "node:test";
import { LoginRateLimiter } from "./login-rate-limiter.js";

test("blocks a client after 5 failures until the window passes", () => {
  let now = 0;
  const limiter = new LoginRateLimiter(() => now);
  for (let attempt = 0; attempt < 4; attempt += 1) { limiter.recordFailure("1.2.3.4"); now += 1000; }
  assert.equal(limiter.retryAfterMs("1.2.3.4"), 0);
  limiter.recordFailure("1.2.3.4");
  assert.ok(limiter.retryAfterMs("1.2.3.4") > 0);
  assert.equal(limiter.retryAfterMs("5.6.7.8"), 0, "other clients unaffected");
  now = 15 * 60 * 1000 + 1;
  assert.equal(limiter.retryAfterMs("1.2.3.4"), 0, "oldest failure expired");
});

test("success clears the failure count", () => {
  const limiter = new LoginRateLimiter(() => 0);
  for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure("ip");
  limiter.recordSuccess("ip");
  limiter.recordFailure("ip");
  assert.equal(limiter.retryAfterMs("ip"), 0);
});
