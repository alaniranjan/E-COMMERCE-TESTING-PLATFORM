import { Locator } from '@playwright/test';
import { parsePrice } from '../utils/priceUtils';

/** One product tile on the inventory page. */
export class ProductCard {
  readonly name: Locator;
  readonly description: Locator;
  readonly price: Locator;
  readonly addToCartButton: Locator;
  readonly removeButton: Locator;

  constructor(readonly root: Locator) {
    this.name = root.getByTestId('inventory-item-name');
    this.description = root.getByTestId('inventory-item-desc');
    this.price = root.getByTestId('inventory-item-price');
    this.addToCartButton = root.getByRole('button', { name: 'Add to cart' });
    this.removeButton = root.getByRole('button', { name: 'Remove' });
  }

  async getName(): Promise<string> {
    return (await this.name.innerText()).trim();
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

  async openDetails(): Promise<void> {
    await this.name.click();
  }
}
