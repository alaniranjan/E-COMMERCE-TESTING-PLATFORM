import { test, expect } from '../../fixtures/authFixture';
import { findProduct } from '../../utils/testData';
import type { SortOption } from '../../pages/ProductsPage';

test.describe('Product', { tag: ['@ui', '@regression'] }, () => {
  test('TC07 Product list displayed', { tag: '@smoke' }, async ({ loggedIn, products }) => {
    await loggedIn.expectProductCount(products.catalogSize);

    expect(await loggedIn.getAllNames()).toEqual(expect.arrayContaining(products.items.map((p) => p.name)));
    for (const item of products.items) {
      const card = loggedIn.product(item.name);
      await expect(card.description).not.toBeEmpty();
      await expect(card.price).toBeVisible();
      await expect(card.addToCartButton).toBeVisible();
    }
  });

  test('TC08 Product details', async ({ loggedIn, productDetailsPage, products }) => {
    const backpack = findProduct(products, 'backpack');

    await loggedIn.openProduct(backpack.name);

    await productDetailsPage.expectLoaded();
    await productDetailsPage.expectProduct(backpack.name, backpack.price);
    await expect(productDetailsPage.description).not.toBeEmpty();
    await expect(productDetailsPage.addToCartButton).toBeVisible();

    await productDetailsPage.backToProducts();
    await loggedIn.expectLoaded();
  });

  const sortCases: Array<{ option: SortOption; label: string }> = [
    { option: 'az', label: 'Name (A to Z)' },
    { option: 'za', label: 'Name (Z to A)' },
    { option: 'lohi', label: 'Price (low to high)' },
    { option: 'hilo', label: 'Price (high to low)' },
  ];

  for (const { option, label } of sortCases) {
    test(`TC09 Product sorting: ${label}`, async ({ loggedIn, products }) => {
      // Expected order comes from test data, not from the page, so a no-op sort cannot pass.
      const byName = [...products.items].sort((a, b) => a.name.localeCompare(b.name));
      const byPrice = [...products.items].sort((a, b) => a.price - b.price);

      await loggedIn.sortBy(option);

      await expect(loggedIn.sortDropdown).toHaveValue(option);
      if (option === 'az' || option === 'za') {
        const expected = byName.map((p) => p.name);
        expect(await loggedIn.getAllNames()).toEqual(option === 'az' ? expected : expected.reverse());
      } else {
        const expected = byPrice.map((p) => p.price);
        expect(await loggedIn.getAllPrices()).toEqual(option === 'lohi' ? expected : expected.reverse());
      }
    });
  }

  test('TC10 Add product to cart', { tag: '@smoke' }, async ({ loggedIn, products }) => {
    const backpack = findProduct(products, 'backpack');
    const card = loggedIn.product(backpack.name);

    await card.addToCart();

    await expect(card.removeButton).toBeVisible();
    await expect(card.addToCartButton).toBeHidden();
    await loggedIn.header.expectCartCount(1);
  });

  test('TC11 Remove product', async ({ loggedIn, products }) => {
    const backpack = findProduct(products, 'backpack');
    const card = loggedIn.product(backpack.name);
    await card.addToCart();
    await loggedIn.header.expectCartCount(1);

    await card.remove();

    await expect(card.addToCartButton).toBeVisible();
    await loggedIn.header.expectCartCount(0);
  });

  test('TC12 Product price validation', async ({ loggedIn, productDetailsPage, products }) => {
    for (const item of products.items) {
      expect(await loggedIn.product(item.name).getPrice(), `listing price of ${item.name}`).toBe(item.price);
    }

    // The details page must show the same price as the listing.
    const fleece = findProduct(products, 'fleeceJacket');
    await loggedIn.openProduct(fleece.name);
    await productDetailsPage.expectLoaded();
    expect(await productDetailsPage.getPrice()).toBe(fleece.price);
  });
});
