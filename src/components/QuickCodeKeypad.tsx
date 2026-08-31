import { Delete } from "lucide-react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  disabled?: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

export function QuickCodeKeypad({ value, onChange, label, disabled }: Props) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === "del") onChange(value.slice(0, -1));
    else if (k && value.length < 4) onChange(value + k);
  };

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {label && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--white-muted)",
            marginBottom: 12,
          }}
        >
          {label}
        </span>
      )}

      <div style={{ display: "flex", gap: 14, marginBottom: 20 }} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: i < value.length ? "var(--blue-accent)" : "transparent",
              border: "1px solid var(--navy-border)",
              transition: "background 120ms ease",
            }}
          />
        ))}
      </div>

      <div
        role="group"
        aria-label="Quick code keypad"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          width: "100%",
          maxWidth: 280,
        }}
      >
        {KEYS.map((k, i) =>
          k === "" ? (
            <span key={`sp-${i}`} />
          ) : (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => press(k)}
              aria-label={k === "del" ? "Delete last digit" : k}
              style={{
                minHeight: 58,
                borderRadius: 10,
                background: k === "del" ? "transparent" : "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                color: "var(--white)",
                fontFamily: "var(--font-ui)",
                fontSize: 22,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {k === "del" ? <Delete size={20} /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export default QuickCodeKeypad;
