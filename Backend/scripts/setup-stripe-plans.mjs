/**
 * One-time setup script: creates AthletiQ subscription products + prices in Stripe
 * and prints the AWS SSM put-parameter commands to store the price IDs.
 *
 * Usage (from Backend/):
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe-plans.mjs
 *
 * Safe to re-run — looks up existing products/prices by lookup_key before creating.
 */

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("ERROR: STRIPE_SECRET_KEY env var is required.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-02-25.clover" });
const isLive = key.startsWith("sk_live_");
const mode = isLive ? "LIVE" : "TEST";
console.log(`\n🔑  Using Stripe ${mode} mode key\n`);

const PLANS = [
  {
    key: "STARTER",
    name: "AthletiQ Starter",
    description: "Up to 75 athletes — event scheduling, NFC check-ins, attendance tracking",
    prices: [
      { currency: "cad", unit_amount: 8000,  lookup_key: "athletiq_starter_cad_monthly" },
      { currency: "usd", unit_amount: 5900,  lookup_key: "athletiq_starter_usd_monthly" },
    ],
  },
  {
    key: "GROWTH",
    name: "AthletiQ Growth",
    description: "Up to 200 athletes — advanced analytics, leaderboards, CSV exports",
    prices: [
      { currency: "cad", unit_amount: 20000, lookup_key: "athletiq_growth_cad_monthly" },
      { currency: "usd", unit_amount: 14900, lookup_key: "athletiq_growth_usd_monthly" },
    ],
  },
  {
    key: "PRO",
    name: "AthletiQ Pro",
    description: "Up to 500 athletes — AI at-risk detection, advanced reporting",
    prices: [
      { currency: "cad", unit_amount: 45000, lookup_key: "athletiq_pro_cad_monthly" },
      { currency: "usd", unit_amount: 32900, lookup_key: "athletiq_pro_usd_monthly" },
    ],
  },
];

const results = {}; // { STRIPE_PRICE_STARTER_CAD: "price_xxx", ... }

for (const plan of PLANS) {
  // ── Find or create product ───────────────────────────────────────────────
  let product;
  const existing = await stripe.products.search({
    query: `name:'${plan.name}' AND active:'true'`,
    limit: 1,
  });
  if (existing.data.length > 0) {
    product = existing.data[0];
    console.log(`✔  Product exists: ${plan.name} (${product.id})`);
  } else {
    product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { tier: plan.key },
    });
    console.log(`✨  Created product: ${plan.name} (${product.id})`);
  }

  // ── Find or create prices ─────────────────────────────────────────────────
  for (const p of plan.prices) {
    const envVar = `STRIPE_PRICE_${plan.key}_${p.currency.toUpperCase()}`;

    // Look up by lookup_key first (idempotent re-runs)
    let price;
    try {
      const found = await stripe.prices.list({
        lookup_keys: [p.lookup_key],
        limit: 1,
      });
      if (found.data.length > 0) {
        price = found.data[0];
        console.log(`  ✔  Price exists: ${p.lookup_key} (${price.id})`);
      }
    } catch { /* not found */ }

    if (!price) {
      price = await stripe.prices.create({
        product: product.id,
        currency: p.currency,
        unit_amount: p.unit_amount,
        recurring: { interval: "month" },
        lookup_key: p.lookup_key,
        transfer_lookup_key: false,
        nickname: `${plan.key} ${p.currency.toUpperCase()} monthly`,
      });
      const dollars = (p.unit_amount / 100).toFixed(2);
      console.log(`  ✨  Created price: ${p.currency.toUpperCase()} $${dollars}/mo (${price.id})`);
    }

    results[envVar] = price.id;
  }
}

// ── Print SSM commands ─────────────────────────────────────────────────────
const region = "us-east-2";
console.log("\n\n─────────────────────────────────────────────────────────────────");
console.log("Run these commands to store the price IDs in SSM:\n");

for (const [envVar, priceId] of Object.entries(results)) {
  const ssmPath = `/athletiq/${envVar}`;
  console.log(
    `aws ssm put-parameter \\
  --name "${ssmPath}" \\
  --value "${priceId}" \\
  --type "String" \\
  --overwrite \\
  --region ${region}`
  );
  console.log();
}

console.log("─────────────────────────────────────────────────────────────────");
console.log(`\n✅  Done — ${Object.keys(results).length} prices configured (${mode} mode)\n`);
console.log("⚠️   These are your", isLive ? "LIVE" : "TEST", "mode prices.");
if (!isLive) {
  console.log("    Re-run with your sk_live_... key before going to production.\n");
}
