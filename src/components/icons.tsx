import React from "react";

type P = { size?: number; className?: string; sw?: number };
const S = ({ size = 20, className, sw = 1.8, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

export const IcoBolt = (p: P) => <S {...p}><path d="M13.5 2 5 13.5h5.5L9 22l8.5-11.5H12L13.5 2z" /></S>;
export const IcoSignal = (p: P) => <S {...p}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" /><path d="M4 8.5a8 8 0 0 1 0 7M20 8.5a8 8 0 0 0 0 7" opacity=".85" /></S>;
export const IData = (p: P) => <S {...p}><ellipse cx="12" cy="5.5" rx="7" ry="3" /><path d="M5 5.5v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" /><path d="M5 11.5v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" /></S>;
export const ITv = (p: P) => <S {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m8.5 2.5 3.5 3 3.5-3" /><path d="M7.5 21h9" /></S>;
export const IMeter = (p: P) => <S {...p}><path d="M13 2 5.5 13.5h5L10 22l7.5-11.5h-5L13 2z" fill="currentColor" stroke="none" opacity=".2" /><path d="M13 2 5.5 13.5h5L10 22l7.5-11.5h-5L13 2z" /></S>;
export const IWallet = (p: P) => <S {...p}><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-9z" /><path d="M3.5 9h17" /><circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none" /></S>;
export const IChart = (p: P) => <S {...p}><path d="M4 20V4" /><path d="M4 20h16" /><path d="m7 14 3.5-4 3 2.5L17.5 8" /><circle cx="17.5" cy="8" r="1.3" fill="currentColor" stroke="none" /></S>;
export const ISpark = (p: P) => <S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8.5 13.2 11l2.5 1-2.5 1L12 15.5 10.8 13l-2.5-1 2.5-1L12 8.5z" fill="currentColor" stroke="none" /></S>;
export const IShield = (p: P) => <S {...p}><path d="M12 2.5 5 5.5v6c0 4.5 3 8 7 10 4-2 7-5.5 7-10v-6l-7-3z" /><path d="m9 11.5 2 2 4-4.5" /></S>;
export const IBell = (p: P) => <S {...p}><path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></S>;
export const IGift = (p: P) => <S {...p}><rect x="4" y="8" width="16" height="4" rx="1" /><path d="M6 12v8.5h12V12" /><path d="M12 8v12.5" /><path d="M12 8s-1-4.5-4-4.5S6 8 6 8h6zM12 8s1-4.5 4-4.5S18 8 18 8h-6z" /></S>;
export const ISms = (p: P) => <S {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /><path d="M8.5 10.5h7M8.5 13.5h4.5" /></S>;
export const ITicket = (p: P) => <S {...p}><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2.5 2.5 0 0 0 0-5v-2z" /><path d="M14 6v2.5M14 11v2M14 15.5V18" strokeDasharray="0.1 3.2" /></S>;
export const ITarget = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></S>;
export const IUsers = (p: P) => <S {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5" /><path d="M16 5.5a3.5 3.5 0 0 1 0 6.6M17.5 14.8c2 .8 3.6 2.5 4 5.2" /></S>;
export const ISearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></S>;
export const IPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IBack = (p: P) => <S {...p}><path d="M15 5l-7 7 7 7" /></S>;
export const ICheck = (p: P) => <S {...p}><path d="m4.5 12.5 5 5 10-11" /></S>;
export const IX = (p: P) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const IDownload = (p: P) => <S {...p}><path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 16.5v2.5A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" /></S>;
export const ICopy = (p: P) => <S {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M5.5 15.5h-1a1.5 1.5 0 0 1-1.5-1.5V5.5A1.5 1.5 0 0 1 4.5 4H14A1.5 1.5 0 0 1 15.5 5.5v1" /></S>;
export const IShare = (p: P) => <S {...p}><circle cx="6" cy="12" r="2.5" /><circle cx="17.5" cy="5.5" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" /><path d="m8.3 10.8 6.9-4M8.3 13.2l6.9 4" /></S>;
export const IMic = (p: P) => <S {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3" /></S>;
export const ISend = (p: P) => <S {...p}><path d="m4 11.5 16-7-5 16-3.5-6.5L4 11.5z" /><path d="m11.5 14 8.5-9.5" /></S>;
export const IFinger = (p: P) => <S {...p}><path d="M7 5.5A8 8 0 0 1 20 12c0 2.5-.3 5-1 7" /><path d="M4.5 9A8 8 0 0 0 4 12c0 3-.5 5.5-1 6.5" opacity=".7" /><path d="M12 8.5a3.5 3.5 0 0 1 3.5 3.5c0 2.8-.4 5.5-1.2 7.5" /><path d="M12 12.5c0 3.2-.7 6-2 8" /><path d="M8.7 13.5c0 2.5-.4 4.8-1.2 6.5" opacity=".7" /></S>;
export const ILock = (p: P) => <S {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" /></S>;
export const IEye = (p: P) => <S {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></S>;
export const IEyeOff = (p: P) => <S {...p}><path d="M4 4l16 16" /><path d="M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6 7.5A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.3 3.3-.7" /><path d="M9.5 9.8a3 3 0 0 0 4.2 4.3" /></S>;
export const IQr = (p: P) => <S {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><path d="M13.5 13.5h2.8v2.8h-2.8zM17.2 17.2H20V20h-2.8z" /></S>;
export const IWifi = (p: P) => <S {...p}><path d="M3 9.5a13 13 0 0 1 18 0" /><path d="M6.5 13a8 8 0 0 1 11 0" /><path d="M9.8 16.2a3.5 3.5 0 0 1 4.4 0" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></S>;
export const IRefresh = (p: P) => <S {...p}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3.5V8h-4.5" /></S>;
export const ISnow = (p: P) => <S {...p}><path d="M12 2.5v19M4 7l16 10M20 7 4 17" /><path d="m12 2.5-2 2M12 2.5l2 2M12 21.5l-2-2M12 21.5l2-2" /></S>;
export const IDoc = (p: P) => <S {...p}><path d="M6 3.5h8L19 8.5v12H6z" /><path d="M14 3.5v5h5" /><path d="M9 13h6M9 16.5h6" /></S>;
export const IChevD = (p: P) => <S {...p}><path d="m6 9.5 6 6 6-6" /></S>;
export const IChevR = (p: P) => <S {...p}><path d="m9.5 6 6 6-6 6" /></S>;
export const IOut = (p: P) => <S {...p}><path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" /><path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" /></S>;
export const IEdit = (p: P) => <S {...p}><path d="m14.5 5 4.5 4.5L8.5 20H4v-4.5L14.5 5z" /><path d="m12.5 7 4.5 4.5" /></S>;
export const ICamera = (p: P) => <S {...p}><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 4.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9z" /><circle cx="12" cy="13" r="3.5" /></S>;
export const IStar = (p: P) => <S {...p}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.5z" /></S>;
export const IClock = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></S>;
export const IBank = (p: P) => <S {...p}><path d="m3 8 9-4.5L21 8H3z" /><path d="M5 8v8M9.5 8v8M14.5 8v8M19 8v8" /><path d="M3.5 16.5h17M2.5 20h19" /></S>;
export const IPhone = (p: P) => <S {...p}><path d="M7.5 3.5h-2A1.5 1.5 0 0 0 4 5c0 8.5 6.5 15 15 15a1.5 1.5 0 0 0 1.5-1.5v-2l-4-1.8-1.8 1.8a12 12 0 0 1-5.2-5.2L11.3 9.5 9.5 5.5l-2-2z" /></S>;
export const IHome = (p: P) => <S {...p}><path d="m4 11 8-7 8 7" /><path d="M6 9.5V20h4.5v-5h3v5H18V9.5" /></S>;
export const IActivity = (p: P) => <S {...p}><path d="M3 12h4l2.5-6.5L14 18l2.5-6H21" /></S>;
export const IUser = (p: P) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c.8-4 4-6 7.5-6s6.7 2 7.5 6" /></S>;
export const IInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /></S>;
export const IGauge = (p: P) => <S {...p}><path d="M4.5 18.5a9 9 0 1 1 15 0" /><path d="m12 14 4-5" /><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none" /></S>;
export const ICard = (p: P) => <S {...p}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><path d="M6.5 14.5h4" /></S>;
export const IHeadset = (p: P) => <S {...p}><path d="M4.5 13.5v-2a7.5 7.5 0 0 1 15 0v2" /><rect x="3.5" y="13" width="4" height="6" rx="1.5" /><rect x="16.5" y="13" width="4" height="6" rx="1.5" /><path d="M19 19v.5a2.5 2.5 0 0 1-2.5 2.5H13" /></S>;
export const ISun = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></S>;
export const IMoon = (p: P) => <S {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" /></S>;
export const IPlay = (p: P) => <S {...p}><path d="M8 5.5v13l10-6.5-10-6.5z" /></S>;
export const IStop = (p: P) => <S {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" /></S>;
export const ITrash = (p: P) => <S {...p}><path d="M5 7h14M9.5 7V5h5v2M7 7l1 13h8l1-13" /></S>;
export const IArrowUR = (p: P) => <S {...p}><path d="M7 17 17 7M9 7h8v8" /></S>;
export const IArrowDL = (p: P) => <S {...p}><path d="M17 7 7 17M15 17H7V9" /></S>;

export const StarkMark = ({ size = 28, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.12" />
    <path d="M18.5 4 8 18h6l-2.5 10L22 14h-6l2.5-10z" fill="currentColor" />
  </svg>
);
