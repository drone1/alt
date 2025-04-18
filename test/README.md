# ALT Testing Guide

This directory contains tests for the ALT localization tool, using Mocha, Chai, and Execa.

## Test Structure

- `mock.test.js`: Simple tests that run without external dependencies
- `cli-translation.test.js`: Tests for the core translation CLI functionality
- `config.test.js`: Tests for configuration handling
- `list-models.test.js`: Tests for the list-models command
- `localization.test.js`: Tests for the localization system
- `main-cli.test.js`: Tests for the main CLI interface
- `translate-command.test.js`: Tests for the translate command

## Setup
ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY must be set in order to run some tests.

## Running Tests

Run all tests (requires API keys):
```
npm test
```

Run specific test:
```
npx mocha --grep "test description"
```

Run tests with coverage:
```
npm run test:coverage
```

## Test Data

The `fixtures` directory contains test fixtures used by the tests.
