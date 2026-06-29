// The NEED CATALOG (ADR-0027) — the DATA the packing engine reasons over. Each entry is a need spec whose
// `applies(ctx)` returns the severity this trip demands (or null). The engine evaluates the SAME function
// for every need — there is no per-trip branch and no category routing. Adding a need is adding a row here,
// exactly as adding a `Capability` is adding a predicate. This is "data the engine reasons over", NOT a
// hardcoded category list: the spec set is general (the 10 Essentials + big-3 + consumables + clothing),
// the predicates key off the structured TripConditions, and the deterministic floor deliberately does not
// try to enumerate every trip-specific item — that breadth is the later additive LLM layer (ADR-0027 §B).

import type { NeedSpec, TripContext, Severity } from "./types";

// ── condition flags (mirror src/core/recommend/derive.ts thresholds; tunable + explicit) ──
const tmin = (x: TripContext) => x.conditions.temp_min_c;
const tmax = (x: TripContext) => x.conditions.temp_max_c;
const cold = (x: TripContext) => tmin(x) !== null && tmin(x)! <= 8;
const freezing = (x: TripContext) => tmin(x) !== null && tmin(x)! <= 0;
const veryCold = (x: TripContext) => tmin(x) !== null && tmin(x)! <= -5;
const hot = (x: TripContext) => tmax(x) !== null && tmax(x)! >= 24;
const cool = (x: TripContext) => tmax(x) !== null && tmax(x)! <= 18;
const wetLight = (x: TripContext) => x.conditions.precipitation === "light";
const wetHeavy = (x: TripContext) =>
  x.conditions.precipitation === "sustained" || x.conditions.precipitation === "snow";
const windy = (x: TripContext) => x.conditions.wind === "strong";
const alpine = (x: TripContext) => x.conditions.exposure === "alpine";
const exposed = (x: TripContext) => x.conditions.exposure === "exposed" || alpine(x);
const highSun = (x: TripContext) => x.conditions.sun === "high" || alpine(x);
const working = (x: TripContext) => x.conditions.exertion !== "low";
const hardEffort = (x: TripContext) => x.conditions.exertion === "high";
const overnight = (x: TripContext) => x.nights >= 1;
const multiday = (x: TripContext) => x.nights >= 2;
/** Urban/travel trip (city break, business) with NO backcountry activity → the list is lifestyle-leaning. */
const urban = (x: TripContext) =>
  x.activities.some((a) => /city|travel|everyday|urban|business|tourist|sightsee/i.test(a)) &&
  !x.activities.some((a) => /hik|backpack|alpine|climb|camp|trek|mountaineer|ski|paddl/i.test(a));
const backcountry = (x: TripContext) => !urban(x);
const cooking = (x: TripContext) => overnight(x) && backcountry(x);
const hasActivity = (x: TripContext, re: RegExp) => x.activities.some((a) => re.test(a));

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
/** Per-trip count scaled by days × party (with sane floor/ceiling). */
const perTrip = (x: TripContext, perDay: number, lo: number, hi: number, unit: string) => ({
  amount: clamp(x.days * perDay, lo, hi) * x.partySize,
  unit,
});

// ── the catalog ─────────────────────────────────────────────────────────────────────────────────────
// Ordered roughly by the order a person packs; the engine groups by category for display.

