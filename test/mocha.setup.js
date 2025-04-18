// Mocha setup file
// This file sets up the environment for testing

// Set timeout for all tests to 10 seconds by default
export const mochaHooks = {
  beforeAll() {
    // Default timeout for tests (can be overridden in individual tests)
    this.timeout(10000);
  }
};