// =============================================================================
// Oracle Theme -- TypeScript port of prototypes/oracle-mode/src/theme.js
// =============================================================================
//
// SINGLE SOURCE OF TRUTH for all visual tokens used in the Oracle UI.
// Components import from this file and never hardcode visual values.
//

// -----------------------------------------------------------------------------
// 1. Font Stacks
// -----------------------------------------------------------------------------

export const fonts = {
  serif: '"Playfair Display", Georgia, "Times New Roman", serif',
  sans: '"General Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"IBM Plex Mono", "JetBrains Mono", "SF Mono", Consolas, monospace',
};

// -----------------------------------------------------------------------------
// 2. Layout Constants
// -----------------------------------------------------------------------------

/**
 * Shared horizontal/vertical padding used by the home page's `appShell`
 * container. Exported so components that need to break out of the shell
 * (e.g. the full-bleed SitewideTradeTape) can apply an exactly-inverse
 * negative margin without hard-coding 24 in two places.
 */
export const APP_SHELL_PADDING_PX = 24;

// -----------------------------------------------------------------------------
// 3. Spacing Scale (base 4px)
// -----------------------------------------------------------------------------

export const space: Record<number, number> = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
};

// -----------------------------------------------------------------------------
// 4. Border Radius Scale
// -----------------------------------------------------------------------------

export const radii = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 8,
  xl: 12,
  full: 9999,
};

// -----------------------------------------------------------------------------
// 5. Theme Definitions
// -----------------------------------------------------------------------------

export interface OracleTheme {
  isDark: boolean;
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  borderThin: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  accentFrom: string;
  accentTo: string;
  accentGradient: string;
  yes: string;
  no: string;
  yesDim: string;
  noDim: string;
  yesBidText: string;
  yesAskText: string;
  noBidText: string;
  noAskText: string;
  depthBarYes: string;
  depthBarNo: string;
  depthBarYesMax: string;
  depthBarNoMax: string;
  spreadBorderYes: string;
  spreadBorderNo: string;
  miniBookWell: string;
  yesWash: string;
  noWash: string;
  chartBg: string;
  chartGrid: string;
  chartPriceRailBg: string;
  chartAreaFillTop: number;
  chartAreaFillBottom: number;
  chartDashedLine: number;
  chartGridWidth: number;
  inputBg: string;
  inputBorder: string;
  inputFocusBorder: string;
  inputPlaceholder: string;
  primaryBtnBg: string;
  primaryBtnColor: string;
  buyYesBtnBg: string;
  buyYesBtnColor: string;
  buyNoBtnBg: string;
  buyNoBtnColor: string;
  sellYesOutline: string;
  sellNoOutline: string;
  outcomeInactiveBg: string;
  outcomeActiveGrad: string;
  outcomeActiveText: string;
  outcomeActiveLabelColor: string;
  panelBg: string;
  probBarBg: string;
  probFillGrad: string;
  grain: number;
  grainBlendMode: string;
  flashBg: string;
  skeletonBase: string;
  skeletonShine: string;
  orbitalBorder: string;
  scrollThumb: string;
  scrollThumbHover: string;
  /**
   * Subtle inset top-edge shadow used by the SitewideTradeTape (and any
   * future full-bleed horizontal rail) to hint at its own plane without a
   * hard separator line. Light in dark mode (inner highlight), dark in
   * light mode (inset shadow) so the effect reads as depth either way.
   */
  tapeTopShadow: string;
  dividerGradient: (yes?: string, no?: string) => string;
}

