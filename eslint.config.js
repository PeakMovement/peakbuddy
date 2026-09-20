import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "error",
    },
  },
  {
    // Lovable-generated files and the logger itself may use console directly.
    files: [
      "src/lib/log.ts",
      "src/integrations/supabase/**",
      "src/routeTree.gen.ts",
      "scripts/**",
      "src/routes/lovable/**",
      "src/lib/email/**",
    ],
    rules: { "no-console": "off" },
  },
  {
    // Pre-existing `any` debt — do not add new files here. New code must type it.
    files: [
      "src/lib/admin-data-hub.functions.ts",
      "src/lib/email-templates/**",
      "src/lib/email/**",
      "src/lib/google-calendar.functions.ts",
      "src/lib/google-calendar/oauth.ts",
      "src/lib/rewards.functions.ts",
      "src/lib/wearables/snapshot.functions.ts",
      "src/lib/webhooks.functions.ts",
      "src/routes/admin.app.data-hub.tsx",
      "src/routes/client.app.profile.tsx",
      "src/routes/lovable/**",
      "src/routes/practitioner.app.profile.tsx",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  eslintPluginPrettier,
);