export const NEED_SPECS: readonly NeedSpec[] = [
  // ── worn weather protection ──
  {
    key: "rain_shell",
    label: "Waterproof / windproof shell",
    category: "protection",
    capability: "weather_shell",
    applies: (x) =>
      wetHeavy(x) || (alpine(x) && cold(x)) ? "critical" : wetLight(x) || windy(x) ? "high" : null,
    rationale: (x) =>
      wetHeavy(x) ? "Sustained precipitation — a true waterproof shell." : "Wind / showers expected.",
  },
  // ── insulation & layers ──
  {
    key: "base_layer",
    label: "Wicking base layer",
    category: "insulation",
    capability: "wicking_base",
    applies: (x) => (working(x) && cool(x) ? "high" : null),
    quantity: (x) => (multiday(x) ? perTrip(x, 0.5, 1, 3, "tops") : null),
    rationale: () => "Working hard in the cool — a non-cotton base that won't chill you when wet.",
  },
  {
    key: "insulating_layer",
    label: "Packable insulation",
    category: "insulation",
    capability: "packable_insulation",
    applies: (x) =>
      cold(x) ? (veryCold(x) ? "critical" : freezing(x) || exposed(x) ? "high" : "medium") : null,
    rationale: () => "Warmth for stops, the summit, and camp.",
  },
  {
    key: "warm_extremities",
    label: "Warm hat & gloves",
    category: "insulation",
    matchTerms: ["beanie", "glove", "mitten", "balaclava", "buff", "neck gaiter", "warm hat"],
    applies: (x) => (cold(x) ? (veryCold(x) ? "high" : "medium") : null),
    rationale: () => "Most heat is lost from the head and hands.",
  },
  // ── sun ──
  {
    key: "sun_layer",
    label: "Sun-protective layer",
    category: "sun",
    capability: "sun_protection",
    applies: (x) => (highSun(x) ? (hot(x) ? "high" : "medium") : null),
    rationale: (x) => (alpine(x) ? "High-altitude UV is intense." : "Strong sun exposure."),
  },
  {
    key: "sunscreen",
    label: "Sunscreen (SPF 30+)",
    category: "sun",
    consumable: true,
    matchTerms: ["sunscreen", "spf", "sunblock"],
    applies: (x) => (highSun(x) ? "medium" : null),
    rationale: () => "Reapply through the day, especially at altitude or on snow.",
  },
  {
    key: "sunglasses",
    label: "Sunglasses",
    category: "sun",
    matchTerms: ["sunglass", "glacier glasses", "goggle"],
    applies: (x) => (highSun(x) ? (alpine(x) ? "high" : "medium") : null),
    rationale: (x) => (alpine(x) ? "Glacier/snow glare can cause snow blindness." : "Cut the glare."),
  },
  {
    key: "sun_hat",
    label: "Brimmed hat or cap",
    category: "sun",
    matchTerms: ["sun hat", "ball cap", "baseball cap", "visor", "brim", "boonie", "trucker hat"],
    applies: (x) => (highSun(x) ? "medium" : null),
  },
  // ── footwear ──
  {
    key: "footwear",
    label: "Trip-appropriate footwear",
    category: "footwear",
    matchTerms: ["boot", "shoe", "trail runner", "approach", "sneaker", "sandal"],
    applies: (x) => (backcountry(x) ? "high" : "low"),
    rationale: (x) => (alpine(x) ? "Stiff, supportive footwear for technical ground." : ""),
  },
  {
    key: "socks",
    label: "Socks",
    category: "footwear",
    consumable: true,
    matchTerms: ["sock"],
    applies: (x) => (backcountry(x) ? "medium" : "low"),
    quantity: (x) => perTrip(x, 1, 2, 5, "pairs"),
    rationale: () => "Dry socks prevent blisters; pack a spare for each day out.",
  },
  // ── pack ──
  {
    key: "pack",
    label: "Backpack",
    category: "carry",
    matchTerms: ["pack", "backpack", "rucksack", "daypack"],
    applies: (x) => (overnight(x) ? "high" : backcountry(x) ? "medium" : "low"),
    rationale: (x) => (multiday(x) ? "Enough capacity for multi-day load + food." : ""),
  },
  // ── shelter ──
  {
    key: "shelter",
    label: "Tent / shelter",
    category: "shelter",
    matchTerms: ["tent", "tarp", "shelter", "hammock", "bothy"],
    applies: (x) => (overnight(x) && backcountry(x) ? "critical" : null),
    rationale: () => "Your roof for the night.",
  },
  {
    key: "emergency_shelter",
    label: "Emergency shelter / bivy",
    category: "shelter",
    matchTerms: ["bivy", "emergency blanket", "space blanket", "survival bag", "storm shelter"],
    applies: (x) => ((exposed(x) || multiday(x)) && backcountry(x) ? "medium" : null),
    rationale: () => "An unplanned night out is survivable with one of these.",
  },
  // ── sleep ──
  {
    key: "sleep_bag",
    label: "Sleeping bag / quilt",
    category: "sleep",
    capability: "sleep_warmth",
    applies: (x) => (overnight(x) ? "high" : null),
    rationale: () => "Rated for the expected overnight low.",
  },
  {
    key: "sleep_pad",
    label: "Sleeping pad",
    category: "sleep",
    matchTerms: ["sleeping pad", "sleep pad", "pad", "mattress", "neoair", "thermarest", "z-lite"],
    applies: (x) => (overnight(x) && backcountry(x) ? "high" : null),
    rationale: (x) => (freezing(x) ? "An insulated pad (R-value) is what keeps the cold ground out." : "Insulation + comfort from the ground."),
  },
  // ── water ──
  {
    key: "water_carry",
    label: "Water bottles / reservoir",
    category: "water",
    matchTerms: ["bottle", "bladder", "reservoir", "flask", "nalgene", "hydration"],
    applies: () => "high",
    quantity: (x) => ({ amount: hot(x) || hardEffort(x) ? 3 : 2, unit: "L capacity" }),
    rationale: () => "Carry enough between sources.",
  },
  {
    key: "water_treatment",
    label: "Water filter / treatment",
    category: "water",
    matchTerms: ["filter", "purif", "tablet", "steripen", "sawyer", "katadyn", "aquatabs"],
    applies: (x) => (backcountry(x) && overnight(x) ? (multiday(x) ? "high" : "medium") : null),
    rationale: () => "Make backcountry water safe to drink.",
  },
  // ── food & cooking ──
  {
    key: "food",
    label: "Food",
    category: "nutrition",
    consumable: true,
    matchTerms: ["__never_match_food__"], // food is a consumable to bring, not owned gear to match
    applies: (x) => (overnight(x) && backcountry(x) ? "critical" : "medium"),
    quantity: (x) =>
      overnight(x)
        ? { amount: x.days, unit: hardEffort(x) ? "days (~3,500 kcal/day)" : "days (~2,500 kcal/day)" }
        : { amount: 1, unit: "day of snacks + lunch" },
    rationale: (x) => (hardEffort(x) ? "Hard effort burns a lot — pack calorie-dense food." : ""),
  },
  {
    key: "stove",
    label: "Stove",
    category: "nutrition",
    matchTerms: ["stove", "jetboil", "pocket rocket", "windburner", "canister stove", "whisperlite", "burner"],
    applies: (x) => (cooking(x) ? "high" : null),
  },
  {
    key: "fuel",
    label: "Stove fuel",
    category: "nutrition",
    consumable: true,
    matchTerms: ["__never_match_fuel__"],
    applies: (x) => (cooking(x) ? "high" : null),
    quantity: (x) => ({ amount: clamp(x.days / 3, 1, 4), unit: "fuel canister(s)" }),
  },
  {
    key: "cookware",
    label: "Pot & utensils",
    category: "nutrition",
    matchTerms: ["cook pot", "cookpot", "mug", "spork", "utensil", "cookset", "mess kit"],
    applies: (x) => (cooking(x) ? "medium" : null),
  },
  // ── navigation ──
  {
    key: "navigation",
    label: "Map & compass / GPS",
    category: "navigation",
    matchTerms: ["map", "compass", "gps", "garmin", "inreach", "altimeter"],
    applies: (x) => (backcountry(x) ? (exposed(x) || multiday(x) ? "high" : "medium") : null),
    rationale: () => "Know where you are when the phone dies.",
  },
  // ── light ──
  {
    key: "headlamp",
    label: "Headlamp",
    category: "light",
    matchTerms: ["headlamp", "head torch", "flashlight", "torch", "lantern"],
    applies: (x) => (overnight(x) ? "high" : backcountry(x) ? "medium" : null),
    rationale: () => "Hands-free light for camp and pre-dawn / late finishes.",
  },
  {
    key: "spare_batteries",
    label: "Spare batteries / charger",
    category: "light",
    consumable: true,
    matchTerms: ["batter", "spare cell"],
    applies: (x) => (multiday(x) && backcountry(x) ? "low" : null),
  },
  // ── first aid ──
  {
    key: "first_aid",
    label: "First-aid kit",
    category: "first_aid",
    matchTerms: ["first aid", "first-aid", "medical", "blister", "med kit"],
    applies: (x) => (backcountry(x) ? "high" : "low"),
    rationale: () => "Blister care at minimum; more for remote trips.",
  },
  // ── fire & repair ──
  {
    key: "fire",
    label: "Fire / ignition",
    category: "fire",
    matchTerms: ["lighter", "matches", "firestarter", "ferro", "flint"],
    applies: (x) => (overnight(x) && backcountry(x) ? "medium" : cold(x) && backcountry(x) ? "medium" : null),
  },
  {
    key: "repair_kit",
    label: "Knife / repair kit",
    category: "fire",
    matchTerms: ["knife", "multitool", "multi-tool", "repair", "duct tape", "tenacious", "needle"],
    applies: (x) => (multiday(x) && backcountry(x) ? "medium" : backcountry(x) ? "low" : null),
  },
  // ── hygiene ──
  {
    key: "toiletries",
    label: "Toiletries",
    category: "hygiene",
    matchTerms: ["toothbrush", "toiletr", "soap", "deodorant", "wash kit", "toothpaste"],
    applies: (x) => (overnight(x) ? (urban(x) ? "high" : "medium") : null),
  },
  {
    key: "trowel_tp",
    label: "Trowel & toilet paper",
    category: "hygiene",
    matchTerms: ["trowel", "toilet paper", "wag bag", "deuce"],
    applies: (x) => (multiday(x) && backcountry(x) ? "low" : null),
    rationale: () => "Leave no trace.",
  },
  // ── power ──
  {
    key: "phone",
    label: "Phone",
    category: "power",
    matchTerms: ["phone", "iphone", "pixel", "smartphone"],
    applies: () => "medium",
  },
  {
    key: "power_bank",
    label: "Power bank",
    category: "power",
    matchTerms: ["power bank", "battery pack", "charger", "anker", "powerbank"],
    applies: (x) => (multiday(x) ? "medium" : overnight(x) ? "low" : null),
  },
  // ── documents & money ──
  {
    key: "docs",
    label: "ID, permits & cash",
    category: "docs",
    matchTerms: ["permit", "license", "passport", "cash", "wallet", "credit card"],
    applies: (x) => (urban(x) ? "high" : multiday(x) && backcountry(x) ? "medium" : "low"),
    rationale: (x) => (backcountry(x) ? "Permits/parking pass where required." : ""),
  },
  // ── activity-specific ──
  {
    key: "trekking_poles",
    label: "Trekking poles",
    category: "activity",
    matchTerms: ["pole", "trekking pole", "hiking pole"],
    applies: (x) =>
      hasActivity(x, /hik|backpack|alpine|trek/i) && (exposed(x) || multiday(x) || alpine(x)) ? "low" : null,
    rationale: () => "Save your knees on the descents.",
  },
  {
    key: "traction",
    label: "Microspikes / traction",
    category: "activity",
    matchTerms: ["microspike", "crampon", "spike", "traction", "snowshoe", "yaktrax"],
    applies: (x) => (alpine(x) && freezing(x) ? "high" : null),
    rationale: () => "Ice and firm snow above treeline need traction.",
  },
];

/** All distinct severities, most-severe first — shared ordering for sorting lines/sections. */
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
