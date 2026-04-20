import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          app: "#f5f6f8",
          card: "#ffffff",
          inset: "#f1f3f5",
          footer: "#eef1f4",
        },
        fg: {
          DEFAULT: "#0f172a",
          muted: "#64748b",
          invert: "#ffffff",
        },
        brand: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          active: "#1e40af",
        },
        danger: {
          DEFAULT: "#dc2626",
          hover: "#b91c1c",
        },
        success: "#16a34a",
        warn: "#d97706",
        line: "#dde2e8",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SF Mono",
          "JetBrains Mono",
          "Cascadia Code",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 1px rgba(15, 23, 42, 0.03)",
        cardHover:
          "0 4px 16px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.04)",
      },
      keyframes: {
        pulseRing: {
          "0%":   { transform: "scale(0.85)", opacity: "0.9" },
          "100%": { transform: "scale(1.6)",  opacity: "0"   },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.4s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