export const lightTheme: OracleTheme = {
  isDark: false,
  bg: '#F5F0E8',
  surface: '#EDE8E0',
  elevated: '#FFFFFF',
  border: 'rgba(26, 26, 26, 0.30)',
  borderThin: 'rgba(26, 26, 26, 0.18)',
  divider: 'rgba(26, 26, 26, 0.12)',
  textPrimary: '#1A1A1A',
  textSecondary: 'rgba(26, 26, 26, 0.60)',
  textTertiary: 'rgba(26, 26, 26, 0.35)',
  textDisabled: 'rgba(26, 26, 26, 0.25)',
  accentFrom: '#D4846F',
  accentTo: '#C06B58',
  accentGradient: 'linear-gradient(135deg, #D4846F, #C06B58)',
  yes: '#16A34A',
  no: '#DC2626',
  yesDim: 'rgba(22, 163, 74, 0.08)',
  noDim: 'rgba(220, 38, 38, 0.08)',
  yesBidText: '#16A34A',
  yesAskText: '#15803D',
  noBidText: '#DC2626',
  noAskText: '#B91C1C',
  depthBarYes: 'rgba(22, 163, 74, 0.10)',
  depthBarNo: 'rgba(220, 38, 38, 0.10)',
  depthBarYesMax: 'rgba(22, 163, 74, 0.22)',
  depthBarNoMax: 'rgba(220, 38, 38, 0.22)',
  spreadBorderYes: 'rgba(22, 163, 74, 0.15)',
  spreadBorderNo: 'rgba(220, 38, 38, 0.15)',
  miniBookWell: 'rgba(26, 26, 26, 0.03)',
  yesWash: 'linear-gradient(180deg, rgba(22, 163, 74, 0.02) 0%, transparent 60%)',
  noWash: 'linear-gradient(180deg, rgba(220, 38, 38, 0.02) 0%, transparent 60%)',
  chartBg: 'transparent',
  chartGrid: 'rgba(26, 26, 26, 0.06)',
  chartPriceRailBg: 'rgba(26, 26, 26, 0.03)',
  chartAreaFillTop: 0.12,
  chartAreaFillBottom: 0.01,
  chartDashedLine: 0.3,
  chartGridWidth: 0.5,
  inputBg: 'transparent',
  inputBorder: 'rgba(26, 26, 26, 0.20)',
  inputFocusBorder: 'rgba(192, 107, 88, 0.50)',
  inputPlaceholder: 'rgba(26, 26, 26, 0.30)',
  primaryBtnBg: '#1A1A1A',
  primaryBtnColor: '#FFFFFF',
  buyYesBtnBg: '#16A34A',
  buyYesBtnColor: '#000000',
  buyNoBtnBg: '#DC2626',
  buyNoBtnColor: '#FFFFFF',
  sellYesOutline: '#16A34A',
  sellNoOutline: '#DC2626',
  outcomeInactiveBg: '#EFECE6',
  outcomeActiveGrad: 'linear-gradient(135deg, #D4846F, #C06B58)',
  outcomeActiveText: '#FFFFFF',
  outcomeActiveLabelColor: 'rgba(255, 255, 255, 0.80)',
  panelBg: 'rgba(255, 255, 255, 0.30)',
  probBarBg: 'rgba(26, 26, 26, 0.08)',
  probFillGrad: 'linear-gradient(to right, #D4846F, #C06B58)',
  grain: 0.04,
  grainBlendMode: 'multiply',
  flashBg: 'rgba(212, 132, 111, 0.15)',
  skeletonBase: 'rgba(26, 26, 26, 0.06)',
  skeletonShine: 'rgba(26, 26, 26, 0.10)',
  orbitalBorder: '0.5px solid rgba(26, 26, 26, 0.6)',
  scrollThumb: 'rgba(26, 26, 26, 0.15)',
  scrollThumbHover: 'rgba(26, 26, 26, 0.25)',
  tapeTopShadow: 'inset 0 1px 0 rgba(0, 0, 0, 0.04)',
  dividerGradient: (yes?: string, no?: string) =>
    `linear-gradient(180deg, ${yes || '#16A34A'} 0%, rgba(26,26,26,0.15) 50%, ${no || '#DC2626'} 100%)`,
};

