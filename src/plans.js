export const PAYMENT_LINKS = {"pilgrim":"https://buy.stripe.com/cNi28q51Zffrerjcza0kE04","devoted":"https://buy.stripe.com/14A8wOcur4ANab356I0kE05","saint":"https://buy.stripe.com/dRm00i2TRgjv82V42E0kE06"};
export const STORE_PAYMENT_LINKS = {"6ad1006402e855b98e011e44":"https://buy.stripe.com/5kQ28q0LJ3wJ0At0Qs0kE07","6ad100608c4e0d4bc2007158":"https://buy.stripe.com/7sY4gy51Z9V70At7eQ0kE08","6ad1005d9f29f0270501ace4":"https://buy.stripe.com/eVq6oG663ebn82VeHi0kE09","6ad1005902e855b98e011e3a":"https://buy.stripe.com/5kQbJ08eb2sF5UN7eQ0kE0a","6ad100579f29f0270501acdb":"https://buy.stripe.com/00w4gy663ebn6YRdDe0kE0b","6ad100528c4e0d4bc2007144":"https://buy.stripe.com/eVq4gy8ebffr0AtgPq0kE0c"};
// The three membership tiers and what each one unlocks. Single source of truth
// for pricing pages, gating, Stripe products, and board ranks.

export const PLANS = [
  {
    id: "pilgrim",
    tier: 1,
    name: "Pilgrim",
    price: 10,
    rank: "Companion",
    storeDiscount: 10,
    blurb: "Step into sacred discernment: the weekly Sunday Letter, every discernment quiz, and the foundational readings for all ten planets in all twelve signs.",
    points: [
      "The Sunday Letter — a weekly pastoral email",
      "All discernment quizzes",
      "120 foundational planet-in-sign readings",
      "Companion rank on the message board (read access)",
      "10% off everything in the store",
      "Ad-free browsing",
    ],
  },
  {
    id: "devoted",
    tier: 2,
    name: "Devoted",
    price: 20,
    introPrice: 15,
    rank: "Steward",
    storeDiscount: 20,
    featured: true,
    blurb: "Enter active Christian fellowship: post and reply on the Community Message Board, the full reading library, and printable study companions.",
    points: [
      "Everything in Pilgrim",
      "Post and reply on the Community Message Board",
      "The full 1,560-reading library, including house placements",
      "Reading of the Week with pastoral notes",
      "Two PDF guides: Twelve Signs Workbook & Discernment Journal",
      "20% off everything in the store",
    ],
  },
  {
    id: "saint",
    tier: 3,
    name: "Saint",
    price: 30,
    introPrice: 20,
    rank: "Elder",
    storeDiscount: 30,
    blurb: "Full standing in the fellowship: Elder rank, the complete natal chart, priority prayer requests, and every study guide.",
    points: [
      "Everything in Devoted",
      "Elder rank and badge on the message board",
      "Full 10-planet natal chart with placement studies",
      "Priority prayer requests, marked on the board",
      "All four PDF guides, including the Birth Chart Prayer Guide & Family Chart Kit",
      "30% off everything in the store",
    ],
  },
];

export const planById = (id) => PLANS.find((p) => p.id === id);

/** Sign-up buttons go straight to Stripe Checkout for the plan they name (the page you came from is remembered). */
export const joinHref = (planOrTier) => `/checkout/subscribe/${typeof planOrTier === "number" ? PLANS[planOrTier - 1].id : planOrTier}`;

// "comped" = granted by an admin without a Stripe subscription.
const ACTIVE = new Set(["active", "trialing", "past_due", "comped"]);

/** Member reward: % off store items for the user's active plan (0 for free accounts). */
export function storeDiscountOf(user) {
  const t = tierOf(user);
  return t ? PLANS[t - 1].storeDiscount : 0;
}

/** Effective tier for a user: 0 = free, 1..3 = plan tiers. Admins get full access. */
export function tierOf(user) {
  if (!user) return 0;
  if (user.is_admin) return 3;
  if (!user.plan || !ACTIVE.has(user.plan_status)) return 0;
  return planById(user.plan)?.tier ?? 0;
}

/** Feature → minimum tier. Keep gating decisions here so pages stay consistent. */
export const ACCESS = {
  sundayLetter: 1,
  today: 1,
  readingsTier1: 1,
  readingsTier2: 2,
  board: 2,
  weeklyReading: 2,
  fullChart: 3,
};

export const GUIDES = [
  { file: "twelve-signs-workbook.pdf", title: "The Twelve Signs Workbook", desc: "Hebrew constellation roots, patriarchal blessings, and Christ in each sign.", tier: 2 },
  { file: "discernment-journal.pdf", title: "30-Day Discernment Journal", desc: "Daily prompts for prayerful reflection on your season.", tier: 2 },
  { file: "birth-chart-prayer.pdf", title: "Birth Chart Prayer Guide", desc: "Pray through each placement of your chart with Scripture.", tier: 3 },
  { file: "family-chart-kit.pdf", title: "Family Chart Kit", desc: "Grace-centered worksheets for understanding the people you love.", tier: 3 },
];

export function rankOf(user) {
  if (user.is_admin) return "Minister";
  const t = tierOf(user);
  return t ? PLANS[t - 1].rank : "Member";
}
