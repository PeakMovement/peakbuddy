import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  ariaLabel?: string;
  style?: React.CSSProperties;
}

/**
 * Password field with a show/hide (eye) toggle so users can confirm what they
 * typed. Drop-in replacement for a controlled <input type="password" />.
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  name,
  autoComplete = "current-password",
  required,
  minLength,
  ariaLabel,
  style,
}: Props) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type={show ? "text" : "password"}
        name={name}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        required={required}
        minLength={minLength}
        style={{ ...(style ?? {}), paddingRight: 48 }}
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow((s) => !s)}
        style={{
          position: "absolute",
          right: 2,
          top: "50%",
          transform: "translateY(-50%)",
          background: "transparent",
          border: "none",
          color: "var(--white-muted)",
          minWidth: 44,
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export default PasswordInput;