export const darkTheme: OracleTheme = {
  isDark: true,
  bg: '#0C0A09',
  surface: '#141210',
  elevated: '#1C1916',
  border: 'rgba(235, 232, 228, 0.20)',
  borderThin: 'rgba(235, 232, 228, 0.12)',
  divider: 'rgba(235, 232, 228, 0.08)',
  textPrimary: '#EBE8E4',
  textSecondary: '#9B9790',
  textTertiary: '#6E6A64',
  textDisabled: 'rgba(235, 232, 228, 0.25)',
  accentFrom: '#E0885A',
  accentTo: '#CF7550',
  accentGradient: 'linear-gradient(135deg, #E0885A, #CF7550)',
  yes: '#22C55E',
  no: '#EF4444',
  yesDim: 'rgba(34, 197, 94, 0.08)',
  noDim: 'rgba(239, 68, 68, 0.08)',
  yesBidText: '#22C55E',
  yesAskText: '#4ADE80',
  noBidText: '#EF4444',
  noAskText: '#F87171',
  depthBarYes: 'rgba(34, 197, 94, 0.08)',
  depthBarNo: 'rgba(239, 68, 68, 0.08)',
  depthBarYesMax: 'rgba(34, 197, 94, 0.18)',
  depthBarNoMax: 'rgba(239, 68, 68, 0.18)',
  spreadBorderYes: 'rgba(34, 197, 94, 0.12)',
  spreadBorderNo: 'rgba(239, 68, 68, 0.12)',
  miniBookWell: 'rgba(0, 0, 0, 0.10)',
  yesWash: 'linear-gradient(180deg, rgba(34, 197, 94, 0.03) 0%, transparent 60%)',
  noWash: 'linear-gradient(180deg, rgba(239, 68, 68, 0.03) 0%, transparent 60%)',
  chartBg: 'transparent',
  chartGrid: 'rgba(235, 232, 228, 0.04)',
  chartPriceRailBg: 'rgba(0, 0, 0, 0.20)',
  chartAreaFillTop: 0.12,
  chartAreaFillBottom: 0.01,
  chartDashedLine: 0.3,
  chartGridWidth: 0.5,
  inputBg: 'transparent',
  inputBorder: 'rgba(235, 232, 228, 0.12)',
  inputFocusBorder: 'rgba(224, 136, 90, 0.40)',
  inputPlaceholder: 'rgba(235, 232, 228, 0.25)',
  primaryBtnBg: '#E0885A',
  primaryBtnColor: '#000000',
  buyYesBtnBg: '#22C55E',
  buyYesBtnColor: '#000000',
  buyNoBtnBg: '#EF4444',
  buyNoBtnColor: '#FFFFFF',
  sellYesOutline: '#22C55E',
  sellNoOutline: '#EF4444',
  outcomeInactiveBg: '#141210',
  outcomeActiveGrad: 'linear-gradient(135deg, #E0885A, #CF7550)',
  outcomeActiveText: '#000000',
  outcomeActiveLabelColor: 'rgba(0, 0, 0, 0.70)',
  panelBg: 'rgba(20, 18, 16, 0.60)',
  probBarBg: '#2C2520',
  probFillGrad: 'linear-gradient(to right, #E0885A, #CF7550)',
  grain: 0.015,
  grainBlendMode: 'overlay',
  flashBg: 'rgba(224, 136, 90, 0.12)',
  skeletonBase: 'rgba(235, 232, 228, 0.04)',
  skeletonShine: 'rgba(235, 232, 228, 0.08)',
  orbitalBorder: '0.5px solid rgba(235, 232, 228, 0.15)',
  scrollThumb: 'rgba(235, 232, 228, 0.10)',
  scrollThumbHover: 'rgba(235, 232, 228, 0.18)',
  tapeTopShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  dividerGradient: (yes?: string, no?: string) =>
    `linear-gradient(180deg, ${yes || '#22C55E'} 0%, #2C2520 50%, ${no || '#EF4444'} 100%)`,
};

// -----------------------------------------------------------------------------
// 6. Typography Presets
// -----------------------------------------------------------------------------

