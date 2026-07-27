const { runIntelligenceValidation } = await import("../src/intelligence/validation.ts");
const result = runIntelligenceValidation();
process.stdout.write(`Achievement Intelligence validation: ${result.passed} cases passed.\n`);
