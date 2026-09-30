import { test, expect } from '../../fixtures/authFixture';
import { config } from '../../utils/config';

/**
 * Negative scenarios beyond the per-page specs. Tests tagged @known-issue use test.fail():
 * they assert the correct behaviour and are expected to fail against SauceDemo today.
 * If SauceDemo fixes the behaviour, Playwright reports them as unexpectedly passing.
 */
test.describe('Negative', { tag: ['@ui', '@regression', '@negative'] }, () => {
  test('Non-existent product id shows "item not found"', async ({ loggedIn, productDetailsPage, negativeData }) => {
    const { nonExistentId, notFoundName } = negativeData.product;

    await productDetailsPage.gotoById(nonExistentId);

    await expect(productDetailsPage.name).toHaveText(notFoundName);
  });

  test('Checkout pages require login', async ({ page, loginPage }) => {
    await page.goto('/checkout-step-one.html');

    await loginPage.expectError("Epic sadface: You can only access '/checkout-step-one.html' when you are logged in.");
  });

  test('Cart page requires login', async ({ page, loginPage }) => {
    await page.goto('/cart.html');

    await loginPage.expectError("Epic sadface: You can only access '/cart.html' when you are logged in.");
  });

  test('Checkout with an empty cart is blocked', { tag: '@known-issue' }, async ({ loggedIn, cartPage }) => {
    test.fail(true, 'Known SauceDemo behaviour: checkout starts even when the cart is empty.');
    await loggedIn.header.openCart();
    await cartPage.expectItemCount(0);

    await cartPage.checkout();

    // Positive assertion (an error must appear) so a slow page can never make this pass by accident.
    await expect(cartPage.errorMessage).toBeVisible({ timeout: 3_000 });
    await cartPage.expectOnPage();
  });

  test('Cart persists across logout and login', async ({ loggedIn, loginPage, users, products }) => {
    // Documents current behaviour: SauceDemo keeps the cart in browser storage across logout.
    await loggedIn.addToCart(products.items[0].name);
    await loggedIn.header.expectCartCount(1);

    await loggedIn.header.logout();
    await loginPage.login(users.standard.username, config.testUserPassword);

    await loggedIn.expectLoaded();
    await loggedIn.header.expectCartCount(1);
  });
});