export const type = {
  marketQuestion: {
    fontFamily: fonts.serif,
    fontSize: 22,
    fontWeight: 400 as const,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  probability: {
    fontFamily: fonts.mono,
    fontSize: 32,
    fontWeight: 400 as const,
    letterSpacing: '-0.02em',
    lineHeight: 1.0,
  },
  probabilityDuel: {
    fontFamily: fonts.mono,
    fontSize: 28,
    fontWeight: 400 as const,
    letterSpacing: '-0.02em',
    lineHeight: 1.0,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    fontWeight: 400 as const,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },
  chartPrice: {
    fontFamily: fonts.mono,
    fontSize: 22,
    fontWeight: 400 as const,
    letterSpacing: '-0.02em',
    lineHeight: 1.0,
  },
  statValue: {
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: 400 as const,
    letterSpacing: '-0.01em',
    lineHeight: 1.0,
  },
  watermark: {
    fontFamily: fonts.serif,
    fontSize: 36,
    fontWeight: 400 as const,
    fontStyle: 'italic' as const,
    letterSpacing: '-0.02em',
    lineHeight: 1.0,
    opacity: 0.03,
  },
  metaLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: 500 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.15em',
    lineHeight: 1.0,
  },
  tabLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 500 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    lineHeight: 1.0,
  },
  columnHeader: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    lineHeight: 1.0,
  },
  buttonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 700 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    lineHeight: 1.0,
  },
  buttonTextSmall: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    lineHeight: 1.0,
  },
  bodyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    fontWeight: 400 as const,
    lineHeight: 1.65,
    letterSpacing: 0,
  },
  bodySmall: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: 400 as const,
    lineHeight: 1.5,
    letterSpacing: 0,
  },
  volumeLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 400 as const,
    letterSpacing: '0.05em',
    lineHeight: 1.0,
  },
  timeframeBtn: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 500 as const,
    letterSpacing: '0.05em',
    lineHeight: 1.0,
  },
  emptyState: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: 400 as const,
    lineHeight: 1.5,
  },
  chartPercentLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 400 as const,
    letterSpacing: '0.05em',
    lineHeight: 1.0,
  },
  spreadLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: 500 as const,
    letterSpacing: '0.08em',
    lineHeight: 1.0,
  },
  sortControl: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: 500 as const,
    textTransform: 'uppercase' as const,
    lineHeight: 1.0,
  },
  monoPrice: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: 500 as const,
    lineHeight: 1.0,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  monoQty: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: 400 as const,
    lineHeight: 1.0,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  monoInput: {
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: 500 as const,
    lineHeight: 1.0,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  monoSmall: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: 500 as const,
    lineHeight: 1.0,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  monoAddress: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: 400 as const,
    lineHeight: 1.0,
  },
  monoPnl: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: 600 as const,
    lineHeight: 1.0,
    fontVariantNumeric: 'tabular-nums' as const,
  },
};

// -----------------------------------------------------------------------------
// 7. Animation Constants
// -----------------------------------------------------------------------------

export const motion = {
  instant: 0,
  micro: 80,
  fast: 100,
  normal: 150,
  medium: 200,
  slow: 300,
  deliberate: 600,
  ease: 'ease',
  easeOut: 'ease-out',
  easeIn: 'ease-in',
  easeInOut: 'ease-in-out',
  snappy: 'cubic-bezier(0.16, 1, 0.3, 1)',
  themeTransition: 'background-color 300ms ease, color 300ms ease, border-color 300ms ease',
  hoverTransition: 'color 150ms ease',
  buttonTransition: 'transform 80ms ease, background 300ms ease',
  rowTransition: 'background-color 100ms ease',
  tabTransition: 'color 150ms ease-out, border-color 150ms ease-out',
  flashTransition: 'background-color 200ms ease-out',
  duelFlexTransition: 'flex 600ms cubic-bezier(0.16, 1, 0.3, 1)',
};

// -----------------------------------------------------------------------------
// 8. getTradeStyles(theme)
// -----------------------------------------------------------------------------

