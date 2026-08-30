import React from "react";

type P = { size?: number; className?: string; sw?: number };
const S = ({ size = 18, className, sw = 1.8, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

/* brand */
export const StarkMark = ({ size = 24, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M13.5 2 5 13.5h5L9.5 22 19 9.5h-5.5L13.5 2z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
  </svg>
);
export const IcoBolt = (p: P) => <S {...p}><path d="M13.5 2 5 13.5h5L9.5 22 19 9.5h-5.5L13.5 2z" /></S>;

/* nav */
export const IHome = (p: P) => <S {...p}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5z" /></S>;
export const IWallet = (p: P) => <S {...p}><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 9h17M16.5 14.2h.01" strokeWidth="2.4" /></S>;
export const ISpark = (p: P) => <S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></S>;
export const ISparkSharp = ({ size = 18, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="spk" x1="4" y1="4" x2="20" y2="20">
        <stop offset="0" stopColor="#00E5FF" /><stop offset="1" stopColor="#8B5CF6" />
      </linearGradient>
    </defs>
    <path d="M12 2.5c.6 4.6 2 6.6 3.2 7.7 1.1 1.1 3.2 2.4 6.3 1.8-4.6.7-6.6 2-7.7 3.2-1.1 1.2-1.2 3.4-1.8 6.3-.7-4.6-2-6.6-3.2-7.7C7.7 12.7 5.6 12.5 2.5 12c4.6-.7 6.6-2 7.7-3.2C11.3 7.6 11.4 5.4 12 2.5z" fill="url(#spk)" />
    <circle cx="18.6" cy="5" r="1.3" fill="#00E5FF" />
    <circle cx="5.4" cy="19" r="1" fill="#8B5CF6" />
    <circle cx="12" cy="12" r="1.1" fill="#fff" opacity="0.9" />
  </svg>
);
export const IActivity = (p: P) => <S {...p}><path d="M3 12h4l2.5-6.5L14 18.5 16.5 12H21" /></S>;
export const IUser = (p: P) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20c1.2-3.2 4-5 7.5-5s6.3 1.8 7.5 5" /></S>;

/* misc */
export const IBack = (p: P) => <S {...p}><path d="m14.5 5.5-6.5 6.5 6.5 6.5" /></S>;
export const IChevR = (p: P) => <S {...p}><path d="m9.5 6 6 6-6 6" /></S>;
export const IChevD = (p: P) => <S {...p}><path d="m6 9.5 6 6 6-6" /></S>;
export const ICheck = (p: P) => <S {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></S>;
export const IX = (p: P) => <S {...p}><path d="m6 6 12 12M18 6 6 18" /></S>;
export const IInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>;
export const IBell = (p: P) => <S {...p}><path d="M18 15.5H6c1-1.5 1.2-3.5 1.2-6A4.8 4.8 0 0 1 12 4.7a4.8 4.8 0 0 1 4.8 4.8c0 2.5.2 4.5 1.2 6z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></S>;
export const IPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IPlay = (p: P) => <S {...p}><path d="M8 5.5v13l10-6.5-10-6.5z" /></S>;
export const ICopy = (p: P) => <S {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M5.5 15.5h-1a1.5 1.5 0 0 1-1.5-1.5V5.5A1.5 1.5 0 0 1 4.5 4H14A1.5 1.5 0 0 1 15.5 5.5v1" /></S>;
export const ILock = (p: P) => <S {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" /></S>;
export const IEye = (p: P) => <S {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></S>;
export const IEyeOff = (p: P) => <S {...p}><path d="M4 4l16 16M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6 8.2A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 3.5-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></S>;
export const IFinger = (p: P) => <S {...p}><path d="M8 11.5a4 4 0 0 1 8 0c0 3-.5 5.5-1.5 7.5M8.3 14.5c0 2.5-.4 4.3-1.3 6M12 11.5c0 3.4-.4 6-1.6 8.5M12 3.5a8.5 8.5 0 0 0-6 2.5M12 3.5a8.5 8.5 0 0 1 6.5 3M3.5 12v.5c0 2.3-.3 4.3-1 6M20.5 11.5v1c0 2-.3 3.8-.9 5.5" /></S>;
export const IShield = (p: P) => <S {...p}><path d="M12 3 5 5.8v5.4c0 4.6 3 8 7 9.3 4-1.3 7-4.7 7-9.3V5.8L12 3z" /><path d="m9 11.8 2.2 2.2L15.4 9.6" /></S>;
export const IGauge = (p: P) => <S {...p}><path d="M4.5 17.5a9 9 0 1 1 15 0" /><path d="M12 13.5 15.5 9" /><circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" /></S>;
export const IWifi = (p: P) => <S {...p}><path d="M2.5 9.5a14 14 0 0 1 19 0M5.5 13a10 10 0 0 1 13 0M8.6 16.2a5.5 5.5 0 0 1 6.8 0" /><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" /></S>;
export const IChart = (p: P) => <S {...p}><path d="M4 20V4M4 20h16" /><path d="M8 16v-5M12 16V7M16 16v-3M20 16V9" /></S>;
export const IUsers = (p: P) => <S {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5M16 5.5a3.5 3.5 0 0 1 0 6.6M18.5 15.8c1.5.8 2.6 2.2 3 4.2" /></S>;
export const IStar = (p: P) => <S {...p}><path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.3 6.7 19l1.1-5.8L3.5 9.2l5.9-.8L12 3z" /></S>;
export const IHeadset = (p: P) => <S {...p}><path d="M4.5 13a7.5 7.5 0 0 1 15 0" /><rect x="3.5" y="12.5" width="4" height="6" rx="1.8" /><rect x="16.5" y="12.5" width="4" height="6" rx="1.8" /><path d="M19 18.5v.7a2.3 2.3 0 0 1-2.3 2.3H13" /></S>;
export const IRefresh = (p: P) => <S {...p}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 3.5V7h-3.5" /></S>;
export const IShare = (p: P) => <S {...p}><circle cx="6" cy="12" r="2.6" /><circle cx="17.5" cy="5.5" r="2.6" /><circle cx="17.5" cy="18.5" r="2.6" /><path d="m8.4 10.8 6.8-4M8.4 13.2l6.8 4" /></S>;
export const ISearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></S>;
export const ICard = (p: P) => <S {...p}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 14.5h4" /></S>;
export const IBank = (p: P) => <S {...p}><path d="m3.5 9 8.5-5 8.5 5H3.5zM5 9v8M9.7 9v8M14.3 9v8M19 9v8M3.5 17h17v3h-17v-3z" /></S>;
export const IArrowUR = (p: P) => <S {...p}><path d="M7 17 17 7M9.5 7H17v7.5" /></S>;
export const IArrowDL = (p: P) => <S {...p}><path d="M17 7 7 17M14.5 17H7V9.5" /></S>;

/* services */
export const IcoSignal = (p: P) => <S {...p}><path d="M4 19.5v-3M8.5 19.5v-6.5M13 19.5V9M17.5 19.5V5" /></S>;
export const IData = (p: P) => <S {...p}><ellipse cx="12" cy="6" rx="7.5" ry="2.8" /><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" /><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></S>;
export const ITv = (p: P) => <S {...p}><rect x="3" y="6.5" width="18" height="12" rx="2" /><path d="m8.5 3 3.5 3.5L15.5 3" /></S>;
export const IMeter = (p: P) => <S {...p}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 7.5h7M8.5 11h4M12 15.5l1.8-2.4h-2.6L13 10.7" /></S>;
export const ITicket = (p: P) => <S {...p}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v1.7a2.3 2.3 0 0 0 0 4.6v1.7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-1.7a2.3 2.3 0 0 0 0-4.6V8.5z" /><path d="M14 6v2M14 11v2M14 16v2" strokeDasharray="0.1 3.4" /></S>;
export const ITarget = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.8" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></S>;
export const ISms = (p: P) => <S {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /><path d="M8.5 10.5h7M8.5 13.5h4.5" /></S>;
export const IGift = (p: P) => <S {...p}><rect x="4" y="9" width="16" height="11" rx="1.8" /><path d="M3.5 6.5h17V9h-17zM12 6.5V20M12 6.5S9.8 3 7.8 3.6 8 6.5 12 6.5zM12 6.5s2.2-3.5 4.2-2.9S16 6.5 12 6.5z" /></S>;
