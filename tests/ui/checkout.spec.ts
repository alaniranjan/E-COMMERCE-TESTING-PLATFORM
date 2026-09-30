import { test, expect } from '../../fixtures/authFixture';
import { findProduct } from '../../utils/testData';

test.describe('Checkout', { tag: ['@ui', '@regression'] }, () => {
  test.beforeEach(async ({ loggedIn, cartPage, checkoutPage, products }) => {
    await loggedIn.addToCart(findProduct(products, 'backpack').name);
    await loggedIn.header.openCart();
    await cartPage.checkout();
    await checkoutPage.expectLoaded();
  });

  test('TC18 Valid checkout', { tag: '@smoke' }, async ({ checkoutPage, checkoutData, products }) => {
    const backpack = findProduct(products, 'backpack');

    await checkoutPage.submitCustomerInfo(checkoutData.validCustomer);

    await checkoutPage.expectOverviewLoaded();
    expect(await checkoutPage.getOverviewItemNames()).toEqual([backpack.name]);
    await expect(checkoutPage.paymentInfo).not.toBeEmpty();
    await expect(checkoutPage.shippingInfo).not.toBeEmpty();
    expect((await checkoutPage.getOrderSummary()).itemTotal).toBe(backpack.price);
  });

  const missingFieldCases: Array<[string, string]> = [
    ['TC19 Missing first name', 'missingFirstName'],
    ['TC20 Missing last name', 'missingLastName'],
    ['TC21 Missing postal code', 'missingPostalCode'],
  ];

  for (const [title, dataKey] of missingFieldCases) {
    test(title, { tag: '@negative' }, async ({ checkoutPage, negativeData }) => {
      const testCase = negativeData.checkout[dataKey];

      await checkoutPage.submitCustomerInfo(testCase.customer);

      await checkoutPage.expectError(testCase.expectedError);
      await checkoutPage.expectOnPage();
    });
  }

  test('TC22 Invalid checkout data: all fields empty', { tag: '@negative' }, async ({ checkoutPage, negativeData }) => {
    const testCase = negativeData.checkout.allFieldsEmpty;

    await checkoutPage.submitCustomerInfo(testCase.customer);

    // Validation reports the first missing field.
    await checkoutPage.expectError(testCase.expectedError);
    await checkoutPage.expectOnPage();
  });

  test('TC22 Invalid checkout data: whitespace-only fields are rejected', { tag: ['@negative', '@known-issue'] }, async ({ checkoutPage, negativeData }) => {
    test.fail(true, 'Known SauceDemo behaviour: whitespace-only customer details are accepted and checkout continues.');
    const testCase = negativeData.checkout.whitespaceOnly;

    await checkoutPage.submitCustomerInfo(testCase.customer);

    // Validation is synchronous, so a short timeout keeps this expected failure fast.
    await expect(checkoutPage.errorMessage).toHaveText(testCase.expectedError, { timeout: 3_000 });
  });

  test('TC23 Order completion', { tag: '@smoke' }, async ({ checkoutPage, productsPage, checkoutData }) => {
    await checkoutPage.submitCustomerInfo(checkoutData.validCustomer);
    await checkoutPage.expectOverviewLoaded();

    await checkoutPage.finish();

    await checkoutPage.expectOrderComplete();
    await expect(checkoutPage.completeText).not.toBeEmpty();
    await checkoutPage.header.expectCartCount(0);

    await checkoutPage.backHome();
    await productsPage.expectLoaded();
    await productsPage.header.expectCartCount(0);
  });

  test('Cancel on overview returns to products and keeps the cart', async ({ checkoutPage, productsPage, checkoutData }) => {
    await checkoutPage.submitCustomerInfo(checkoutData.validCustomer);
    await checkoutPage.expectOverviewLoaded();

    await checkoutPage.cancel();

    await productsPage.expectLoaded();
    await productsPage.header.expectCartCount(1);
  });
});
