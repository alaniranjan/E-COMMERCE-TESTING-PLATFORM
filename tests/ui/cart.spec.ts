import { test, expect } from '../../fixtures/authFixture';
import { findProduct } from '../../utils/testData';
import { roundMoney } from '../../utils/priceUtils';

test.describe('Cart', { tag: ['@ui', '@regression'] }, () => {
  test('TC13 Add one product', { tag: '@smoke' }, async ({ loggedIn, productDetailsPage, cartPage, products }) => {
    const bikeLight = findProduct(products, 'bikeLight');
    await loggedIn.openProduct(bikeLight.name);
    await productDetailsPage.addToCart();
    await expect(productDetailsPage.removeButton).toBeVisible();

    await productDetailsPage.header.openCart();

    await cartPage.expectLoaded();
    await cartPage.expectItemCount(1);
    const item = cartPage.item(bikeLight.name);
    await expect(item.name).toHaveText(bikeLight.name);
    expect(await item.getPrice()).toBe(bikeLight.price);
    expect(await item.getQuantity()).toBe(1);
  });

  test('TC14 Add multiple products', async ({ loggedIn, cartPage, products }) => {
    const selected = ['backpack', 'boltTShirt', 'onesie'].map((key) => findProduct(products, key));
    await loggedIn.addToCart(...selected.map((p) => p.name));

    await loggedIn.header.openCart();

    await cartPage.expectItemCount(selected.length);
    expect((await cartPage.getItemNames()).sort()).toEqual(selected.map((p) => p.name).sort());
  });

  test('TC15 Remove product from cart', async ({ loggedIn, cartPage, products }) => {
    const [keep, remove] = ['backpack', 'bikeLight'].map((key) => findProduct(products, key));
    await loggedIn.addToCart(keep.name, remove.name);
    await loggedIn.header.openCart();

    await cartPage.removeItem(remove.name);

    await cartPage.expectItemCount(1);
    expect(await cartPage.getItemNames()).toEqual([keep.name]);
    await cartPage.header.expectCartCount(1);
  });

  test('TC16 Cart count validation', async ({ loggedIn, page, products }) => {
    let expected = 0;
    for (const item of products.items) {
      await loggedIn.product(item.name).addToCart();
      await loggedIn.header.expectCartCount(++expected);
    }

    await loggedIn.product(products.items[0].name).remove();
    await loggedIn.header.expectCartCount(--expected);

    // SauceDemo stores the cart client-side, so it must survive a reload.
    await page.reload();
    await loggedIn.header.expectCartCount(expected);
  });

  test('TC17 Cart total validation', async ({ loggedIn, cartPage, checkoutPage, products, checkoutData }) => {
    const selected = ['backpack', 'fleeceJacket', 'redTShirt'].map((key) => findProduct(products, key));
    const expectedItemTotal = roundMoney(selected.reduce((sum, p) => sum + p.price, 0));
    const expectedTax = roundMoney(expectedItemTotal * checkoutData.taxRate);

    await loggedIn.addToCart(...selected.map((p) => p.name));
    await loggedIn.header.openCart();
    await cartPage.expectItemCount(selected.length);

    const cartSum = roundMoney((await cartPage.getItemPrices()).reduce((a, b) => a + b, 0));
    expect(cartSum, 'sum of cart line prices').toBe(expectedItemTotal);

    await cartPage.checkout();
    await checkoutPage.submitCustomerInfo(checkoutData.validCustomer);
    await checkoutPage.expectOverviewLoaded();

    const summary = await checkoutPage.getOrderSummary();
    expect(summary.itemTotal, 'item total').toBe(expectedItemTotal);
    expect(summary.tax, `tax at ${checkoutData.taxRate * 100}%`).toBe(expectedTax);
    expect(summary.total, 'total = item total + tax').toBe(roundMoney(expectedItemTotal + expectedTax));
  });

  test('Continue shopping keeps the cart', async ({ loggedIn, cartPage, products }) => {
    const backpack = findProduct(products, 'backpack');
    await loggedIn.addToCart(backpack.name);
    await loggedIn.header.openCart();

    await cartPage.continueShopping();

    await loggedIn.expectLoaded();
    await loggedIn.header.expectCartCount(1);
    await expect(loggedIn.product(backpack.name).removeButton).toBeVisible();
  });
});
