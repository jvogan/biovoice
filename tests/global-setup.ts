import { randomUUID } from "node:crypto";
import {
  cleanupScientificTestFixtures,
  prepareScientificTestFixtures,
  scientificTestFixtureRunIdEnv,
} from "./helpers/scientific-test-fixtures.js";

export default async function setup() {
  const previousRunId = process.env[scientificTestFixtureRunIdEnv];
  process.env[scientificTestFixtureRunIdEnv] = randomUUID().replaceAll("-", "");
  await prepareScientificTestFixtures();
  return async () => {
    await cleanupScientificTestFixtures();
    if (previousRunId === undefined) {
      delete process.env[scientificTestFixtureRunIdEnv];
    } else {
      process.env[scientificTestFixtureRunIdEnv] = previousRunId;
    }
  };
}
