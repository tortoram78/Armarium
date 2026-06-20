// End-to-end proof of the verify→correct→re-plan loop at the SERVICE level (in-memory repo, no LLM):
// plan a trip → correct a facet on an owned item → re-plan the SAME trip → the saved recommendation
// changes and is persisted. This is the payoff the UI delivers; here it's pinned deterministically.

import { describe, it, expect } from "vitest";
import {
  planAndSave, replanTrip, getTrip, getItem, updateItemClassification, setInventory,
} from "@/server/app-service";
import { applyUserCorrections } from "@/core/corrections";
import { MARCY_CONDITIONS } from "@/core/trips";

describe("verify → correct → re-plan (service-level, in-memory seed)", () => {
  it("a facet correction propagates through re-plan and is persisted on the trip", async () => {
    await setInventory("terre-planing", true); // ensure the sun pick is in the closet
    const original = (await getItem("terre-planing"))!.classification;

    const trip = await planAndSave("Loop test", MARCY_CONDITIONS, undefined);
    const r1 = JSON.stringify(trip.result);
    // The Terre Planing is the canonical sun-protection pick for this plan.
    expect(trip.result!.picks.some((p) => p.id === "terre-planing")).toBe(true);

    // sun_protection is satisfied by upf>=30 OR function_purpose⊇"sun_protection" (see capabilities).
    // Clear BOTH levers so the item genuinely stops backing sun protection.
    const corrected = applyUserCorrections(original, {
      "universal.upf": "unknown",
      "multilabel.function_purpose": [],
    });
    await updateItemClassification("terre-planing", corrected);

    // Re-plan the SAME saved trip against the now-corrected closet.
    const replanned = await replanTrip(trip.id);
    const r2 = JSON.stringify(replanned!.result);

    expect(r2).not.toEqual(r1); // the correction propagated through re-plan
    expect(replanned!.result!.picks.some((p) => p.id === "terre-planing")).toBe(false);
    // …and the new result is persisted on the trip, not just returned.
    expect(JSON.stringify((await getTrip(trip.id))!.result)).toEqual(r2);

    await updateItemClassification("terre-planing", original); // restore shared seed state
  });

  it("re-plan reflects inventory changes (remove an item → it leaves the picks)", async () => {
    await setInventory("terre-planing", true);
    const trip = await planAndSave("Inventory replan", MARCY_CONDITIONS, undefined);
    expect(trip.result!.picks.some((p) => p.id === "terre-planing")).toBe(true);

    await setInventory("terre-planing", false);
    const replanned = await replanTrip(trip.id);
    expect(replanned!.result!.picks.some((p) => p.id === "terre-planing")).toBe(false);

    await setInventory("terre-planing", true); // restore
  });
});
