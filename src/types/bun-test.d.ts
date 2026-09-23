// Minimal ambient types for Bun's built-in test runner.
// Declared locally so `tsc --noEmit` understands the test files without adding a
// dependency (bunfig.toml applies a 24h supply-chain hold on new packages).
declare module "bun:test" {
  type TestFn = () => void | Promise<void>;
  export function describe(label: string, fn: () => void): void;
  export function test(label: string, fn: TestFn): void;
  export function it(label: string, fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
  export function beforeAll(fn: TestFn): void;
  export function afterAll(fn: TestFn): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toMatch(expected: RegExp | string): void;
    toThrow(expected?: unknown): void;
    readonly not: {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toBeNull(): void;
      toBeUndefined(): void;
      toContain(expected: unknown): void;
      toMatch(expected: RegExp | string): void;
      toThrow(expected?: unknown): void;
    };
  };
}
