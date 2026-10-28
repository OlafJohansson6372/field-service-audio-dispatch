import assert from "node:assert/strict";
import test from "node:test";
import { decideDispatch } from "./dispatch_decision.js";

test("a reported gas leak overrides the ordinary photo follow-up", () => {
  assert.deepEqual(decideDispatch("There is a gas leak by the meter", 2), {
    status: "urgent_dispatch",
    followUp: "Call dispatch and isolate the site."
  });
});

test("a routine visit without photos asks for evidence", () => {
  assert.equal(decideDispatch("Replaced the filter", 0).followUp, "Ask the technician for a work-order photo.");
});
