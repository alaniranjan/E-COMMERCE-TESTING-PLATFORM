import { test as base, expect } from './testFixtures';
import { config } from '../utils/config';
import { ProductsPage } from '../pages/ProductsPage';

/**
 * `loggedIn` logs in as the standard user and lands on the Products page.
 * SauceDemo keeps its session and cart client-side, so a UI login per test
 * is cheap and keeps tests fully isolated.
 */
export const test = base.extend<{ loggedIn: ProductsPage }>({
  loggedIn: async ({ loginPage, productsPage, users }, use) => {
    await loginPage.goto();
    await loginPage.login(users.standard.username, config.testUserPassword);
    await productsPage.expectLoaded();
    await use(productsPage);
  },
});

export { expect };
