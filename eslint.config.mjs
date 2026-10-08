import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // "prettier" goes last: it switches off every stylistic rule that would
  // conflict with Prettier, so ESLint owns correctness and Prettier owns format.
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
