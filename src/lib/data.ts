export type NetworkId = "MTN" | "AIRTEL" | "GLO" | "9MOBILE";

export const NETWORKS: { id: NetworkId; name: string; color: string; short: string }[] = [
  { id: "MTN", name: "MTN", color: "#FFCB00", short: "MTN" },
  { id: "AIRTEL", name: "Airtel", color: "#E8382F", short: "ATL" },
  { id: "GLO", name: "Glo", color: "#4CB848", short: "GLO" },
  { id: "9MOBILE", name: "9mobile", color: "#17B890", short: "9M" },
];

export interface DataPlan { id: string; size: string; price: number; validity: string; tag?: string }

export const DATA_PLANS: Record<NetworkId, DataPlan[]> = {
  MTN: [
    { id: "mtn-500", size: "500MB", price: 350, validity: "1 day" },
    { id: "mtn-1", size: "1GB", price: 500, validity: "2 days" },
    { id: "mtn-2", size: "2GB", price: 1200, validity: "7 days", tag: "Popular" },
    { id: "mtn-3.5", size: "3.5GB", price: 1800, validity: "14 days" },
    { id: "mtn-6", size: "6GB", price: 2500, validity: "30 days" },
    { id: "mtn-11", size: "11GB", price: 4000, validity: "30 days", tag: "Value" },
    { id: "mtn-20", size: "20GB", price: 8000, validity: "30 days" },
  ],
  AIRTEL: [
    { id: "air-750", size: "750MB", price: 500, validity: "2 days" },
    { id: "air-1.5", size: "1.5GB", price: 1000, validity: "7 days" },
    { id: "air-4", size: "4GB", price: 2500, validity: "14 days", tag: "Popular" },
    { id: "air-8", size: "8GB", price: 4000, validity: "30 days" },
    { id: "air-18", size: "18GB", price: 8000, validity: "30 days", tag: "Value" },
  ],
  GLO: [
    { id: "glo-1", size: "1GB", price: 500, validity: "2 days" },
    { id: "glo-2.9", size: "2.9GB", price: 1500, validity: "14 days", tag: "Popular" },
    { id: "glo-5.8", size: "5.8GB", price: 2500, validity: "30 days" },
    { id: "glo-10", size: "10GB", price: 4000, validity: "30 days" },
    { id: "glo-24", size: "24GB", price: 8000, validity: "30 days", tag: "Value" },
  ],
  "9MOBILE": [
    { id: "9m-1", size: "1GB", price: 500, validity: "1 day" },
    { id: "9m-2.5", size: "2.5GB", price: 1500, validity: "30 days", tag: "Popular" },
    { id: "9m-7", size: "7GB", price: 4000, validity: "30 days" },
    { id: "9m-15", size: "15GB", price: 8000, validity: "30 days" },
  ],
};

export interface CableProvider { id: string; name: string; color: string; field: string; packages: { id: string; name: string; price: number }[] }

export const CABLE_PROVIDERS: CableProvider[] = [
  {
    id: "DSTV", name: "DSTV", color: "#3B82F6", field: "Smartcard / IUC",
    packages: [
      { id: "dstv-padi", name: "DStv Padi", price: 3600 },
      { id: "dstv-yanga", name: "DStv Yanga", price: 5400 },
      { id: "dstv-confam", name: "DStv Confam", price: 9300 },
      { id: "dstv-compact", name: "DStv Compact", price: 15700 },
      { id: "dstv-compactplus", name: "DStv Compact Plus", price: 25000 },
      { id: "dstv-premium", name: "DStv Premium", price: 37000 },
    ],
  },
  {
    id: "GOTV", name: "GOtv", color: "#22C55E", field: "IUC Number",
    packages: [
      { id: "gotv-smallie", name: "GOtv Smallie", price: 1100 },
      { id: "gotv-jinja", name: "GOtv Jinja", price: 3300 },
      { id: "gotv-jolli", name: "GOtv Jolli", price: 4850 },
      { id: "gotv-max", name: "GOtv Max", price: 7200 },
      { id: "gotv-supa", name: "GOtv Supa", price: 9600 },
    ],
  },
  {
    id: "STARTIMES", name: "StarTimes", color: "#F59E0B", field: "Smartcard Number",
    packages: [
      { id: "st-access", name: "Nova", price: 1200 },
      { id: "st-basic", name: "Basic", price: 2100 },
      { id: "st-smart", name: "Smart", price: 2800 },
      { id: "st-super", name: "Super", price: 5000 },
    ],
  },
];

export const DISCOS: { id: string; name: string; region: string }[] = [
  { id: "IKEDC", name: "Ikeja Electric", region: "Lagos (Mainland)" },
  { id: "EKEDC", name: "Eko Electric", region: "Lagos (Island)" },
  { id: "AEDC", name: "Abuja Electric", region: "FCT / Niger" },
  { id: "PHED", name: "Port Harcourt Electric", region: "Rivers" },
  { id: "IBEDC", name: "Ibadan Electric", region: "Oyo / Osun" },
  { id: "KAEDCO", name: "Kaduna Electric", region: "Kaduna" },
  { id: "EEDC", name: "Enugu Electric", region: "Enugu / Anambra" },
  { id: "JED", name: "Jos Electric", region: "Plateau" },
];

export const EXAM_PINS: { id: string; body: string; item: string; price: number }[] = [
  { id: "waec", body: "WAEC", item: "WASSCE Scratch Card", price: 2850 },
  { id: "neco", body: "NECO", item: "Result Checker Token", price: 1100 },
  { id: "nabteb", body: "NABTEB", item: "Result Scratch Card", price: 950 },
  { id: "bece", body: "BECE", item: "JSSCE Checker", price: 800 },
];

