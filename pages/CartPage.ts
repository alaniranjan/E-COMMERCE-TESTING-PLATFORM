import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { CartItem } from '../components/CartItem';

export class CartPage extends BasePage {
  protected readonly path = '/cart.html';
  readonly cartItems: Locator;
  readonly checkoutButton: Locator;
  readonly continueShoppingButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.cartItems = page.getByTestId('inventory-item');
    this.checkoutButton = page.getByTestId('checkout');
    this.continueShoppingButton = page.getByTestId('continue-shopping');
    this.errorMessage = page.getByTestId('error');
  }

  async expectLoaded(): Promise<void> {
    await this.expectOnPage();
    await this.expectTitle('Your Cart');
  }

  item(name: string): CartItem {
    return new CartItem(this.cartItems.filter({ hasText: name }));
  }

  async getItemNames(): Promise<string[]> {
    await this.expectLoaded();
    return (await this.cartItems.getByTestId('inventory-item-name').allInnerTexts()).map((n) => n.trim());
  }

  async getItemPrices(): Promise<number[]> {
    // Rows share data-test="inventory-item" with the products page; wait so .all() never counts those.
    await this.expectLoaded();
    const items = await this.cartItems.all();
    return Promise.all(items.map((item) => new CartItem(item).getPrice()));
  }

  async removeItem(name: string): Promise<void> {
    await this.item(name).remove();
  }

  async checkout(): Promise<void> {
    await this.checkoutButton.click();
  }

  async continueShopping(): Promise<void> {
    await this.continueShoppingButton.click();
  }

  async expectItemCount(count: number): Promise<void> {
    await expect(this.cartItems).toHaveCount(count);
  }
}
