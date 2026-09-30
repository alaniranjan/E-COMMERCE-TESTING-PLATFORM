import { test, expect } from '../../fixtures/testFixtures';
import { config } from '../../utils/config';
import { findProduct } from '../../utils/testData';

/** Full purchase journey, one test.step per business step so reports read like the flow. */
test('E2E Customer purchases a product', { tag: ['@ui', '@smoke', '@regression', '@e2e'] }, async ({
  page, loginPage, productsPage, productDetailsPage, cartPage, checkoutPage, users, products, checkoutData,
}) => {
  const product = findProduct(products, 'backpack');

  await test.step('Login', async () => {
    await loginPage.goto();
    await loginPage.login(users.standard.username, config.testUserPassword);
  });

  await test.step('Product listing', async () => {
    await productsPage.expectLoaded();
    await productsPage.expectProductCount(products.catalogSize);
  });

  await test.step('Select product and view details', async () => {
    await productsPage.openProduct(product.name);
    await productDetailsPage.expectLoaded();
    await productDetailsPage.expectProduct(product.name, product.price);
  });

  await test.step('Add to cart', async () => {
    await productDetailsPage.addToCart();
    await productDetailsPage.header.expectCartCount(1);
  });

  await test.step('Open cart and verify product', async () => {
    await productDetailsPage.header.openCart();
    await cartPage.expectLoaded();
    expect(await cartPage.getItemNames()).toEqual([product.name]);
    expect(await cartPage.item(product.name).getPrice()).toBe(product.price);
  });

  await test.step('Checkout: enter customer details', async () => {
    await cartPage.checkout();
    await checkoutPage.expectLoaded();
    await checkoutPage.submitCustomerInfo(checkoutData.validCustomer);
  });

  await test.step('Review order', async () => {
    await checkoutPage.expectOverviewLoaded();
    expect(await checkoutPage.getOverviewItemNames()).toEqual([product.name]);
    expect((await checkoutPage.getOrderSummary()).itemTotal).toBe(product.price);
  });

  await test.step('Complete order and validate confirmation', async () => {
    await checkoutPage.finish();
    await checkoutPage.expectOrderComplete();
    await checkoutPage.header.expectCartCount(0);
    await test.info().attach('order-confirmation', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
