// Vite loads `?raw` imports as text. This package has no Vite client types, so it declares the
// SVG form that `emotions.ts` uses.
declare module "*.svg?raw" {
  const source: string;
  export default source;
}
