import { test as uiTest, expect } from '../../fixtures/authFixture';
import { test as apiTest, expect as apiExpect } from './support/demoFixtures';
import { findProduct, loadTestData } from '../../utils/testData';

// Controlled failures for the AI failure analyzer. See tests/ai-demo/README.md.
// The expected analysis for each test is kept outside this file (ai/eval/demo-ground-truth.json)
// so it never appears in the evidence given to the model.
const demoData = loadTestData<{ backpackExpectedPrice: number }>('ai-demo');

uiTest.describe('AI demo: controlled failures', { tag: ['@ai-demo'] }, () => {
  uiTest('AI-DEMO-001 Backpack price matches the catalog', async ({ loggedIn, products }) => {
    const backpack = findProduct(products, 'backpack');

    const price = await loggedIn.product(backpack.name).getPrice();

    expect(price, `price of ${backpack.name}`).toBe(demoData.backpackExpectedPrice);
  });

  uiTest('AI-DEMO-002 Order completion shows the confirmation', async ({ loggedIn, cartPage, checkoutPage, products, checkoutData }) => {
    await loggedIn.addToCart(findProduct(products, 'backpack').name);
    await loggedIn.header.openCart();
    await cartPage.checkout();
    await checkoutPage.submitCustomerInfo(checkoutData.validCustomer);

    await expect(checkoutPage.completeHeader).toHaveText('Thank you for your order!', { timeout: 5_000 });
  });

  uiTest('AI-DEMO-004 Proceed from cart to checkout', async ({ loggedIn, page, products }) => {
    await loggedIn.addToCart(findProduct(products, 'backpack').name);
    await loggedIn.header.openCart();

    await page.getByTestId('chekout').click({ timeout: 5_000 });
  });
});

apiTest.describe('AI demo: API', { tag: ['@ai-demo'] }, () => {
  apiTest('AI-DEMO-003 Place an order through the API', async ({ apiUser, cartApi, orderApi, apiData }) => {
    await cartApi.addItem(apiData.seededProducts.backpack.id, 1);

    const res = await orderApi.place(apiData.shipping.valid);

    apiExpect(res).toHaveStatus(201);
  });
});
