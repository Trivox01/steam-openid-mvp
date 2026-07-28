import { validateStatisticsSelectors } from "../src/services/statistics/statisticsValidation.ts";

const assertions = validateStatisticsSelectors();
console.log(`Statistics validation passed (${assertions} assertions).`);
