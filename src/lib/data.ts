/* Stark service catalogs & constants (preview reference data — production
   plans come from the Go API's provider_products table). */

export type NetworkId = "MTN" | "AIRTEL" | "GLO" | "9MOBILE";

export const NETWORKS: { id: NetworkId; name: string; hue: string }[] = [
  { id: "MTN", name: "MTN", hue: "#FFCC00" },
  { id: "AIRTEL", name: "Airtel", hue: "#EF4444" },
  { id: "GLO", name: "Glo", hue: "#22C55E" },
  { id: "9MOBILE", name: "9mobile", hue: "#22C55E" },
];

export const DATA_PLANS: Record<NetworkId, { id: string; size: string; price: number; validity: string }[]> = {
  MTN: [
    { id: "mtn-500", size: "500MB", price: 250, validity: "1 day" },
    { id: "mtn-1g", size: "1GB", price: 450, validity: "2 days" },
    { id: "mtn-2g", size: "2GB", price: 900, validity: "7 days" },
    { id: "mtn-3g", size: "3GB", price: 1300, validity: "14 days" },
    { id: "mtn-6g", size: "6GB", price: 2500, validity: "30 days" },
    { id: "mtn-11g", size: "11GB", price: 4000, validity: "30 days" },
  ],
  AIRTEL: [
    { id: "air-1g", size: "1GB", price: 400, validity: "2 days" },
    { id: "air-2g", size: "2GB", price: 850, validity: "7 days" },
    { id: "air-4g", size: "4GB", price: 1600, validity: "14 days" },
    { id: "air-8g", size: "8GB", price: 3000, validity: "30 days" },
  ],
  GLO: [
    { id: "glo-1g", size: "1GB", price: 380, validity: "2 days" },
    { id: "glo-29", size: "2.9GB", price: 950, validity: "7 days" },
    { id: "glo-58", size: "5.8GB", price: 1800, validity: "14 days" },
    { id: "glo-10g", size: "10GB", price: 2900, validity: "30 days" },
  ],
  "9MOBILE": [
    { id: "9m-1g", size: "1GB", price: 420, validity: "2 days" },
    { id: "9m-25", size: "2.5GB", price: 900, validity: "7 days" },
    { id: "9m-7g", size: "7GB", price: 2500, validity: "30 days" },
  ],
};

export const CABLE_PROVIDERS = [
  {
    id: "DSTV", name: "DSTV", hue: "#0071CE",
    packages: [
      { id: "dstv-padi", name: "DStv Padi", price: 2950 },
      { id: "dstv-yanga", name: "DStv Yanga", price: 4200 },
      { id: "dstv-confam", name: "DStv Confam", price: 7400 },
      { id: "dstv-compact", name: "DStv Compact", price: 12500 },
      { id: "dstv-premium", name: "DStv Premium", price: 29500 },
    ],
  },
  {
    id: "GOTV", name: "GOtv", hue: "#00A651",
    packages: [
      { id: "gotv-smallie", name: "GOtv Smallie", price: 1100 },
      { id: "gotv-jinja", name: "GOtv Jinja", price: 2700 },
      { id: "gotv-jolli", name: "GOtv Jolli", price: 4050 },
      { id: "gotv-max", name: "GOtv Max", price: 6200 },
    ],
  },
  {
    id: "STARTIMES", name: "StarTimes", hue: "#E60000",
    packages: [
      { id: "st-nova", name: "Nova", price: 1200 },
      { id: "st-basic", name: "Basic", price: 2100 },
      { id: "st-classic", name: "Classic", price: 3200 },
      { id: "st-super", name: "Super", price: 5600 },
    ],
  },
];

export const DISCOS = [
  { id: "IKEDC", name: "Ikeja Electric (IKEDC)", fee: 0 },
  { id: "EKEDC", name: "Eko Electric (EKEDC)", fee: 0 },
  { id: "AEDC", name: "Abuja Electric (AEDC)", fee: 100 },
  { id: "PHED", name: "Port Harcourt Electric", fee: 100 },
  { id: "IBEDC", name: "Ibadan Electric (IBEDC)", fee: 100 },
  { id: "KEDCO", name: "Kano Electric (KEDCO)", fee: 100 },
  { id: "JED", name: "Jos Electric (JED)", fee: 100 },
];

