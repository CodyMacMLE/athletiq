import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TIER_CONFIG,
  getStripePriceId,
  getAthleteLimit,
  tierHasFeature,
  normalizeCurrency,
  isTierUpgrade,
} from "../subscriptions.js";

describe("TIER_CONFIG", () => {
  it("has correct athlete limits", () => {
    expect(TIER_CONFIG.STARTER.athleteLimit).toBe(75);
    expect(TIER_CONFIG.GROWTH.athleteLimit).toBe(200);
    expect(TIER_CONFIG.PRO.athleteLimit).toBe(500);
  });

  it("has correct CAD pricing in cents", () => {
    expect(TIER_CONFIG.STARTER.pricing.cad.amountCents).toBe(8000);   // $80
    expect(TIER_CONFIG.GROWTH.pricing.cad.amountCents).toBe(20000);  // $200
    expect(TIER_CONFIG.PRO.pricing.cad.amountCents).toBe(45000);     // $450
  });

  it("has correct USD pricing in cents", () => {
    expect(TIER_CONFIG.STARTER.pricing.usd.amountCents).toBe(5900);   // $59
    expect(TIER_CONFIG.GROWTH.pricing.usd.amountCents).toBe(14900);  // $149
    expect(TIER_CONFIG.PRO.pricing.usd.amountCents).toBe(32900);     // $329
  });
});

describe("getAthleteLimit", () => {
  it("returns correct limit per tier", () => {
    expect(getAthleteLimit("STARTER")).toBe(75);
    expect(getAthleteLimit("GROWTH")).toBe(200);
    expect(getAthleteLimit("PRO")).toBe(500);
  });
});

describe("tierHasFeature", () => {
  it("Starter has no advanced features", () => {
    expect(tierHasFeature("STARTER", "advancedAnalytics")).toBe(false);
    expect(tierHasFeature("STARTER", "advancedReporting")).toBe(false);
    expect(tierHasFeature("STARTER", "aiAtRiskDetection")).toBe(false);
  });

  it("Growth has advanced analytics but not AI or advanced reporting", () => {
    expect(tierHasFeature("GROWTH", "advancedAnalytics")).toBe(true);
    expect(tierHasFeature("GROWTH", "advancedReporting")).toBe(false);
    expect(tierHasFeature("GROWTH", "aiAtRiskDetection")).toBe(false);
  });

  it("Pro has all features", () => {
    expect(tierHasFeature("PRO", "advancedAnalytics")).toBe(true);
    expect(tierHasFeature("PRO", "advancedReporting")).toBe(true);
    expect(tierHasFeature("PRO", "aiAtRiskDetection")).toBe(true);
  });
});

describe("getStripePriceId", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER_CAD = "price_starter_cad_test";
    process.env.STRIPE_PRICE_GROWTH_USD = "price_growth_usd_test";
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_STARTER_CAD;
    delete process.env.STRIPE_PRICE_GROWTH_USD;
  });

  it("returns price ID from env var", () => {
    expect(getStripePriceId("STARTER", "cad")).toBe("price_starter_cad_test");
    expect(getStripePriceId("GROWTH", "usd")).toBe("price_growth_usd_test");
  });

  it("returns undefined when env var not set", () => {
    expect(getStripePriceId("PRO", "cad")).toBeUndefined();
  });
});

describe("normalizeCurrency", () => {
  it("returns cad for 'CAD' and 'cad'", () => {
    expect(normalizeCurrency("CAD")).toBe("cad");
    expect(normalizeCurrency("cad")).toBe("cad");
  });

  it("defaults to usd for unknown/null values", () => {
    expect(normalizeCurrency("USD")).toBe("usd");
    expect(normalizeCurrency(null)).toBe("usd");
    expect(normalizeCurrency(undefined)).toBe("usd");
    expect(normalizeCurrency("eur")).toBe("usd");
  });
});

describe("isTierUpgrade", () => {
  it("correctly identifies upgrades", () => {
    expect(isTierUpgrade("STARTER", "GROWTH")).toBe(true);
    expect(isTierUpgrade("STARTER", "PRO")).toBe(true);
    expect(isTierUpgrade("GROWTH", "PRO")).toBe(true);
  });

  it("correctly identifies downgrades and same-tier", () => {
    expect(isTierUpgrade("GROWTH", "STARTER")).toBe(false);
    expect(isTierUpgrade("PRO", "GROWTH")).toBe(false);
    expect(isTierUpgrade("STARTER", "STARTER")).toBe(false);
  });
});