export function getTradeStyles(th: OracleTheme) {
  const thinBorder = (color: string) => `0.8px solid ${color}`;
  const btnBorder = (color: string) => `1px solid ${color}`;

  return {
    // A. Global / Page-Level
    grainOverlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none' as const,
      zIndex: 9999,
      opacity: th.grain,
      mixBlendMode: th.grainBlendMode as React.CSSProperties['mixBlendMode'],
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
    },
    pageShell: {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      minHeight: '100vh',
      backgroundColor: th.bg,
      color: th.textPrimary,
      fontFamily: fonts.sans,
      WebkitFontSmoothing: 'antialiased',
      overflowX: 'hidden' as const,
      transition: motion.themeTransition,
    },

    // B. MarketHeader
    marketHeader: {
      position: 'sticky' as const,
      top: 0,
      zIndex: 20,
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      minHeight: 60,
      padding: '16px 24px',
      background: th.surface,
      borderBottom: thinBorder(th.border),
      transition: motion.themeTransition,
    },

    // C. PriceChart
    chartContainer: {
      borderRadius: radii.sm,
      border: thinBorder(th.border),
      background: th.surface,
      overflow: 'hidden' as const,
      position: 'relative' as const,
      transition: motion.themeTransition,
    },
    chartTimeframeBtn: (active: boolean) => ({
      ...type.timeframeBtn,
      color: active ? th.textPrimary : th.textSecondary,
      background: 'transparent',
      border: 'none',
      borderBottom: active ? `1px solid ${th.textPrimary}` : '1px solid transparent',
      borderRadius: 0,
      padding: '4px 0',
      cursor: 'pointer' as const,
      transition: motion.hoverTransition,
    }),

    // D. DuelOrderBook
    duelContainer: {
      borderRadius: radii.sm,
      border: thinBorder(th.border),
      background: th.surface,
      display: 'flex' as const,
      position: 'relative' as const,
      overflow: 'hidden' as const,
      transition: motion.themeTransition,
    },
    duelHalf: (side: string) => ({
      flex: 1,
      display: 'flex' as const,
      flexDirection: 'column' as const,
      padding: '14px 16px',
      background: side === 'yes' ? th.yesWash : th.noWash,
      position: 'relative' as const,
      overflow: 'hidden' as const,
    }),
    duelHeaderRow: {
      display: 'flex' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'baseline' as const,
      marginBottom: 12,
    },
    duelSideLabel: { ...type.metaLabel, color: th.textTertiary },
    duelProbability: (side: string) => ({
      ...type.probabilityDuel,
      color: side === 'yes' ? th.yes : th.no,
    }),
    duelBookWell: {
      background: th.miniBookWell,
      borderRadius: radii.sm,
      overflow: 'hidden' as const,
      flex: 1,
      display: 'flex' as const,
      flexDirection: 'column' as const,
    },
    duelColumnHeader: {
      ...type.columnHeader,
      color: th.textTertiary,
      padding: '5px 10px',
      borderBottom: thinBorder(th.divider),
      display: 'flex' as const,
      justifyContent: 'space-between' as const,
    },
    duelRow: {
      display: 'flex' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      padding: '4px 10px',
      position: 'relative' as const,
      cursor: 'pointer' as const,
      transition: motion.rowTransition,
    },
    duelRowHover: { background: th.divider },
    duelPrice: (side: string, isBid: boolean) => ({
      ...type.monoPrice,
      color: isBid
        ? (side === 'yes' ? th.yesBidText : th.noBidText)
        : (side === 'yes' ? th.yesAskText : th.noAskText),
      textAlign: 'right' as const,
    }),
    duelQty: { ...type.monoQty, color: th.textSecondary, textAlign: 'right' as const },
    duelDepthBar: (side: string, fillPct: number) => ({
      position: 'absolute' as const,
      top: 0,
      right: side === 'yes' ? 0 : undefined,
      left: side === 'no' ? 0 : undefined,
      height: '100%',
      width: `${fillPct}%`,
      background: side === 'yes'
        ? `linear-gradient(to left, ${th.depthBarYesMax}, ${th.depthBarYes})`
        : `linear-gradient(to right, ${th.depthBarNoMax}, ${th.depthBarNo})`,
      pointerEvents: 'none' as const,
      transition: 'width 200ms ease-out',
    }),
    duelSpreadRow: (side: string) => ({
      ...type.spreadLabel,
      color: th.textTertiary,
      padding: '5px 10px',
      borderTop: thinBorder(side === 'yes' ? th.spreadBorderYes : th.spreadBorderNo),
      borderBottom: thinBorder(side === 'yes' ? th.spreadBorderYes : th.spreadBorderNo),
      textAlign: 'center' as const,
    }),
    duelCenterDivider: {
      width: 1,
      background: th.dividerGradient(th.yes, th.no),
      flexShrink: 0,
      position: 'relative' as const,
    },
    duelProbabilityPill: {
      position: 'absolute' as const,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      ...type.sortControl,
      fontWeight: 600 as const,
      color: th.textPrimary,
      background: th.surface,
      border: thinBorder(th.border),
      borderRadius: radii.xl,
      padding: '4px 10px',
      whiteSpace: 'nowrap' as const,
      zIndex: 2,
    },

    // E. TradePanel
    tradePanel: {
      border: thinBorder(th.border),
      borderRadius: radii.sm,
      padding: 24,
      background: th.panelBg,
      backdropFilter: 'blur(10px)',
      position: 'sticky' as const,
      top: 24,
      transition: motion.themeTransition,
    },
    tradePanelHeader: {
      ...type.sectionTitle,
      color: th.textPrimary,
      marginBottom: 24,
      paddingBottom: 12,
      borderBottom: thinBorder(th.border),
    },
    tradeOutcomeContainer: {
      display: 'grid' as const,
      gridTemplateColumns: '1fr 1fr',
      gap: 1,
      background: th.border,
      marginBottom: 24,
    },
    tradeOutcomeBtn: (active: boolean) => ({
      background: active ? th.outcomeActiveGrad : th.outcomeInactiveBg,
      border: 'none',
      borderRadius: 0,
      padding: 16,
      cursor: 'pointer' as const,
      textAlign: 'left' as const,
      transition: 'all 300ms ease',
      color: active ? th.outcomeActiveText : th.textPrimary,
    }),
    tradeOutcomeLabel: (active: boolean) => ({
      ...type.metaLabel,
      color: active ? th.outcomeActiveLabelColor : th.textTertiary,
    }),
    tradeOutcomePrice: {
      fontFamily: fonts.mono,
      fontSize: 18,
      fontWeight: 400 as const,
      marginTop: 4,
    },
    tradeOrderTypeTabs: {
      display: 'flex' as const,
      gap: 16,
      marginBottom: 20,
      borderBottom: thinBorder(th.divider),
      paddingBottom: 0,
    },
    tradeOrderTypeTab: (active: boolean) => ({
      ...type.tabLabel,
      color: active ? th.textPrimary : th.textSecondary,
      background: 'transparent',
      border: 'none',
      borderBottom: active ? `1px solid ${th.textPrimary}` : '1px solid transparent',
      borderRadius: 0,
      padding: '6px 0',
      cursor: 'pointer' as const,
      transition: motion.tabTransition,
    }),
    tradePriceInputGroup: { marginBottom: 20 },
    tradePriceLabel: {
      ...type.metaLabel,
      color: th.textTertiary,
      marginBottom: 8,
      display: 'block' as const,
    },
    tradePriceInput: {
      ...type.monoInput,
      width: '100%',
      background: th.inputBg,
      border: 'none',
      borderBottom: thinBorder(th.inputBorder),
      borderRadius: 0,
      padding: '10px 0',
      outline: 'none',
      color: th.textPrimary,
      textAlign: 'right' as const,
      transition: 'border-color 150ms ease',
    },
    tradeQtyInputGroup: { marginBottom: 20 },
    tradeQtyInput: {
      ...type.monoInput,
      width: '100%',
      background: th.inputBg,
      border: 'none',
      borderBottom: thinBorder(th.inputBorder),
      borderRadius: 0,
      padding: '10px 0',
      outline: 'none',
      color: th.textPrimary,
      textAlign: 'right' as const,
      transition: 'border-color 150ms ease',
    },
    tradeCostSummary: {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      gap: 8,
      marginBottom: 24,
      paddingTop: 12,
    },
    tradeCostRow: {
      display: 'flex' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
    },
    tradeCostLabel: { ...type.metaLabel, color: th.textTertiary },
    tradeCostValue: { ...type.monoPrice, color: th.textPrimary },
    tradeCostValueAccent: (positive: boolean) => ({
      ...type.monoPrice,
      fontWeight: 600 as const,
      color: positive ? th.yes : th.no,
    }),
    tradeSubmitBtnBuy: {
      ...type.buttonText,
      width: '100%',
      padding: 14,
      background: th.buyYesBtnBg,
      color: th.buyYesBtnColor,
      border: 'none',
      borderRadius: radii.sm,
      cursor: 'pointer' as const,
      transition: motion.buttonTransition,
    },
    tradeSubmitBtnSell: {
      ...type.buttonText,
      width: '100%',
      padding: 14,
      background: th.buyNoBtnBg,
      color: th.buyNoBtnColor,
      border: 'none',
      borderRadius: radii.sm,
      cursor: 'pointer' as const,
      transition: motion.buttonTransition,
    },
    tradeProbBar: {
      marginTop: 32,
      paddingTop: 16,
      borderTop: thinBorder(th.border),
    },
    tradeProbBarTrack: {
      height: 4,
      width: '100%',
      background: th.probBarBg,
      marginTop: 8,
      position: 'relative' as const,
      borderRadius: 2,
    },
    tradeProbBarFill: (pct: number) => ({
      position: 'absolute' as const,
      left: 0,
      top: 0,
      height: '100%',
      width: `${pct}%`,
      background: th.probFillGrad,
      borderRadius: 2,
      transition: 'width 300ms ease-out',
    }),

    // F. DataTabs
    dataTabsContainer: {
      borderRadius: radii.sm,
      border: thinBorder(th.border),
      background: th.surface,
      overflow: 'hidden' as const,
      transition: motion.themeTransition,
    },
    dataTabBar: {
      display: 'flex' as const,
      gap: 16,
      padding: '12px 16px 0',
      borderBottom: thinBorder(th.divider),
    },
    dataTab: (active: boolean) => ({
      ...type.tabLabel,
      color: active ? th.textPrimary : th.textSecondary,
      background: 'transparent',
      border: 'none',
      borderBottom: active ? `1px solid ${th.textPrimary}` : '1px solid transparent',
      borderRadius: 0,
      padding: '6px 0',
      marginBottom: -1,
      cursor: 'pointer' as const,
      transition: motion.tabTransition,
    }),
    dataTabBadge: {
      ...type.monoSmall,
      color: th.accentFrom,
      background: 'transparent',
      marginLeft: 6,
    },
    dataColumnHeaders: {
      ...type.columnHeader,
      color: th.textTertiary,
      padding: '8px 16px',
      borderBottom: thinBorder(th.divider),
      display: 'grid' as const,
      alignItems: 'center' as const,
      gap: '4px',
    },
    dataRow: {
      display: 'grid' as const,
      alignItems: 'center' as const,
      gap: '4px',
      padding: '6px 16px',
      transition: motion.rowTransition,
      cursor: 'default' as const,
    },
    dataTradesSide: (side: string) => ({
      ...type.tabLabel,
      fontWeight: 600 as const,
      color: side === 'buy' ? th.yes : th.no,
    }),
    dataTradesPrice: { ...type.monoPrice, color: th.textPrimary, textAlign: 'right' as const },
    dataTradesQty: { ...type.monoQty, color: th.textSecondary, textAlign: 'right' as const },
    dataTradesTime: { ...type.volumeLabel, color: th.textTertiary },
    dataOrderCancel: {
      ...type.metaLabel,
      color: th.no,
      cursor: 'pointer' as const,
      border: 'none',
      background: 'transparent',
      padding: '2px 4px',
    },
    dataPositionPnl: (positive: boolean) => ({
      ...type.monoPnl,
      color: positive ? th.yes : th.no,
    }),
    dataEmptyState: {
      ...type.emptyState,
      color: th.textTertiary,
      textAlign: 'center' as const,
      padding: '40px 0',
    },

    // G. EditorialSection
    editorialPanel: {
      borderRadius: radii.sm,
      border: thinBorder(th.border),
      background: th.surface,
      padding: '24px 28px',
      transition: motion.themeTransition,
    },
    editorialSectionTitle: {
      ...type.sectionTitle,
      color: th.textPrimary,
      marginBottom: 16,
    },

    // H. Decoration
    decorationOrbit: {
      position: 'absolute' as const,
      top: -20,
      right: -20,
      width: 100,
      height: 40,
      border: th.orbitalBorder,
      borderRadius: '50%',
      transform: 'rotate(-15deg)',
      pointerEvents: 'none' as const,
      opacity: 0.3,
    },

    // Meta label re-export for convenience
    metaLabel: { ...type.metaLabel, color: th.textTertiary },
  };
}

// -----------------------------------------------------------------------------
// 9. Price Display Helpers
// -----------------------------------------------------------------------------

/** Chain ticks (0-1000) to display price (0.000-1.000) */
export const ticksToPrice = (ticks: number): string => (ticks / 1000).toFixed(3);

/** Chain ticks to percentage (0-100) */
export const ticksToPct = (ticks: number): number => Math.round(ticks / 10);

/** Chain ticks to dollar display */
export const ticksToDollars = (ticks: number): string => (ticks / 1000).toFixed(2);
