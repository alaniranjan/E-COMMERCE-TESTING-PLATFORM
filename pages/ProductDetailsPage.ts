import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { parsePrice } from '../utils/priceUtils';

export class ProductDetailsPage extends BasePage {
  protected readonly path = '/inventory-item.html';
  readonly name: Locator;
  readonly description: Locator;
  readonly price: Locator;
  readonly addToCartButton: Locator;
  readonly removeButton: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);
    this.name = page.getByTestId('inventory-item-name');
    this.description = page.getByTestId('inventory-item-desc');
    this.price = page.getByTestId('inventory-item-price');
    this.addToCartButton = page.getByTestId('add-to-cart');
    this.removeButton = page.getByTestId('remove');
    this.backButton = page.getByTestId('back-to-products');
  }

  async gotoById(id: number): Promise<void> {
    await this.page.goto(`${this.path}?id=${id}`);
  }

  /** Details URL carries ?id=N, so match on the path prefix only. */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/inventory-item\.html\?id=\d+/);
    await expect(this.name).toBeVisible();
  }

  async getPrice(): Promise<number> {
    return parsePrice(await this.price.innerText());
  }

  async addToCart(): Promise<void> {
    await this.addToCartButton.click();
  }

  async remove(): Promise<void> {
    await this.removeButton.click();
  }

  async backToProducts(): Promise<void> {
    await this.backButton.click();
  }

  async expectProduct(name: string, price: number): Promise<void> {
    await expect(this.name).toHaveText(name);
    expect(await this.getPrice()).toBe(price);
  }
}