export const BETTING_PLATFORMS: { id: string; name: string; color: string }[] = [
  { id: "bet9ja", name: "Bet9ja", color: "#16A34A" },
  { id: "sportybet", name: "SportyBet", color: "#EF4444" },
  { id: "betking", name: "BetKing", color: "#3B82F6" },
  { id: "1xbet", name: "1xBet", color: "#2563EB" },
  { id: "bangbet", name: "Bangbet", color: "#F59E0B" },
  { id: "nairabet", name: "NairaBet", color: "#22C55E" },
];

export const BANKS: string[] = [
  "Access Bank", "GTBank", "Zenith Bank", "First Bank", "UBA", "Union Bank",
  "Fidelity Bank", "Stanbic IBTC", "Wema Bank", "Kuda", "OPay", "Moniepoint",
];

export const AIRTIME_PRESETS = [100, 200, 500, 1000, 2000, 5000];

export const PROMOS: { id: string; tag: string; title: string; sub: string; hue: string }[] = [
  { id: "p1", tag: "CASHBACK", title: "5% cashback Fridays", sub: "On all data bundles over ₦1,000", hue: "#00E5FF" },
  { id: "p2", tag: "REWARDS", title: "Double points weekend", sub: "Earn 2× STARK points on airtime", hue: "#8B5CF6" },
  { id: "p3", tag: "REFERRAL", title: "Refer & earn ₦500", sub: "Per verified active friend", hue: "#22C55E" },
  { id: "p4", tag: "POWER", title: "₦0 fee on electricity", sub: "IKEDC & EKEDC meters this week", hue: "#F59E0B" },
];

export const FAQS: { q: string; a: string }[] = [
  { q: "How fast are airtime and data purchases delivered?", a: "Most airtime and data orders complete in under 15 seconds. If a provider is slow, your transaction stays in PROCESSING and we reconcile automatically — you are never charged for a failed order." },
  { q: "What happens if a transaction fails?", a: "Failed transactions are reversed instantly. The reserved amount is released back to your available balance via a ledger REVERSAL entry and you receive a notification with the details." },
  { q: "How do I fund my wallet?", a: "Tap Add Money, choose an amount and pay with your card via Paystack. Once Paystack confirms the payment on our server, your wallet is credited through the double-entry ledger." },
  { q: "Is my money safe on STARK?", a: "Yes. Every kobo moves through an immutable double-entry ledger. Balances are never edited — corrections happen only through reversals and refunds. Your PIN is hashed and never stored in plain text." },
  { q: "How do STARK Rewards work?", a: "You earn 1 point for every ₦100 spent. Points move you through Bronze, Silver, Gold and Platinum tiers and can be redeemed for cashback at 100 points = ₦50." },
  { q: "Can I buy electricity for any meter?", a: "We support all major Nigerian DisCos. Enter your meter number, we validate it with the DisCo, and your token is issued on purchase for prepaid meters." },
  { q: "How do I dispute a transaction?", a: "Open the transaction, tap Report a Problem and describe the issue. Our support team verifies with the provider and resolves most disputes within 24 hours." },
  { q: "What is Stark Turbo diagnostics?", a: "Stark Turbo runs honest on-device checks — connection type, API latency and stability — and tells you if your network is Excellent, Good, Fair or Poor with recommendations." },
];

export const REWARD_TIERS: { name: string; min: number; hue: string; perk: string }[] = [
  { name: "Bronze", min: 0, hue: "#C08457", perk: "Standard cashback rates" },
  { name: "Silver", min: 1000, hue: "#A8B5C7", perk: "+0.5% cashback on data" },
  { name: "Gold", min: 5000, hue: "#F5C542", perk: "Priority support queue" },
  { name: "Platinum", min: 15000, hue: "#00E5FF", perk: "2× points + zero fees" },
];

export const FEES: Record<string, number> = {
  airtime: 0, data: 0, cable: 50, electricity: 100, exam: 50, betting: 0, sms: 0, gift: 25, withdraw: 10,
};

export const CASHBACK_RATE: Record<string, number> = {
  airtime: 0.005, data: 0.01, cable: 0.01, electricity: 0.005, gift: 0.005,
};

export const SERVICE_META: Record<string, { label: string; provider: string }> = {
  airtime: { label: "Airtime", provider: "Stark VTU Core" },
  data: { label: "Data Bundle", provider: "Stark VTU Core" },
  cable: { label: "Cable TV", provider: "Stark Cable Gateway" },
  electricity: { label: "Electricity", provider: "Stark Power Gateway" },
  exam: { label: "Exam Pin", provider: "Stark e-Pin Vault" },
  betting: { label: "Betting Top-up", provider: "Stark Pay Direct" },
  sms: { label: "Bulk SMS", provider: "Stark SMS Cloud" },
  gift: { label: "Gift", provider: "Stark VTU Core" },
  funding: { label: "Wallet Funding", provider: "Paystack" },
  withdraw: { label: "Bank Withdrawal", provider: "Paystack Transfer" },
};

export const AI_SUGGESTIONS = [
  "What is my balance?",
  "Show my recent transactions",
  "How much did I spend on data this month?",
  "What was my biggest transaction?",
  "Buy ₦1,000 MTN airtime for 0803 123 4567",
  "How do rewards work?",
];
