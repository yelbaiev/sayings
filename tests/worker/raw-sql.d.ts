// A migration file read as text, for tests that re-run one against rows written the old way.
// Vite serves `?raw`; this tells TypeScript what it yields. No imports, so it stays a global
// script declaration rather than a module augmentation.
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

// The push module read as text, for the no-logging check in push.test.ts.
declare module "*.ts?raw" {
  const source: string;
  export default source;
}
