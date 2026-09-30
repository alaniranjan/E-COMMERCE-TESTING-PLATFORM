import { test as base, expect, type TestInfo } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { LoginPage } from '../pages/LoginPage';
import { ProductsPage } from '../pages/ProductsPage';
import { ProductDetailsPage } from '../pages/ProductDetailsPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { loadTestData } from '../utils/testData';
import { logContext, logger } from '../utils/logger';
import { UsersData, NegativeData, ProductsData, CheckoutData } from '../test-data/types';

export interface PageFixtures {
  loginPage: LoginPage;
  productsPage: ProductsPage;
  productDetailsPage: ProductDetailsPage;
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
}

export interface DataFixtures {
  users: UsersData;
  negativeData: NegativeData;
  products: ProductsData;
  checkoutData: CheckoutData;
}

/** Page objects and test data injected into every test; no `new XPage(page)` in spec files. */
export const test = base.extend<PageFixtures & DataFixtures & { testLogging: void }>({
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  productsPage: async ({ page }, use) => use(new ProductsPage(page)),
  productDetailsPage: async ({ page }, use) => use(new ProductDetailsPage(page)),
  cartPage: async ({ page }, use) => use(new CartPage(page)),
  checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),

  users: async ({}, use) => use(loadTestData<UsersData>('users')),
  negativeData: async ({}, use) => use(loadTestData<NegativeData>('negative-data')),
  products: async ({}, use) => use(loadTestData<ProductsData>('products')),
  checkoutData: async ({}, use) => use(loadTestData<CheckoutData>('checkout')),

  /**
   * Auto fixture for every test: Allure labels, structured start/end log lines,
   * and the test's own log lines attached to the report when it fails.
   */
  testLogging: [
    async ({}, use, testInfo) => {
      const test = testInfo.titlePath.slice(1).join(' > ');
      const browser = testInfo.project.name;
      logContext.begin(test, browser);
      await applyAllureLabels(testInfo);
      logger.info('test:start');
      await use();
      const failed = testInfo.status !== testInfo.expectedStatus;
      logger[failed ? 'error' : 'info']('test:end', {
        status: testInfo.status,
        durationMs: testInfo.duration,
        error: testInfo.error?.message?.replace(/\u001b\[[0-9;]*m/g, ''),
      });
      const lines = logContext.end();
      if (failed) {
        await testInfo.attach('test-log.jsonl', {
          body: lines.map((l) => JSON.stringify(l)).join('\n'),
          contentType: 'application/x-ndjson',
        });
      }
    },
    { auto: true },
  ],
});

const SEVERITY_BY_TAG: Array<[string, allure.Severity]> = [
  ['@e2e', allure.Severity.BLOCKER],
  ['@smoke', allure.Severity.CRITICAL],
  ['@known-issue', allure.Severity.MINOR],
];

/**
 * Derives Allure labels from project, describe blocks and tags so spec files stay free of reporting code.
 * titlePath is [file, ...describes, title].
 */
async function applyAllureLabels(testInfo: TestInfo): Promise<void> {
  const [, ...rest] = testInfo.titlePath;
  const describes = rest.slice(0, -1);
  const isApi = testInfo.project.name === 'api';

  await allure.epic(isApi ? 'API Automation' : 'UI Automation');
  await allure.feature(describes[0]?.replace(/^API: /, '') ?? 'End-to-end journeys');
  if (describes[1]) await allure.story(describes[1]);
  await allure.severity(SEVERITY_BY_TAG.find(([tag]) => testInfo.tags.includes(tag))?.[1] ?? allure.Severity.NORMAL);
  // Custom "tc" label: Allure's reserved testCaseId identifies history and must stay unique per browser.
  const tcId = testInfo.title.match(/^(TC\d+)/)?.[1];
  if (tcId) await allure.label('tc', tcId);
}

export { expect };
