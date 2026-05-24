// Chart.js global setup for VITAS Reports v2 (Hi-Tech Refresh)
// Source: design_handoff_vitas_hitech_refresh/README.md "Charts — Chart.js global setup"
// Import this once from the root layout or any page that uses Chart.js.

import { Chart } from 'chart.js/auto';

// Apply once. Idempotent — safe to call from multiple modules.
let _configured = false;
export function setupCharts() {
  if (_configured) return;
  _configured = true;

  Chart.defaults.font.family = 'Heebo, system-ui, -apple-system, sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.font.weight = '600';
  Chart.defaults.color = '#383E52';
  Chart.defaults.borderColor = '#ECEEF3';
}

// Brand-aligned chart colors (match CSS tokens in globals.css)
export const CHART_COLORS = {
  indigo:  '#5B5EF4',
  emerald: '#10B981',
  rose:    '#F43F5E',
  terra:   '#F97316',
  violet:  '#8B5CF6',
  sky:     '#0EA5E9',
  amber:   '#F59E0B',
};

// Suggested series order — use this to assign colors consistently across charts.
export const CHART_COLOR_ORDER = [
  CHART_COLORS.indigo,
  CHART_COLORS.emerald,
  CHART_COLORS.violet,
  CHART_COLORS.amber,
  CHART_COLORS.rose,
  CHART_COLORS.sky,
  CHART_COLORS.terra,
];

// Tooltip styling (matches near-black sidebar bg)
export const tooltipCfg = {
  backgroundColor: '#0B0F1E',
  titleColor: '#FFFFFF',
  bodyColor: '#C9CEDC',
  borderColor: 'transparent',
  cornerRadius: 8,
  padding: 10,
  titleFont: { size: 12, weight: '700' },
  bodyFont: { size: 12, weight: '500' },
  rtl: true,
  textDirection: 'rtl',
};

// Legend defaults (bottom, with rounded squares)
export const legendCfg = {
  position: 'bottom',
  rtl: true,
  textDirection: 'rtl',
  labels: {
    boxWidth: 10,
    boxHeight: 10,
    padding: 14,
    font: { weight: '600', size: 11 },
    usePointStyle: true,
    pointStyle: 'rectRounded',
  },
};

// Doughnut chart preset (matches v2 mockup "Budget distribution doughnut")
export const doughnutDefaults = {
  cutout: '62%',
  borderColor: '#FFFFFF',
  borderWidth: 4,
  hoverOffset: 7,
};

// Bar+Line combo preset (matches v2 mockup "Leads & CPL combo")
export const comboBarDefaults = {
  borderRadius: 4,
  maxBarThickness: 32,
};
export const comboLineDefaults = {
  tension: 0.35,
  borderWidth: 2.5,
  pointRadius: 4,
  pointHoverRadius: 6,
  pointBorderColor: '#FFFFFF',
  pointBorderWidth: 2,
};