export const EXAM_PINS = [
  { id: "waec", body: "WAEC", item: "WASSCE Scratch Card", price: 2850 },
  { id: "neco", body: "NECO", item: "NECO Result Checker", price: 950 },
  { id: "jamb", body: "JAMB", item: "UTME Profile Code", price: 600 },
  { id: "nabteb", body: "NABTEB", item: "Result Checker", price: 1100 },
];

export const BETTING_PLATFORMS = [
  { id: "bet9ja", name: "Bet9ja" }, { id: "sportybet", name: "SportyBet" },
  { id: "betking", name: "BetKing" }, { id: "1xbet", name: "1xBet" },
  { id: "bangbet", name: "BangBet" }, { id: "msport", name: "M Sport" },
];

export const BANKS = ["GTBank", "Access Bank", "Zenith Bank", "First Bank", "UBA", "Kuda", "OPay", "Moniepoint"];

export const PROMOS = [
  { tag: "REFERRAL", title: "Refer & earn ₦500", sub: "Per verified active friend", hue: "#22C55E" },
  { tag: "POWER", title: "₦0 fee on electricity", sub: "IKEDC & EKEDC this week", hue: "#F59E0B" },
  { tag: "CASHBACK", title: "5% cashback Fridays", sub: "On all data bundles", hue: "#00E5FF" },
  { tag: "REWARDS", title: "Double points weekend", sub: "Every airtime purchase", hue: "#8B5CF6" },
];

export const FAQS = [
  { q: "Why is my transaction stuck on PROCESSING?", a: "The provider hasn't confirmed yet. Stark reconciles every PROCESSING transaction automatically within minutes — you either receive the value or a full automatic reversal. You're never charged twice." },
  { q: "How long does wallet funding take?", a: "Card payments via Paystack are instant. Bank transfers may take 1–5 minutes. Your wallet updates the moment the server verifies the payment." },
  { q: "I was charged but didn't receive my data. What now?", a: "Open the transaction from Activity and tap Report a Problem. If the provider confirms failure, the reserved amount reverses to your wallet automatically." },
  { q: "Is my money safe with Stark?", a: "Every kobo moves through an immutable double-entry ledger. Failed purchases reverse automatically, and withdrawals are protected by your transaction PIN." },
  { q: "How do referral rewards work?", a: "You earn ₦500 for each friend who registers, verifies, funds their wallet and completes a first purchase. Rewards post to your referral balance after fraud checks." },
  { q: "Can I use Stark without internet?", a: "You can view cached profile, beneficiaries and receipts offline. All financial operations require a live connection for your protection." },
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

export const SERVICE_META: Record<string, { label: string; provider: string }> = {
  airtime: { label: "Airtime", provider: "VTU Engine" },
  data: { label: "Data", provider: "VTU Engine" },
  cable: { label: "Cable TV", provider: "VTU Engine" },
  electricity: { label: "Electricity", provider: "VTU Engine" },
  exam: { label: "Exam Pins", provider: "VTU Engine" },
  betting: { label: "Betting", provider: "VTU Engine" },
  sms: { label: "Bulk SMS", provider: "SMS Gateway" },
  gift: { label: "Gifts", provider: "VTU Engine" },
  funding: { label: "Wallet funding", provider: "Paystack" },
  withdraw: { label: "Withdrawal", provider: "Paystack Transfer" },
};

export const CASHBACK_RATE = 0.05;

/* Advertisement artwork for the billboard slots (generated assets). */
export const AD_IMAGES = {
  appHero: "https://image.qwenlm.ai/generated-images/576c7d85-48bd-4c45-a91b-3e1ffc26e5ca/_result.png",
  data: "https://image.qwenlm.ai/generated-images/d2c4af0e-5f75-4e0a-b30d-83274af19d64/_result.png",
  power: "https://image.qwenlm.ai/generated-images/0a70cd68-b139-48d9-8c0e-418603b63ca5/_result.png",
  cable: "https://image.qwenlm.ai/generated-images/3fcfe78c-0d31-4158-9326-9bd64461edd2/_result.png",
};
