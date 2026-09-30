import { test, expect } from '../../fixtures/authFixture';
import { config } from '../../utils/config';
import { NegativeLoginCase } from '../../test-data/types';

function passwordFor(testCase: NegativeLoginCase): string {
  return testCase.useValidPassword ? config.testUserPassword : (testCase.password ?? '');
}

test.describe('Authentication', { tag: ['@ui', '@regression'] }, () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectLoaded();
  });

  test('TC01 Valid login', { tag: '@smoke' }, async ({ loginPage, productsPage, users, products }) => {
    await loginPage.login(users.standard.username, config.testUserPassword);

    await productsPage.expectLoaded();
    await productsPage.expectProductCount(products.catalogSize);
    await expect(productsPage.header.cartLink).toBeVisible();
  });

  const negativeCases: Array<[string, string]> = [
    ['TC02 Invalid username', 'invalidUsername'],
    ['TC03 Invalid password', 'invalidPassword'],
    ['TC04 Empty username', 'emptyUsername'],
    ['TC05 Empty password', 'emptyPassword'],
    ['TC06 Locked user', 'lockedOut'],
  ];

  for (const [title, dataKey] of negativeCases) {
    test(title, { tag: '@negative' }, async ({ loginPage, negativeData, page }) => {
      const testCase = negativeData.login[dataKey];

      await loginPage.login(testCase.username, passwordFor(testCase));

      await loginPage.expectError(testCase.expectedError);
      await expect(page).not.toHaveURL(/inventory\.html/);
    });
  }

  test('Logout returns to the login page', async ({ loggedIn, loginPage }) => {
    await loggedIn.header.logout();

    await loginPage.expectLoaded();
    await expect(loginPage.usernameInput).toBeEmpty();
  });

  test('Protected page redirects to login when not authenticated', async ({ page, loginPage }) => {
    await page.goto('/inventory.html');

    await loginPage.expectError("Epic sadface: You can only access '/inventory.html' when you are logged in.");
  });
});
