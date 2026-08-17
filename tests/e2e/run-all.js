#!/usr/bin/env node
/**
 * Master E2E Test Runner for Lumina Umay Booking & Payment System (ESM)
 * Runs all 4 test tiers (57 total test cases) and prints a structured ANSI summary.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
  path.join(__dirname, 'tier1-feature-coverage.test.js'),
  path.join(__dirname, 'tier2-boundary-concurrency.test.js'),
  path.join(__dirname, 'tier3-cross-feature.test.js'),
  path.join(__dirname, 'tier4-real-world-scenarios.test.js')
];

console.log('\n======================================================');
console.log('🔮 LUMINA UMAY — E2E TEST SUITE RUNNER');
console.log('======================================================');
console.log(`Target: ${process.env.TEST_BASE_URL || 'In-Process Spec Harness (Standard Mock Server)'}`);
console.log(`Suites to execute: ${testFiles.length} files`);
console.log('======================================================\n');

const testStream = run({
  files: testFiles,
  concurrency: false
});

testStream.compose(new spec()).pipe(process.stdout);

testStream.on('test:fail', () => {
  process.exitCode = 1;
});
