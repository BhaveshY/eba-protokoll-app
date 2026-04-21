import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          app: "#fafaf7",
          card: "#ffffff",
          inset: "#f3f3ef",
          subtle: "#f7f7f4",
          footer: "#f3f3ef",
        },
        fg: {
          DEFAULT: "#111111",
          muted: "#6b6b6b",
          subtle: "#9a9996",
          invert: "#ffffff",
        },
        brand: {
          DEFAULT: "#111111",
          hover: "#000000",
          active: "#1f1f1f",
        },
        danger: {
          DEFAULT: "#b42318",
          hover: "#912012",
          soft: "#fdecea",
        },
        success: {
          DEFAULT: "#0f7a3d",
          soft: "#e7f4ec",
        },
        warn: {
          DEFAULT: "#b45309",
          soft: "#fbf0df",
        },
        line: {
          DEFAULT: "#e6e4df",
          strong: "#d6d4cd",
        },
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
        card: "12px",
      },
      boxShadow: {
        card: "0 1px 0 rgba(17, 17, 17, 0.02), 0 1px 2px rgba(17, 17, 17, 0.04)",
        cardHover:
          "0 2px 6px rgba(17, 17, 17, 0.05), 0 8px 24px rgba(17, 17, 17, 0.06)",
        focus: "0 0 0 3px rgba(17, 17, 17, 0.12)",
      },
      keyframes: {
        pulseRing: {
          "0%":   { transform: "scale(0.85)", opacity: "0.7" },
          "100%": { transform: "scale(1.9)",  opacity: "0"   },
        },
        fadeInUp: {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.6s ease-out infinite",
        fadeInUp: "fadeInUp 160ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
